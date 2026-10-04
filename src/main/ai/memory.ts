import { createHash } from "node:crypto";
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
