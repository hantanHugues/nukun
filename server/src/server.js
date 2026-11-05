import http from "node:http";
import { configProblems, loadConfig } from "./config.js";
import { migrate, openDb, openMemoryDb } from "./db.js";
import { createGemini } from "./gemini.js";
import { createApp } from "./http.js";
import { cleanup } from "./store.js";
import { createVerifier } from "./verifier.js";

const config = loadConfig();
const problems = configProblems(config);
if (problems.length) {
  console.error("Configuration incomplète :\n- " + problems.join("\n- "));
  process.exit(1);
}

let db;
try {
  db = config.databaseUrl ? await openDb(config.databaseUrl) : await openMemoryDb();
  await migrate(db);
} catch (e) {
  console.error("Base de données injoignable ou refusée :", e.message);
  process.exit(1);
}
if (!config.databaseUrl) console.warn("Base en mémoire : les données disparaissent à l'arrêt (essai local seulement).");

const gemini = createGemini({ key: config.geminiKey, baseUrl: config.geminiBaseUrl });
if (!gemini) console.warn("GEMINI_API_KEY absente : les propositions sont reçues mais jamais vérifiées, donc jamais publiées.");
const log = { info: () => {}, warn: console.warn, error: console.error };
const verifier = createVerifier({ db, gemini, config, log });
verifier.start();

const app = createApp({ db, config, verifier, log });
const server = http.createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(config.port, "0.0.0.0", () => console.log(`Serveur du lexique prêt sur le port ${config.port}`));

const tidy = setInterval(() => cleanup(db, Date.now()).catch((e) => console.error("[nettoyage]", e.message)), 3600_000);
tidy.unref();

async function stop() {
  verifier.stop();
  clearInterval(tidy);
  server.close();
  await db.close().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
