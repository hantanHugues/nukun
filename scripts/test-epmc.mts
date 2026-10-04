import { FETCHERS } from "../src/main/sources/index";
import { INTEREST_CATALOG } from "../src/shared/interests";
const ids = process.argv.slice(2);
const interests = INTEREST_CATALOG.filter((i) => ids.includes(i.id));
const r = await FETCHERS.europepmc({ fields: new Set(interests.flatMap((i) => i.fields)), languages: new Set(["en"]), known: new Set(), interests });
const by: Record<string, number> = {};
for (const a of r) by[a.domain] = (by[a.domain] ?? 0) + 1;
console.log(r.length, by);
for (const a of r.slice(0, 6)) console.log(" ", a.domain, a.title.slice(0, 90));
