/**
 * Preparing text for the small built-in translators. They translate one sentence at a
 * time and damage what is not plain text, so formulas (⟦n⟧) and inline tags are cut out,
 * the plain pieces between them are translated alone, and everything is put back in place.
 * Pure functions: no Electron, no model, testable on their own.
 */

const KEEP = /(⟦\d+⟧|<\/?(?:sup|sub)\s*>|<br\s*\/?>)/;
/** Emphasis is dropped (a word in italics cannot be translated alone without breaking its sentence). */
const EMPHASIS = /<\/?(?:em|strong|i|b)\s*>/g;
const HAS_WORDS = /\p{L}{2,}/u;
const MAX_CHUNK = 320;

interface Unit {
  /** Index of the text it belongs to. */
  text: number;
  /** Leading and trailing spaces, put back around the translation. */
  pre: string;
  post: string;
  /** What the model gets, or undefined for a piece that is kept as it is. */
  job?: number;
  raw: string;
}

/** A sentence-sized chunk per job; long passages are cut at sentence ends. */
function chunks(s: string): string[] {
  if (s.length <= MAX_CHUNK) return [s];
  const out: string[] = [];
  let cur = "";
  for (const sentence of s.split(/(?<=[.!?;。！？])\s+/u)) {
    if (cur && cur.length + sentence.length + 1 > MAX_CHUNK) {
      out.push(cur);
      cur = sentence;
    } else cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur) out.push(cur);
  // A "sentence" that is still too long (no punctuation): cut at a space.
  return out.flatMap((c) => {
    if (c.length <= MAX_CHUNK * 1.6) return [c];
    const words = c.split(" ");
    const parts: string[] = [];
    let p = "";
    for (const w of words) {
      if (p && p.length + w.length + 1 > MAX_CHUNK) {
        parts.push(p);
        p = w;
      } else p = p ? `${p} ${w}` : w;
    }
    if (p) parts.push(p);
    return parts;
  });
}

/** The translation starts like the source: lower case after a formula stays lower case. */
export function matchCase(src: string, out: string): string {
  const s = src.match(/\p{L}/u)?.[0];
  const o = out.match(/\p{L}/u)?.[0];
  if (!s || !o) return out;
  const i = out.indexOf(o);
  const second = out.slice(i + 1, i + 2);
  // Not an acronym or a name written in capitals ("T cells", "RNA").
  if (s === s.toLowerCase() && o !== o.toLowerCase() && second === second.toLowerCase()) return out.slice(0, i) + o.toLowerCase() + out.slice(i + 1);
  if (s !== s.toLowerCase() && o === o.toLowerCase()) return out.slice(0, i) + o.toUpperCase() + out.slice(i + 1);
  return out;
}

export interface Plan {
  /** The pieces to hand to the model. */
  jobs: string[];
  /** Rebuilds the full texts from the model's output (same order as `jobs`). */
  build(outputs: string[]): string[];
}

export function plan(texts: string[]): Plan {
  const jobs: string[] = [];
  // For each text, its pieces in order; a "group" is the chunks of one plain piece.
  const layout: { kept?: string; first?: number; count?: number; pre?: string; post?: string; raw?: string }[][] = texts.map((text) =>
    text.replace(EMPHASIS, "").split(KEEP).map((piece) => {
      if (!piece) return { kept: "" };
      if (KEEP.test(piece) && piece.match(KEEP)?.[0] === piece) return { kept: piece };
      if (!HAS_WORDS.test(piece)) return { kept: piece };
      const pre = piece.match(/^\s*/)![0];
      const post = piece.match(/\s*$/)![0];
      const core = piece.trim();
      const parts = chunks(core);
      const first = jobs.length;
      jobs.push(...parts);
      return { first, count: parts.length, pre, post, raw: core };
    }),
  );
  return {
    jobs,
    build(outputs) {
      return layout.map((pieces) =>
        pieces
          .map((p) => {
            if (p.kept !== undefined) return p.kept;
            const out = outputs.slice(p.first!, p.first! + p.count!).join(" ").trim();
            return `${p.pre}${matchCase(p.raw!, out)}${p.post}`;
          })
          .join(""),
      );
    },
  };
}
