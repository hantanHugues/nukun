import http from "node:http";
import { after } from "node:test";
import { loadConfig } from "../src/config.js";
import { migrate, openMemoryDb } from "../src/db.js";
import { createApp } from "../src/http.js";
import { solve } from "../src/pow.js";
import { createVerifier } from "../src/verifier.js";

export const testConfig = (extra = {}) => ({
  ...loadConfig({}),
  ipSalt: "sel-de-test-0123456789",
  challengeSecret: "secret-de-test-0123456789",
  adminToken: "jeton-admin-de-test-0123456789",
  powBits: 8,
  trustProxyHops: 1,
  geminiKey: "cle-de-test",
  ...extra,
});

const opened = [];
const servers = [];
// Every database and server of a test file is closed at its end, so the process can exit.
after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
  for (const d of opened) await d.close().catch(() => {});
});

export async function freshDb() {
  const db = await openMemoryDb();
  await migrate(db);
  opened.push(db);
  return db;
}

/** A fake clock the tests can move forward. */
export function clock(start = Date.UTC(2026, 10, 5, 12, 0, 0)) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  return now;
}

/** A Gemini stand-in: `decide(item)` answers for every item of a batch. */
export function fakeGemini(decide = () => ({ ok: true, reason: "ok" })) {
  const calls = [];
  return {
    calls,
    async verify(model, batch) {
      calls.push({ model, ids: batch.map((b) => b.id) });
      return new Map(batch.map((b) => [b.id, decide(b)]));
    },
  };
}

export async function startApp({ db, config, verifier, now }) {
  const handler = createApp({ db, config, verifier, now });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => {} };
}

export const installId = (n) => String(n).padStart(32, "0").replace(/[^0-9a-f]/g, "a");

export const term = (over = {}) => ({
  src: "en",
  term: "deep learning",
  translation: "apprentissage profond",
  keep: false,
  definition: "Méthode d'apprentissage automatique fondée sur des réseaux de neurones à plusieurs couches.",
  ...over,
});

/** Sends a batch the way the app does: asks for a challenge, solves it, posts. */
export async function submitOver(base, { install, terms, ip = "10.0.0.1", reading = "fr" }) {
  const headers = { "X-Forwarded-For": ip };
  const c = await (await fetch(`${base}/v1/challenge`, { headers })).json();
  const nonce = solve(c.challenge);
  const r = await fetch(`${base}/v1/terms`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ install, app: "1.0.2", reading, terms, pow: { challenge: c.challenge, nonce } }),
  });
  return { status: r.status, body: await r.json() };
}

export { createVerifier };
