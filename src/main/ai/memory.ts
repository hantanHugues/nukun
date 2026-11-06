import { createHash } from "node:crypto";
import type { GlossaryTerm } from "@shared/types";
import { findKnown } from "@shared/glossaryMatch";
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

/** French translations keep their original keys; other reading languages are prefixed. */
const trKey = (text: string, target = "fr") => keyOf(target === "fr" ? text : `${target}|${text}`);

export function recall(text: string, target = "fr"): string | undefined {
  return mem().data[trKey(text, target)];
}

export function remember(text: string, fr: string, target = "fr") {
  const d = mem();
  d.data[trKey(text, target)] = fr;
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

export function recallExplanation(passage: string, target = "fr") {
  return expl().data[trKey(passage.toLowerCase(), target)];
}

export function rememberExplanation(passage: string, a: string, by: string, target = "fr") {
  const d = expl();
  d.data[trKey(passage.toLowerCase(), target)] = { a, by };
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

/**
 * The shared lexicon downloaded from the Nùkún server (lexicon.ts), by reading language.
 * Keyed "<source language>:<lower-case term>". What this reader decided always wins.
 */
type Common = { fr: Record<string, GlossaryTerm>; en: Record<string, GlossaryTerm> };
const MAX_COMMON = 20000;
let commonDoc: JsonDoc<Common> | null = null;
const commonOf = (reading: "fr" | "en") => {
  commonDoc ??= new JsonDoc<Common>("common-lexicon.json", { fr: {}, en: {} });
  return (commonDoc.data[reading] ??= {});
};
const commonKey = (src: string, term: string) => `${src}:${term.toLowerCase().trim()}`;

/** Known terms that appear in a text (whole words): the reader's own, most used first, then the shared lexicon's. */
export function recallGlossary(text: string, lang: string): GlossaryTerm[] {
  const own = findKnown(text, `${lang}:`, Object.entries(gloss().data)).sort((x, y) => y.uses - x.uses);
  const m = /^(en<)?(.+)$/.exec(lang);
  const shared = m ? findKnown(text, `${m[2]}:`, Object.entries(commonOf(m[1] ? "en" : "fr"))) : [];
  const have = new Set(own.map((t) => t.term.toLowerCase()));
  return [...own.map(({ uses: _u, ...t }) => t), ...shared.filter((t) => !have.has(t.term.toLowerCase()))];
}

/** Adds the terms the server published; a full refresh replaces what was there (blocked terms go away). */
export function mergeCommon(reading: "fr" | "en", terms: (GlossaryTerm & { src: string })[], replace: boolean) {
  if (!commonDoc) commonOf(reading);
  if (replace) commonDoc!.data[reading] = {};
  const d = commonOf(reading);
  for (const { src, ...t } of terms) d[commonKey(src, t.term)] = t;
  const keys = Object.keys(d);
  if (keys.length > MAX_COMMON) for (const k of keys.slice(0, keys.length - MAX_COMMON)) delete d[k];
  commonDoc!.save();
}

/** Already in the shared lexicon: there is nothing to propose. */
export function commonHas(reading: "fr" | "en", src: string, term: string) {
  return commonKey(src, term) in commonOf(reading);
}

export function commonSize() {
  return Object.keys(commonOf("fr")).length + Object.keys(commonOf("en")).length;
}

export function flushCommon() {
  commonDoc?.flush();
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

/**
 * Every learned term with its reading language and source language, to propose them to
 * the shared lexicon. Keys are "<src>:<term>" (French reading) or "en<<src>:<term>".
 */
export function glossaryEntries() {
  const out: { key: string; reading: "fr" | "en"; src: string; term: GlossaryTerm; uses: number }[] = [];
  for (const [key, t] of Object.entries(gloss().data)) {
    const m = /^(en<)?([^:<]+):/.exec(key);
    if (!m) continue;
    const { uses, ...term } = t;
    out.push({ key, reading: m[1] ? "en" : "fr", src: m[2], term, uses });
  }
  return out;
}

export function glossarySize() {
  return Object.keys(gloss().data).length;
}

export function flushGlossary() {
  glossDoc?.flush();
}
