import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, QuotaError, RateLimitError, TransientError } from "../src/gemini.js";
import { createVerifier } from "../src/verifier.js";
import * as store from "../src/store.js";
import { clock, fakeGemini, freshDb, installId, startApp, submitOver, term, testConfig } from "./helpers.js";

async function setup(extra = {}, decide) {
  const db = await freshDb();
  const config = testConfig(extra);
  const now = clock();
  const gemini = fakeGemini(decide);
  const verifier = createVerifier({ db, gemini, config, now, log: {} });
  const app = await startApp({ db, config, verifier, now });
  return { db, config, now, gemini, verifier, app };
}

const lexicon = async (base, reading = "fr") => (await (await fetch(`${base}/v1/lexicon?reading=${reading}`)).json()).terms;

test("un terme n'est publié qu'après l'IA ET trois connexions différentes", async () => {
  const { app, verifier, gemini } = await setup();
  for (const [i, ip] of ["10.0.0.1", "10.0.0.2"].entries()) {
    const r = await submitOver(app.base, { install: installId(i + 1), terms: [term()], ip });
    assert.equal(r.status, 202);
    assert.equal(r.body.added, 1);
  }
  await verifier.runOnce();
  assert.equal(gemini.calls.length, 1);
  assert.equal((await lexicon(app.base)).length, 0, "deux confirmations ne suffisent pas");

  await submitOver(app.base, { install: installId(3), terms: [term()], ip: "10.0.0.3" });
  const out = await lexicon(app.base);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ["definition", "keep", "src", "term", "translation"]);
  await app.close();
});

test("une même connexion avec trois installations ne compte qu'une fois", async () => {
  const { app, verifier } = await setup();
  for (let i = 1; i <= 3; i++) await submitOver(app.base, { install: installId(i), terms: [term()], ip: "10.0.0.9" });
  await verifier.runOnce();
  assert.equal((await lexicon(app.base)).length, 0);
  await app.close();
});

test("un terme refusé par l'IA n'est jamais publié, et ses renvois sont ignorés", async () => {
  const { app, verifier } = await setup({}, () => ({ ok: false, reason: "traduction fausse" }));
  for (let i = 1; i <= 3; i++) await submitOver(app.base, { install: installId(i), terms: [term()], ip: `10.0.1.${i}` });
  await verifier.runOnce();
  assert.equal((await lexicon(app.base)).length, 0);
  const again = await submitOver(app.base, { install: installId(4), terms: [term()], ip: "10.0.1.4" });
  assert.equal(again.body.ignored, 1);
  await app.close();
});

test("renvoyer le même terme avec la même installation ne compte pas deux fois", async () => {
  const { app, db } = await setup({ limits: { ...testConfig().limits, installSubmissionsPerDay: 5 } });
  await submitOver(app.base, { install: installId(1), terms: [term()], ip: "10.0.2.1" });
  const r = await submitOver(app.base, { install: installId(1), terms: [term()], ip: "10.0.2.1" });
  assert.equal(r.body.repeated, 1);
  const { rows } = await db.query("SELECT confirmations FROM candidates");
  assert.equal(rows[0].confirmations, 1);
  await app.close();
});

test("deux traductions du même terme : la mieux confirmée prend la place, l'autre la reprend si on la bloque", async () => {
  const { app, verifier, config } = await setup({ minConfirmations: 2 });
  const a = term({ translation: "apprentissage profond" });
  const b = term({ translation: "apprentissage en profondeur" });
  for (let i = 1; i <= 2; i++) await submitOver(app.base, { install: installId(i), terms: [a], ip: `10.0.3.${i}` });
  for (let i = 3; i <= 5; i++) await submitOver(app.base, { install: installId(i), terms: [b], ip: `10.0.3.${i}` });
  await verifier.runOnce();
  let out = await lexicon(app.base);
  assert.equal(out.length, 1);
  assert.equal(out[0].translation, "apprentissage en profondeur", "3 connexions contre 2");

  const admin = { Authorization: `Bearer ${config.adminToken}`, "Content-Type": "application/json" };
  const list = await (await fetch(`${app.base}/admin/candidates?status=published`, { headers: admin })).json();
  const r = await fetch(`${app.base}/admin/block`, { method: "POST", headers: admin, body: JSON.stringify({ id: list.candidates[0].id }) });
  assert.equal(r.status, 200);
  out = await lexicon(app.base);
  assert.equal(out.length, 1);
  assert.equal(out[0].translation, "apprentissage profond", "l'autre traduction prend la place");
  await app.close();
});

test("les limites : par installation, par connexion, et un défi ne sert qu'une fois", async () => {
  const { app } = await setup({ limits: { ...testConfig().limits, installSubmissionsPerDay: 1 } });
  assert.equal((await submitOver(app.base, { install: installId(1), terms: [term()], ip: "10.0.4.1" })).status, 202);
  assert.equal((await submitOver(app.base, { install: installId(1), terms: [term({ term: "autre terme" })], ip: "10.0.4.2" })).status, 429);

  const { solve } = await import("../src/pow.js");
  const c = await (await fetch(`${app.base}/v1/challenge`, { headers: { "X-Forwarded-For": "10.0.4.3" } })).json();
  const nonce = solve(c.challenge);
  const send = (n) =>
    fetch(`${app.base}/v1/terms`, {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.4.3", "Content-Type": "application/json" },
      body: JSON.stringify({ install: installId(n), reading: "fr", terms: [term({ term: `terme ${n}` })], pow: { challenge: c.challenge, nonce } }),
    });
  assert.equal((await send(7)).status, 202);
  const second = await send(8);
  assert.equal(second.status, 400);
  assert.equal((await second.json()).error, "défi déjà utilisé");
  await app.close();
});

test("sans preuve de travail valable, rien n'entre", async () => {
  const { app, db } = await setup();
  const r = await fetch(`${app.base}/v1/terms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.0.5.1" },
    body: JSON.stringify({ install: installId(1), reading: "fr", terms: [term()], pow: { challenge: "v1.1.8.aa.bb", nonce: "0" } }),
  });
  assert.equal(r.status, 400);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM candidates")).rows[0].n, 0);
  await app.close();
});

test("l'en-tête X-Forwarded-For forgé en tête n'aide pas : seule la fin compte", async () => {
  const { app } = await setup({ limits: { ...testConfig().limits, ipSubmissionsPerDay: 1 } });
  const post = async (xff, n) => {
    const { solve } = await import("../src/pow.js");
    const c = await (await fetch(`${app.base}/v1/challenge`, { headers: { "X-Forwarded-For": xff } })).json();
    return fetch(`${app.base}/v1/terms`, {
      method: "POST",
      headers: { "X-Forwarded-For": xff, "Content-Type": "application/json" },
      body: JSON.stringify({ install: installId(n), reading: "fr", terms: [term({ term: `terme ${n}` })], pow: { challenge: c.challenge, nonce: solve(c.challenge) } }),
    });
  };
  assert.equal((await post("1.1.1.1, 10.0.6.1", 1)).status, 202);
  assert.equal((await post("2.2.2.2, 10.0.6.1", 2)).status, 429, "même adresse réelle, fausse tête");
  await app.close();
});

test("l'administration exige le jeton", async () => {
  const { app } = await setup();
  assert.equal((await fetch(`${app.base}/admin/stats`)).status, 401);
  assert.equal((await fetch(`${app.base}/admin/stats`, { headers: { Authorization: "Bearer faux" } })).status, 401);
  const ok = await fetch(`${app.base}/admin/stats`, { headers: { Authorization: "Bearer jeton-admin-de-test-0123456789" } });
  assert.equal(ok.status, 200);
  await app.close();
});

test("quota épuisé : le modèle est mis de côté, le suivant prend le relais", async () => {
  const { db, now, config } = await setup();
  await store.submit(db, { installHash: "i1", ipHash: "p1", reading: "fr", terms: [term()], minConfirmations: 1 });
  const seen = [];
  const gemini = {
    async verify(model, batch) {
      seen.push(model);
      if (model === "gemini-flash-latest") throw new QuotaError(model, now() + 20 * 3600_000);
      return new Map(batch.map((b) => [b.id, { ok: true, reason: "ok" }]));
    },
  };
  const v = createVerifier({ db, gemini, config: { ...config, minConfirmations: 1 }, now, log: {} });
  assert.equal((await v.runOnce()).status, "model-exhausted");
  assert.equal((await v.runOnce()).status, "worked");
  assert.deepEqual(seen, ["gemini-flash-latest", "gemini-3.5-flash"]);
});

test("tous les quotas épuisés : pause, puis reprise toute seule quand ils reviennent", async () => {
  const { db, now, config } = await setup();
  await store.submit(db, { installHash: "i1", ipHash: "p1", reading: "fr", terms: [term()], minConfirmations: 1 });
  let out = true;
  const gemini = {
    async verify(model, batch) {
      if (out) throw new QuotaError(model, now() + 6 * 3600_000);
      return new Map(batch.map((b) => [b.id, { ok: true, reason: "ok" }]));
    },
  };
  const v = createVerifier({ db, gemini, config: { ...config, minConfirmations: 1 }, now, log: {} });
  for (let i = 0; i < 5; i++) assert.equal((await v.runOnce()).status, "model-exhausted");
  const paused = await v.runOnce();
  assert.equal(paused.status, "paused");
  assert.ok(paused.until > now());

  // Un redémarrage : un nouveau vérificateur retrouve la pause dans la base.
  const v2 = createVerifier({ db, gemini, config: { ...config, minConfirmations: 1 }, now, log: {} });
  assert.equal((await v2.runOnce()).status, "paused");

  out = false;
  now.advance(7 * 3600_000);
  assert.equal((await v2.runOnce()).status, "worked");
  assert.equal((await store.stats(db)).byStatus.ok, 1);
});

test("le budget d'appels par jour n'est jamais dépassé, et reprend le lendemain", async () => {
  const { db, now, config } = await setup({ geminiMaxCallsPerDay: 2, verifyBatch: 1 });
  const many = [1, 2, 3, 4, 5].map((n) => term({ term: `terme ${n}` }));
  await store.submit(db, { installHash: "i1", ipHash: "p1", reading: "fr", terms: many, minConfirmations: 1 });
  const gemini = fakeGemini();
  const v = createVerifier({ db, gemini, config: { ...config, minConfirmations: 1 }, now, log: {} });
  assert.equal((await v.runOnce()).status, "worked");
  assert.equal((await v.runOnce()).status, "worked");
  const stop = await v.runOnce();
  assert.equal(stop.status, "budget");
  assert.equal(gemini.calls.length, 2);
  now.advance(24 * 3600_000);
  assert.equal((await v.runOnce()).status, "worked");
  assert.equal(gemini.calls.length, 3);
});

test("limites courtes, panne et clé refusée : attente, puis reprise", async () => {
  const { db, now, config } = await setup();
  await store.submit(db, { installHash: "i1", ipHash: "p1", reading: "fr", terms: [term()], minConfirmations: 1 });
  let mode = "rate";
  const gemini = {
    async verify(model, batch) {
      if (mode === "rate") throw new RateLimitError(model, 30_000);
      if (mode === "down") throw new TransientError("coupé");
      if (mode === "auth") throw new AuthError("refusée");
      return new Map(batch.map((b) => [b.id, { ok: true, reason: "ok" }]));
    },
  };
  const v = createVerifier({ db, gemini, config: { ...config, minConfirmations: 1 }, now, log: {} });
  assert.equal((await v.runOnce()).status, "rate-limited");
  mode = "down";
  now.advance(31_000);
  assert.equal((await v.runOnce()).status, "backoff");
  assert.equal((await v.runOnce()).status, "backoff", "attend avant de réessayer");
  mode = "auth";
  now.advance(16 * 60_000);
  assert.equal((await v.runOnce()).status, "paused");
  mode = "ok";
  assert.equal((await v.runOnce()).status, "paused", "reste en pause une heure");
  now.advance(61 * 60_000);
  assert.equal((await v.runOnce()).status, "worked");
});

test("sans clé Gemini : les propositions sont gardées, rien n'est publié", async () => {
  const { db, now, config } = await setup();
  await store.submit(db, { installHash: "i1", ipHash: "p1", reading: "fr", terms: [term()], minConfirmations: 1 });
  const v = createVerifier({ db, gemini: null, config, now, log: {} });
  assert.equal((await v.runOnce()).status, "no-key");
  assert.equal((await store.stats(db)).byStatus.pending, 1);
});
