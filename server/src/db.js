/**
 * The database is Postgres. Render's disk is wiped at every restart on the free plan, so
 * the data lives in an outside Postgres (Neon, Supabase…) reached through DATABASE_URL.
 * Both openers return the same small interface: query(text, params), tx(fn), close().
 */

export async function openDb(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
  pool.on("error", (e) => console.error("[db]", e.message));
  return {
    query: (text, params) => pool.query(text, params),
    exec: (text) => pool.query(text),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn({ query: (t, p) => c.query(t, p) });
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

/** A Postgres that lives in memory: for the tests and for trying the server out. */
export async function openMemoryDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.waitReady;
  return {
    query: (text, params) => pg.query(text, params),
    exec: (text) => pg.exec(text),
    tx: (fn) => pg.transaction((t) => fn({ query: (x, y) => t.query(x, y) })),
    close: () => pg.close(),
  };
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS published_seq;

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  reading TEXT NOT NULL,
  src TEXT NOT NULL,
  term TEXT NOT NULL,
  translation TEXT NOT NULL,
  keep BOOLEAN NOT NULL,
  definition TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_reason TEXT,
  ai_model TEXT,
  ai_attempts INT NOT NULL DEFAULT 0,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  confirmations INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  published_seq INT
);
CREATE INDEX IF NOT EXISTS candidates_queue ON candidates (ai_status, confirmations DESC, created_at);
CREATE INDEX IF NOT EXISTS candidates_published ON candidates (reading, published_seq) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_term ON candidates (reading, src, lower(term));

CREATE TABLE IF NOT EXISTS votes (
  candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  install_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, install_hash)
);

CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS used_challenges (id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, model TEXT NOT NULL, calls INT NOT NULL DEFAULT 0, PRIMARY KEY (day, model));
`;

export async function migrate(db) {
  await db.exec(SCHEMA);
}
