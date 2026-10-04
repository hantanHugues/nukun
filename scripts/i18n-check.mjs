// Lists the texts passed to t("…") that have no English translation in
// src/shared/i18n-en.ts. Usage: npm run i18n:check
import fs from "node:fs";
import path from "node:path";

const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f.name) && !/^i18n(-en)?\.ts$/.test(f.name)) files.push(p);
  }
};
walk("src");

const dict = fs.readFileSync("src/shared/i18n-en.ts", "utf8");
const known = new Set();
for (const m of dict.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) known.add(JSON.parse(m[1]));

const missing = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // t("…") and t(`…`) without ${}; also t('…').
  for (const m of src.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`)/g)) {
    const raw = m[1];
    const key = raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1, -1).replace(/\\'/g, "'");
    if (!known.has(key)) missing.set(key, `${f}`);
  }
  // Texts kept in lists and translated when shown (tabs, tour steps, catalogue…):
  // `label: "…"`, `title: "…"`, `text: "…"`, `note: "…"`, `description: "…"`.
  for (const m of src.matchAll(/\b(?:label|title|text|note|description): "((?:[^"\\]|\\.)*)"/g)) {
    const key = JSON.parse(`"${m[1]}"`);
    // Names (sources, models) stay as they are; only French text matters. The AI's
    // instructions (main/ai) are not shown to the reader.
    if (f.includes(`main${path.sep}ai`)) continue;
    if (!/[àâçéèêëîïôûùü]/i.test(key) && !/\b(le|la|les|des|du|de|et|un|une|pour|avec|ton|ta|tes|en|est|sur)\b/i.test(key)) continue;
    if (!known.has(key)) missing.set(key, `${f}`);
  }
  // Suggestions listed as plain strings (discussion).
  if (f.endsWith("Discussion.tsx")) {
    for (const m of src.matchAll(/^\s+"((?:[^"\\]|\\.)*)",$/gm)) if (!known.has(m[1])) missing.set(m[1], f);
  }
}
for (const [k, f] of missing) console.log(`${f}: ${JSON.stringify(k)}`);
console.log(missing.size ? `\n${missing.size} texte(s) sans traduction anglaise.` : "Tous les textes ont leur traduction anglaise.");
process.exit(missing.size ? 1 : 0);
