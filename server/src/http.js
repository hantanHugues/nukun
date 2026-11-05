import { createHash, timingSafeEqual } from "node:crypto";
import { checkSolution, makeChallenge } from "./pow.js";
import * as store from "./store.js";
import { validateBody } from "./validate.js";

const MAX_BODY = 64 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * The request handler. Nothing here logs addresses or bodies: addresses are only kept
 * as salted hashes, to count requests.
 */
export function createApp({ db, config, verifier, now = Date.now, log = () => {} }) {
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const hashIp = (ip) => sha(`${config.ipSalt}|ip|${ip}`).slice(0, 32);
  const hashInstall = (id) => sha(`${config.ipSalt}|install|${id}`).slice(0, 32);

  /** The visitor's address, as the last proxy we trust saw it (the header can be forged before that). */
  function clientIp(req) {
    const hops = config.trustProxyHops;
    const forwarded = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops > 0 && forwarded.length >= hops) return forwarded[forwarded.length - hops];
    return req.socket.remoteAddress ?? "unknown";
  }

  async function readJson(req) {
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON attendu");
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, "requête trop grande");
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "JSON invalide");
    }
  }

  function send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(text);
  }

  /** Counts a hit and turns the request down when the limit is passed. */
  async function limit(key, ttlMs, max, by = 1) {
    const n = await store.hit(db, key, ttlMs, now(), by);
    if (n > max) throw new HttpError(429, "trop de requêtes, réessaie plus tard", { retryAfter: Math.ceil(ttlMs / 1000) });
  }

  function isAdmin(req) {
    const given = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(config.adminToken).digest();
    return config.adminToken.length > 0 && timingSafeEqual(a, b);
  }

  async function route(req, res, url) {
    const { method } = req;
    const path = url.pathname;
    const L = config.limits;

    if (path === "/health") {
      if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "méthode non permise");
      return send(res, 200, { ok: true });
    }

    if (path === "/v1/challenge") {
      if (method !== "GET") throw new HttpError(405, "méthode non permise");
      await limit(`ip:${hashIp(clientIp(req))}:challenge`, HOUR, L.challengesPerHour);
      const challenge = makeChallenge(config.challengeSecret, now(), config.powBits);
      return send(res, 200, { challenge, bits: config.powBits });
    }

    if (path === "/v1/terms") {
      if (method !== "POST") throw new HttpError(405, "méthode non permise");
      const ipHash = hashIp(clientIp(req));
      await limit(`ip:${ipHash}:subs`, DAY, L.ipSubmissionsPerDay);
      const v = validateBody(await readJson(req));
      if (v.error) throw new HttpError(400, v.error);

      const pow = checkSolution(config.challengeSecret, v.pow.challenge, v.pow.nonce, now(), config.powBits);
      if (!pow.ok) throw new HttpError(400, pow.reason);
      if (!(await store.useChallenge(db, pow.id, pow.exp))) throw new HttpError(400, "défi déjà utilisé");

      const installHash = hashInstall(v.install);
      await limit(`install:${installHash}:subs`, DAY, L.installSubmissionsPerDay);
      if (v.terms.length) {
        await limit(`install:${installHash}:terms`, DAY, L.installTermsPerDay, v.terms.length);
        await limit(`ip:${ipHash}:terms`, DAY, L.ipTermsPerDay, v.terms.length);
        await limit("global:terms", DAY, L.globalTermsPerDay, v.terms.length);
      }
      const r = v.terms.length
        ? await store.submit(db, { installHash, ipHash, reading: v.reading, terms: v.terms, minConfirmations: config.minConfirmations })
        : { added: 0, repeated: 0, ignored: 0 };
      verifier?.poke();
      return send(res, 202, { added: r.added, repeated: r.repeated, ignored: r.ignored, rejected: v.rejected });
    }

    if (path === "/v1/lexicon") {
      if (method !== "GET") throw new HttpError(405, "méthode non permise");
      const reading = url.searchParams.get("reading");
      if (reading !== "fr" && reading !== "en") throw new HttpError(400, "langue de lecture invalide");
      const since = Math.max(0, Math.floor(Number(url.searchParams.get("since") ?? 0)) || 0);
      const size = Math.min(5000, Math.max(1, Math.floor(Number(url.searchParams.get("limit") ?? 5000)) || 5000));
      await limit(`ip:${hashIp(clientIp(req))}:reads`, HOUR, L.readsPerHour);
      const r = await store.lexicon(db, { reading, since, limit: size });
      return send(
        res,
        200,
        {
          reading,
          cursor: r.cursor,
          more: r.more,
          terms: r.rows.map((x) => ({ src: x.src, term: x.term, translation: x.translation, keep: x.keep, definition: x.definition })),
        },
        { "Cache-Control": "public, max-age=300" },
      );
    }

    if (path.startsWith("/admin/")) {
      if (!isAdmin(req)) throw new HttpError(401, "non autorisé");
      if (path === "/admin/stats" && method === "GET") {
        return send(res, 200, { ...(await store.stats(db)), verifier: verifier?.status() ?? { status: "none" } });
      }
      if (path === "/admin/candidates" && method === "GET") {
        const status = url.searchParams.get("status") ?? "pending";
        if (!["pending", "ok", "bad", "published", "blocked"].includes(status)) throw new HttpError(400, "statut inconnu");
        const size = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("limit") ?? 50)) || 50));
        return send(res, 200, { candidates: await store.listCandidates(db, { status, limit: size }) });
      }
      if ((path === "/admin/block" || path === "/admin/unblock") && method === "POST") {
        const body = await readJson(req);
        const id = Number(body?.id);
        if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "id invalide");
        const done = await store.setBlocked(db, id, path === "/admin/block", config.minConfirmations);
        if (!done) throw new HttpError(404, "introuvable");
        return send(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, "introuvable");
  }

  return async function handler(req, res) {
    const t0 = now();
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      await route(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, e.status, { error: e.message }, e.extra.retryAfter ? { "Retry-After": String(e.extra.retryAfter) } : {});
      } else {
        log.error?.("[http] erreur", e?.message ?? e);
        if (!res.headersSent) send(res, 500, { error: "erreur du serveur" });
      }
    }
    log.info?.(`${req.method} ${url.pathname} ${res.statusCode} ${now() - t0} ms`);
  };
}
