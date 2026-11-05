const int = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** Everything the server reads from its environment, with safe defaults. */
export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? "",
    allowMemoryDb: env.ALLOW_MEMORY_DB === "1",
    geminiKey: env.GEMINI_API_KEY ?? "",
    /** Only changed to try the server against a stand-in for Google. */
    geminiBaseUrl: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com",
    adminToken: env.ADMIN_TOKEN ?? "",
    ipSalt: env.IP_SALT ?? "",
    challengeSecret: env.CHALLENGE_SECRET ?? "",
    /** Difficulty of the proof of work, in leading zero bits (18 is about a quarter of a second). */
    powBits: int(env.POW_BITS, 18),
    /** Different connections that must send the same term before it is published. */
    minConfirmations: int(env.MIN_CONFIRMATIONS, 3),
    /** Most Gemini calls a day, whatever the quota: the key's allowance is never emptied. */
    geminiMaxCallsPerDay: int(env.GEMINI_MAX_CALLS_PER_DAY, 200),
    /** Terms checked in one Gemini call. */
    verifyBatch: int(env.VERIFY_BATCH, 20),
    /** Proxies between the Internet and the server (Render adds one). */
    trustProxyHops: int(env.TRUST_PROXY_HOPS, 1),
    limits: {
      challengesPerHour: int(env.LIMIT_CHALLENGES_PER_HOUR, 60),
      readsPerHour: int(env.LIMIT_READS_PER_HOUR, 120),
      ipSubmissionsPerDay: int(env.LIMIT_IP_SUBMISSIONS_PER_DAY, 20),
      ipTermsPerDay: int(env.LIMIT_IP_TERMS_PER_DAY, 400),
      installSubmissionsPerDay: int(env.LIMIT_INSTALL_SUBMISSIONS_PER_DAY, 2),
      installTermsPerDay: int(env.LIMIT_INSTALL_TERMS_PER_DAY, 120),
      globalTermsPerDay: int(env.LIMIT_GLOBAL_TERMS_PER_DAY, 5000),
    },
  };
}

/** What must be set before the server starts in production. */
export function configProblems(c) {
  const out = [];
  if (!c.databaseUrl && !c.allowMemoryDb) out.push("DATABASE_URL manquante");
  if (c.ipSalt.length < 16) out.push("IP_SALT manquant ou trop court (16 caractères au moins)");
  if (c.challengeSecret.length < 16) out.push("CHALLENGE_SECRET manquant ou trop court (16 caractères au moins)");
  if (c.adminToken.length < 24) out.push("ADMIN_TOKEN manquant ou trop court (24 caractères au moins)");
  return out;
}
