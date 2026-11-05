import { keyOf } from "./validate.js";

/** Every query of the server, in one place. */

// ---------------------------------------------------------------- limits
/** Counts a hit on a counter that lasts `ttlMs` from its first hit; returns the new count. */
export async function hit(db, key, ttlMs, now, by = 1) {
  const at = new Date(now);
  const until = new Date(now + ttlMs);
  const r = await db.query(
    `INSERT INTO counters (key, n, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN counters.expires_at <= $4 THEN $2 ELSE counters.n + $2 END,
       expires_at = CASE WHEN counters.expires_at <= $4 THEN $3 ELSE counters.expires_at END
     RETURNING n`,
    [key, by, until, at],
  );
  return r.rows[0].n;
}

/** A challenge may be used once: false when it already was. */
export async function useChallenge(db, id, exp) {
  const r = await db.query("INSERT INTO used_challenges (id, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id", [id, new Date(exp)]);
  return r.rows.length === 1;
}

export async function cleanup(db, now) {
  const at = new Date(now);
  await db.query("DELETE FROM counters WHERE expires_at < $1", [at]);
  await db.query("DELETE FROM used_challenges WHERE expires_at < $1", [at]);
}

// ---------------------------------------------------------------- small state
export async function getState(db, key) {
  const r = await db.query("SELECT value FROM state WHERE key = $1", [key]);
  return r.rows[0]?.value;
}

export async function setState(db, key, value) {
  await db.query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, String(value)]);
}

export async function addCall(db, day, model) {
  await db.query("INSERT INTO usage (day, model, calls) VALUES ($1, $2, 1) ON CONFLICT (day, model) DO UPDATE SET calls = usage.calls + 1", [day, model]);
}

export async function callsToday(db, day) {
  const r = await db.query("SELECT COALESCE(SUM(calls), 0)::int AS n FROM usage WHERE day = $1", [day]);
  return r.rows[0].n;
}

// ---------------------------------------------------------------- proposals
/** A candidate is published once the AI accepted it and enough different connections sent it. */
export async function publishIfReady(db, id, minConfirmations) {
  await db.query(
    `UPDATE candidates c SET published_at = now(), published_seq = nextval('published_seq')::int
     WHERE c.id = $1 AND c.published_at IS NULL AND c.ai_status = 'ok' AND NOT c.blocked AND c.confirmations >= $2
       AND NOT EXISTS (
         SELECT 1 FROM candidates o
         WHERE o.id <> c.id AND o.reading = c.reading AND o.src = c.src AND lower(o.term) = lower(c.term)
           AND o.published_at IS NOT NULL AND NOT o.blocked)`,
    [id, minConfirmations],
  );
}

/** Stores a batch: new candidates, and one vote per installation. Returns what was new. */
export async function submit(db, { installHash, ipHash, reading, terms, minConfirmations }) {
  let added = 0;
  let repeated = 0;
  let ignored = 0;
  await db.tx(async (tx) => {
    for (const t of terms) {
      const key = keyOf(reading, t);
      let c = (
        await tx.query(
          `INSERT INTO candidates (key, reading, src, term, translation, keep, definition)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (key) DO NOTHING RETURNING id, ai_status`,
          [key, reading, t.src, t.term, t.translation, t.keep, t.definition],
        )
      ).rows[0];
      if (!c) c = (await tx.query("SELECT id, ai_status FROM candidates WHERE key = $1", [key])).rows[0];
      // Already judged unfit: no vote is kept for it.
      if (c.ai_status === "bad") {
        ignored++;
        continue;
      }
      const v = await tx.query("INSERT INTO votes (candidate_id, install_hash, ip_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING candidate_id", [c.id, installHash, ipHash]);
      if (!v.rows.length) {
        repeated++;
        continue;
      }
      added++;
      // Distinct connections, not installations: one person with three installs counts once.
      await tx.query("UPDATE candidates SET confirmations = (SELECT COUNT(DISTINCT ip_hash)::int FROM votes WHERE candidate_id = $1) WHERE id = $1", [c.id]);
      await publishIfReady(tx, c.id, minConfirmations);
    }
  });
  return { added, repeated, ignored };
}

/** Candidates the AI has not judged yet, the best confirmed first. */
export async function pendingBatch(db, limit) {
  const r = await db.query(
    `SELECT id, reading, src, term, translation, keep, definition FROM candidates
     WHERE ai_status = 'pending' AND NOT blocked AND ai_attempts < 5
     ORDER BY confirmations DESC, created_at LIMIT $1`,
    [limit],
  );
  return r.rows;
}

/** Records the AI's answers; items it left out are counted as one more attempt. */
export async function setVerdicts(db, batch, verdicts, model, minConfirmations) {
  for (const item of batch) {
    const v = verdicts.get(item.id);
    if (!v) {
      await db.query("UPDATE candidates SET ai_attempts = ai_attempts + 1 WHERE id = $1", [item.id]);
      continue;
    }
    await db.query(
      "UPDATE candidates SET ai_status = $2, ai_reason = $3, ai_model = $4, verified_at = now() WHERE id = $1 AND ai_status = 'pending'",
      [item.id, v.ok ? "ok" : "bad", String(v.reason ?? "").slice(0, 120), model],
    );
    if (v.ok) await publishIfReady(db, item.id, minConfirmations);
  }
}

export async function bumpAttempts(db, ids) {
  for (const id of ids) await db.query("UPDATE candidates SET ai_attempts = ai_attempts + 1 WHERE id = $1", [id]);
}

// ---------------------------------------------------------------- reading
export async function lexicon(db, { reading, since, limit }) {
  const r = await db.query(
    `SELECT published_seq AS seq, src, term, translation, keep, definition FROM candidates
     WHERE reading = $1 AND published_at IS NOT NULL AND NOT blocked AND published_seq > $2
     ORDER BY published_seq LIMIT $3`,
    [reading, since, limit + 1],
  );
  const more = r.rows.length > limit;
  const rows = more ? r.rows.slice(0, limit) : r.rows;
  return { rows, more, cursor: rows.length ? rows[rows.length - 1].seq : since };
}

// ---------------------------------------------------------------- admin
export async function stats(db) {
  const by = await db.query("SELECT ai_status, COUNT(*)::int AS n FROM candidates GROUP BY ai_status");
  const one = async (sql) => (await db.query(sql)).rows[0].n;
  return {
    byStatus: Object.fromEntries(by.rows.map((r) => [r.ai_status, r.n])),
    published: await one("SELECT COUNT(*)::int AS n FROM candidates WHERE published_at IS NOT NULL AND NOT blocked"),
    blocked: await one("SELECT COUNT(*)::int AS n FROM candidates WHERE blocked"),
    deadLetters: await one("SELECT COUNT(*)::int AS n FROM candidates WHERE ai_status = 'pending' AND ai_attempts >= 5"),
    votes: await one("SELECT COUNT(*)::int AS n FROM votes"),
  };
}

export async function listCandidates(db, { status, limit }) {
  const where =
    status === "published" ? "published_at IS NOT NULL AND NOT blocked" : status === "blocked" ? "blocked" : "ai_status = $2";
  const params = status === "published" || status === "blocked" ? [limit] : [limit, status];
  const r = await db.query(
    `SELECT id, reading, src, term, translation, keep, definition, ai_status, ai_reason, confirmations, blocked, published_at
     FROM candidates WHERE ${where} ORDER BY id DESC LIMIT $1`,
    params,
  );
  return r.rows;
}

/** Hides a term, and lets the next waiting translation of the same term take its place. */
export async function setBlocked(db, id, blocked, minConfirmations) {
  const r = await db.query("UPDATE candidates SET blocked = $2, published_at = CASE WHEN $2 THEN NULL ELSE published_at END WHERE id = $1 RETURNING reading, src, term", [id, blocked]);
  const row = r.rows[0];
  if (!row) return false;
  if (blocked) {
    const next = await db.query(
      "SELECT id FROM candidates WHERE reading = $1 AND src = $2 AND lower(term) = lower($3) AND published_at IS NULL AND NOT blocked AND ai_status = 'ok' ORDER BY confirmations DESC, id LIMIT 1",
      [row.reading, row.src, row.term],
    );
    if (next.rows[0]) await publishIfReady(db, next.rows[0].id, minConfirmations);
  }
  return true;
}
