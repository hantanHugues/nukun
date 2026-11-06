import { app } from "electron";
import { createHash, randomBytes } from "node:crypto";
import type { LexiconProposal, LexiconStatus } from "@shared/types";
import { lang } from "@shared/i18n";
import { commonHas, commonSize, glossaryEntries, mergeCommon } from "./ai/memory";
import { getSettings, saveSettings } from "./settings";
import { JsonDoc } from "./store";

/**
 * The shared lexicon, through the Nùkún server (its own repository, "nukun-lexique").
 * Two things, both quiet and both safe to fail:
 * - download: the terms the server published are kept on this PC and help translate;
 * - sharing, only when the reader switched it on: the terms this app learned are sent,
 *   with their translations and definitions, never article text.
 */

export const SERVER = (process.env.NUKUN_LEXIQUE_URL || "https://nukun-lexique.onrender.com").replace(/\/+$/, "");
/** Terms waiting before the weekly question is asked: only what must stay as it is counts, so it is a small number. */
export const LEXICON_MIN = 10;
/** Terms waiting before an automatic send. */
const SHARE_MIN = 5;
const BATCH_MAX = 60;
/** A server asleep on a free plan takes up to a minute to answer. */
const WAIT_MS = 90_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

type Reading = "fr" | "en";

interface Share {
  /** Random, made once, only when sharing starts: counts a reader once, says nothing about who. */
  installId?: string;
  /** Keys of the terms already sent. */
  sent: string[];
  /** When the weekly question was last shown. */
  askedAt?: string;
  remind: boolean;
  lastSendAt?: string;
  lastAttemptAt?: string;
  cursor: Record<Reading, number>;
  syncedAt: Partial<Record<Reading, string>>;
  fullAt: Partial<Record<Reading, string>>;
}

let doc: JsonDoc<Share> | null = null;
const share = () => {
  doc ??= new JsonDoc<Share>("lexicon-share.json", { sent: [], remind: true, cursor: { fr: 0, en: 0 }, syncedAt: {}, fullAt: {} });
  // Files written by an earlier version may lack some fields.
  doc.data.sent ??= [];
  doc.data.cursor ??= { fr: 0, en: 0 };
  doc.data.syncedAt ??= {};
  doc.data.fullAt ??= {};
  return doc;
};

export function flushLexicon() {
  doc?.flush();
}

const older = (iso: string | undefined, ms: number) => !iso || Date.now() - Date.parse(iso) >= ms;

// ---------------------------------------------------------------- talking to the server
async function call(path: string, init: RequestInit = {}) {
  return fetch(`${SERVER}${path}`, {
    ...init,
    headers: { "User-Agent": `Nukun/${app.getVersion()}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(WAIT_MS),
  });
}

function zeroBits(buf: Buffer) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

/**
 * The server's proof of work: find a number that makes the SHA-256 of "challenge:number"
 * start with `bits` zero bits. A fraction of a second, done in slices so nothing freezes.
 */
async function solve(challenge: string) {
  const bits = Number(challenge.split(".")[2]);
  // A server asking for far too much work is not served.
  if (!Number.isFinite(bits) || bits < 1 || bits > 24) throw new Error("défi refusé");
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    if (zeroBits(createHash("sha256").update(`${challenge}:${nonce}`).digest()) >= bits) return nonce;
    if (n % 20_000 === 19_999) await new Promise((r) => setImmediate(r));
  }
}

function installId() {
  const d = share().data;
  if (!d.installId) {
    d.installId = randomBytes(16).toString("hex");
    share().save();
  }
  return d.installId;
}

// ---------------------------------------------------------------- what could be shared
/** Whether a term is really written in the reader's articles (set by the library); open until then. */
let sourceHas: (src: string, term: string) => boolean = () => true;
export function setSourceCheck(fn: (src: string, term: string) => boolean) {
  sourceHas = fn;
}

/**
 * A name that cannot be a translation: one word with a digit or capitals inside (CD127,
 * STED-FLIM, TIGIT, VGG16-UNet). Those do not need to be found in an article that may be
 * gone from this PC; the server's own check judges them.
 */
const distinctive = (term: string) => /^\S+$/.test(term) && (/[0-9]/.test(term) || (term.match(/\p{Lu}/gu) ?? []).length >= 2);

/**
 * What may be shared: the terms the reader's app keeps AS THEY ARE (names, acronyms, jargon
 * left untouched), written like that in their articles, not sent yet and not already in the
 * shared lexicon. Words that have an ordinary translation stay on this PC: the lexicon is
 * not a dictionary. The most used first.
 */
function pending() {
  const done = new Set(share().data.sent);
  return glossaryEntries()
    .filter((e) => !done.has(e.key) && e.term.keep && e.term.term.trim() && !commonHas(e.reading, e.src, e.term.term) && (distinctive(e.term.term) || sourceHas(e.src, e.term.term)))
    .sort((a, b) => b.uses - a.uses || a.term.term.localeCompare(b.term.term));
}

type Entry = ReturnType<typeof pending>[number];

async function sendBatch(reading: Reading, entries: Entry[]): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await call("/v1/challenge");
    if (!c.ok) return false;
    const { challenge } = (await c.json()) as { challenge: string };
    const nonce = await solve(challenge);
    const r = await call("/v1/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install: installId(),
        app: app.getVersion(),
        reading,
        terms: entries.map((e) => ({ src: e.src, term: e.term.term, translation: e.term.fr ?? "", keep: e.term.keep, definition: e.term.definition })),
        pow: { challenge, nonce },
      }),
    });
    if (r.status === 202) {
      share().data.sent.push(...entries.map((e) => e.key));
      return true;
    }
    // An expired challenge: one more try. Anything else (limits, server trouble): later.
    if (r.status !== 400) return false;
  }
  return false;
}

let busy = false;

/** Sends what is waiting. Never throws: a failure only means "later". */
export async function shareNow(): Promise<{ sent: number; failed: boolean }> {
  if (busy) return { sent: 0, failed: false };
  busy = true;
  let sent = 0;
  let failed = false;
  try {
    const all = pending();
    for (const reading of ["fr", "en"] as const) {
      const group = all.filter((e) => e.reading === reading).slice(0, BATCH_MAX);
      if (!group.length) continue;
      if (await sendBatch(reading, group)) sent += group.length;
      else {
        failed = true;
        break;
      }
    }
  } catch {
    failed = true;
  } finally {
    busy = false;
    const d = share().data;
    d.lastAttemptAt = new Date().toISOString();
    if (sent) d.lastSendAt = d.lastAttemptAt;
    share().save();
  }
  return { sent, failed };
}

/** Sending is on, enough has piled up (or a week has passed), and the last try was not just now. */
async function autoShare() {
  const d = share().data;
  const waiting = pending().length;
  if (!waiting || !older(d.lastAttemptAt, 6 * HOUR)) return;
  if (waiting >= SHARE_MIN || older(d.lastSendAt, WEEK)) await shareNow();
}

// ---------------------------------------------------------------- the shared lexicon
const CONTROL = /[\u0000-\u001f\u007f<>`{}\\|]/g;
const tidy = (s: unknown, max: number) => (typeof s === "string" ? s.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What comes from the server is untrusted: same limits as the server's own, then it may reach the AI's prompt. */
function clean(x: unknown) {
  const o = (x ?? {}) as Record<string, unknown>;
  const src = typeof o.src === "string" && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(o.src) ? o.src : "";
  const term = tidy(o.term, 80);
  const fr = tidy(o.translation, 120);
  if (!src || term.length < 2 || !fr) return null;
  return { src, term, keep: o.keep === true, fr, definition: tidy(o.definition, 240) };
}

/** Downloads what the server published since last time (everything again once a week, so blocked terms leave). */
export async function syncCommon(force = false) {
  const reading: Reading = lang() === "en" ? "en" : "fr";
  const d = share().data;
  if (!force && !older(d.syncedAt[reading], 20 * HOUR)) return;
  const full = force || older(d.fullAt[reading], WEEK);
  let since = full ? 0 : (d.cursor[reading] ?? 0);
  for (let page = 0; page < 10; page++) {
    const r = await call(`/v1/lexicon?reading=${reading}&since=${since}&limit=2000`);
    if (!r.ok) throw new Error(`serveur : ${r.status}`);
    const body = (await r.json()) as { terms?: unknown[]; cursor?: number; more?: boolean };
    const terms = (Array.isArray(body.terms) ? body.terms : []).map(clean).filter((t): t is NonNullable<typeof t> => !!t);
    mergeCommon(reading, terms, full && page === 0);
    since = Number.isFinite(body.cursor) ? Number(body.cursor) : since;
    if (!body.more) break;
  }
  const now = new Date().toISOString();
  d.cursor[reading] = since;
  d.syncedAt[reading] = now;
  if (full) d.fullAt[reading] = now;
  share().save();
}

// ---------------------------------------------------------------- the app's side
export function lexiconStatus(): LexiconStatus {
  const s = getSettings();
  const d = share().data;
  const waiting = pending().length;
  // Not during the first launch, not once sharing is on, and at most one question a week.
  const due = !s.shareLexicon && d.remind && !!s.onboarded && !!s.interestsChosen && waiting >= LEXICON_MIN && older(d.askedAt, WEEK);
  return { pending: waiting, sent: d.sent.length, shared: s.shareLexicon, useCommon: s.useCommonLexicon, common: commonSize(), remind: d.remind, due, min: LEXICON_MIN, lastSendAt: d.lastSendAt };
}

/** What would be sent, shown to the reader before they agree. */
export function lexiconPrepare(): LexiconProposal {
  const all = pending();
  const batch = all.slice(0, BATCH_MAX);
  return {
    keys: batch.map((e) => e.key),
    terms: batch.map((e) => ({ term: e.term.term, translation: e.term.fr?.trim() || undefined, keep: e.term.keep, definition: e.term.definition })),
    total: all.length,
  };
}

/** The reader agreed: sharing is on from now, and what is waiting goes out. */
export function lexiconShare() {
  saveSettings({ shareLexicon: true });
  void shareNow();
}

/** The weekly question was shown: the next one is a week away. */
export function lexiconShown() {
  share().data.askedAt = new Date().toISOString();
  share().save();
}

export function lexiconRemind(on: boolean) {
  share().data.remind = on;
  share().save();
}

/** In the background, a little after launch and then every few hours; the work itself is spaced out. */
export function startLexicon() {
  const tick = async () => {
    const s = getSettings();
    // Saving data: nothing is downloaded or sent.
    if (s.dataSaver) return;
    if (s.useCommonLexicon) await syncCommon().catch(() => {});
    if (s.shareLexicon) await autoShare().catch(() => {});
  };
  setTimeout(() => void tick(), 45_000).unref();
  setInterval(() => void tick(), 6 * HOUR).unref();
}
