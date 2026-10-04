// How long each source takes for a set of interests (catalogue ids as arguments).
import { FETCHERS } from "../src/main/sources/index";
import { fieldsOf, INTEREST_CATALOG } from "../src/shared/interests";
const interests = INTEREST_CATALOG.filter((i) => process.argv.slice(2).includes(i.id));
const o = { fields: new Set(fieldsOf(interests)), languages: new Set(["en", "fr"]), known: new Set<string>(), interests, explore: new Set(["32"]) };
await Promise.all(
  Object.entries(FETCHERS).map(async ([id, f]) => {
    const t = Date.now();
    try {
      const r = await (f as any)(o);
      console.log(String(((Date.now() - t) / 1000).toFixed(1)).padStart(6), "s", id, r.length);
    } catch (e) {
      console.log(String(((Date.now() - t) / 1000).toFixed(1)).padStart(6), "s", id, "ERREUR", String(e).slice(0, 80));
    }
  }),
);
