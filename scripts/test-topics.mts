import { searchTopics } from "../src/main/sources/index";
for (const q of process.argv.slice(2)) { const t = Date.now(); const r = await searchTopics(q); console.log(q, Date.now() - t, "ms", r.map((h) => `${h.name} (${h.count})`).join(" | ")); }
