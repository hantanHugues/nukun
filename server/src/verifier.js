import { AuthError, BadOutputError, GEMINI_ROTATION, QuotaError, RateLimitError } from "./gemini.js";
import { nextPacificMidnight, pacificDay } from "./quota.js";
import * as store from "./store.js";

/**
 * Judges waiting proposals with Gemini, within a daily budget of calls that is never
 * exceeded. Everything that matters is kept in the database (which model is out of quota
 * and until when, the pauses, the calls made), so after a restart or a night asleep the
 * worker simply picks up where it was, and starts again by itself when a quota comes back.
 */
export function createVerifier({ db, gemini, config, now = Date.now, log = console, rotation = GEMINI_ROTATION }) {
  let streak = 0;
  let backoffUntil = 0;
  const cooldown = new Map();
  const rateHits = new Map();
  let last = { status: "starting" };
  let running = false;
  let wake = null;

  const pause = (key, until) => store.setState(db, key, until);

  async function runOnce() {
    if (!gemini) return (last = { status: "no-key" });
    const t = now();
    const pausedUntil = Number(await store.getState(db, "paused_until")) || 0;
    if (pausedUntil > t) return (last = { status: "paused", until: pausedUntil });
    if (backoffUntil > t) return (last = { status: "backoff", until: backoffUntil });

    const day = pacificDay(t);
    if ((await store.callsToday(db, day)) >= config.geminiMaxCallsPerDay) return (last = { status: "budget", until: nextPacificMidnight(t) });

    const batch = await store.pendingBatch(db, config.verifyBatch);
    if (!batch.length) return (last = { status: "idle" });

    // The first model of the rotation that still has quota.
    let model = null;
    let soonest = Infinity;
    for (const m of rotation) {
      const until = Math.max(Number(await store.getState(db, `exhausted:${m}`)) || 0, cooldown.get(m) ?? 0);
      if (until <= t) {
        model = m;
        break;
      }
      soonest = Math.min(soonest, until);
    }
    if (!model) return (last = { status: "paused", until: soonest });

    try {
      const verdicts = await gemini.verify(model, batch);
      await store.addCall(db, day, model);
      streak = 0;
      rateHits.delete(model);
      await store.setVerdicts(db, batch, verdicts, model, config.minConfirmations);
      return (last = { status: "worked", model, judged: verdicts.size });
    } catch (e) {
      if (e instanceof QuotaError) {
        const until = e.untilMs > t ? e.untilMs : nextPacificMidnight(t);
        await pause(`exhausted:${model}`, until);
        log.warn?.(`[verif] quota épuisé pour ${model}, reprise vers ${new Date(until).toISOString()}`);
        return (last = { status: "model-exhausted", model, until });
      }
      if (e instanceof RateLimitError) {
        const n = (rateHits.get(model) ?? 0) + 1;
        rateHits.set(model, n);
        // Three short limits in a row: it is the daily quota in disguise.
        if (n >= 3) {
          rateHits.delete(model);
          const until = nextPacificMidnight(t);
          await pause(`exhausted:${model}`, until);
          return (last = { status: "model-exhausted", model, until });
        }
        cooldown.set(model, t + e.retryMs);
        return (last = { status: "rate-limited", model });
      }
      if (e instanceof AuthError) {
        const until = t + 3600_000;
        await pause("paused_until", until);
        log.error?.("[verif] clé Gemini refusée : pause d'une heure");
        return (last = { status: "paused", until });
      }
      if (e instanceof BadOutputError) {
        await store.addCall(db, day, model);
        await store.bumpAttempts(db, batch.map((b) => b.id));
        return (last = { status: "bad-output", model });
      }
      streak++;
      backoffUntil = t + Math.min(15 * 60_000, 30_000 * 2 ** (streak - 1));
      log.warn?.(`[verif] indisponible (${e?.message ?? e}), nouvel essai dans ${Math.round((backoffUntil - t) / 1000)} s`);
      return (last = { status: "backoff", until: backoffUntil });
    }
  }

  const sleep = (ms) =>
    new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(id);
        resolve();
      };
    });

  async function loop() {
    while (running) {
      const r = await runOnce().catch((e) => {
        log.error?.("[verif] erreur", e?.message ?? e);
        return { status: "error" };
      });
      const quick = ["worked", "model-exhausted", "bad-output", "rate-limited"].includes(r.status);
      const wait = quick ? 1000 : r.until ? Math.min(Math.max(r.until - now(), 1000), 10 * 60_000) : r.status === "error" ? 30_000 : 60_000;
      await sleep(wait);
    }
  }

  return {
    runOnce,
    status: () => last,
    /** A new proposal arrived: look at the queue now. */
    poke: () => wake?.(),
    start() {
      if (running) return;
      running = true;
      void loop();
    },
    stop() {
      running = false;
      wake?.();
    },
  };
}
