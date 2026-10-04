import { createHash } from "node:crypto";
import type { GlossaryTerm } from "@shared/types";
import { JsonDoc } from "../store";

/**
 * Translation memory shared by every article, like a browser's translation cache:
 * a passage that was translated once is never sent to an AI again.
 * Entries are stored with their ⟦n⟧ markers, so formulas and references of the
 * article at hand are put back in place on reuse.
 */
const MAX_ENTRIES = 60000;

let doc: JsonDoc<Record<string, string>> | null = null;
const mem = () => (doc ??= new JsonDoc<Record<string, string>>("translation-memory.json", {}));

const keyOf = (text: string) => createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("base64url");

export function recall(text: string): string | undefined {
  return mem().data[keyOf(text)];
}

export function remember(text: string, fr: string) {
  const d = mem();
  d.data[keyOf(text)] = fr;
  const keys = Object.keys(d.data);
  // Oldest entries go first (object keys keep insertion order).
  if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete d.data[k];
  d.save();
}

export function memorySize() {
  return Object.keys(mem().data).length;
}

export function flushMemory() {
  doc?.flush();
}

/**
 * Explanation memory: the same passage selected again (in any article) gets its
 * explanation back without calling an AI.
 */
let explDoc: JsonDoc<Record<string, { a: string; by: string }>> | null = null;
const expl = () => (explDoc ??= new JsonDoc<Record<string, { a: string; by: string }>>("explanation-memory.json", {}));

export function recallExplanation(passage: string) {
  return expl().data[keyOf(passage.toLowerCase())];
}

export function rememberExplanation(passage: string, a: string, by: string) {
  const d = expl();
  d.data[keyOf(passage.toLowerCase())] = { a, by };
  d.save();
}

export function flushExplanations() {
  explDoc?.flush();
}

/**
 * Glossary memory shared by every article: a technical term decided once (kept in
 * English or translated, and its definition) is reused everywhere, so the AI only
 * works on new terms and the same term reads the same in every article.
 * Keyed by language and lower-case term.
 */
const MAX_TERMS = 20000;
type StoredTerm = GlossaryTerm & { uses: number };
let glossDoc: JsonDoc<Record<string, StoredTerm>> | null = null;
const gloss = () => (glossDoc ??= new JsonDoc<Record<string, StoredTerm>>("glossary-memory.json", {}));
const termKey = (lang: string, term: string) => `${lang}:${term.toLowerCase().trim()}`;

/** Known terms that appear in a text (whole words), most used first. */
export function recallGlossary(text: string, lang: string): GlossaryTerm[] {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const prefix = `${lang}:`;
  const found: StoredTerm[] = [];
  for (const [k, t] of Object.entries(gloss().data)) {
    if (!k.startsWith(prefix)) continue;
    const i = hay.indexOf(k.slice(prefix.length));
    if (i < 0) continue;
    // Whole word: "cell" must not match "cellular".
    const before = hay[i - 1];
    const after = hay[i + k.length - prefix.length];
    if (/[\p{L}\p{N}]/u.test(before ?? "") || /[\p{L}\p{N}]/u.test(after ?? "")) continue;
    found.push(t);
  }
  return found.sort((x, y) => y.uses - x.uses).map(({ uses: _u, ...t }) => t);
}

export function rememberGlossary(terms: GlossaryTerm[], lang: string) {
  const d = gloss();
  for (const t of terms) {
    if (!t.term?.trim() || t.term.length > 80) continue;
    const k = termKey(lang, t.term);
    d.data[k] = { ...t, uses: (d.data[k]?.uses ?? 0) + 1 };
  }
  const keys = Object.keys(d.data);
  if (keys.length > MAX_TERMS) for (const k of keys.slice(0, keys.length - MAX_TERMS)) delete d.data[k];
  d.save();
}

export function glossarySize() {
  return Object.keys(gloss().data).length;
}

export function flushGlossary() {
  glossDoc?.flush();
}
