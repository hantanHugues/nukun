import type { Block } from "@shared/types";
import { escapeText } from "./html";

interface Line {
  text: string;
  size: number;
  y: number;
  x: number;
  page: number;
}

/**
 * Extracts readable paragraphs from a PDF. Figures stay in the original PDF,
 * which the reader shows in "Original" mode.
 */
export async function pdfToBlocks(data: Uint8Array): Promise<Block[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const lines: Line[] = [];
  const maxPages = Math.min(doc.numPages, 60);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let cur: Line | null = null;
    for (const it of content.items as any[]) {
      if (typeof it.str !== "string") continue;
      const [, , , d, x, y] = it.transform as number[];
      const size = Math.abs(d) || it.height || 10;
      if (cur && Math.abs(cur.y - y) < size * 0.5) {
        cur.text += (needsSpace(cur.text, it.str) ? " " : "") + it.str;
      } else {
        if (cur && cur.text.trim()) lines.push(cur);
        cur = { text: it.str, size, y, x, page: p };
      }
      if (it.hasEOL && cur) {
        if (cur.text.trim()) lines.push(cur);
        cur = null;
      }
    }
    if (cur && cur.text.trim()) lines.push(cur);
    page.cleanup();
  }
  await task.destroy();

  // Body font size = most common size, weighted by characters.
  const sizes = new Map<number, number>();
  for (const l of lines) {
    const s = Math.round(l.size * 2) / 2;
    sizes.set(s, (sizes.get(s) ?? 0) + l.text.length);
  }
  const bodySize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;

  // Drop running headers/footers: short lines repeated on many pages, and bare page numbers.
  const freq = new Map<string, number>();
  for (const l of lines) {
    const k = l.text.trim().replace(/\d+/g, "#");
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const kept = lines.filter((l) => {
    const t = l.text.trim();
    if (/^\d{1,3}$/.test(t)) return false;
    const k = t.replace(/\d+/g, "#");
    return !(t.length < 90 && (freq.get(k) ?? 0) > Math.max(3, maxPages / 2));
  });

  const blocks: Block[] = [];
  let para: string[] = [];
  let prev: Line | null = null;
  const flush = () => {
    const text = para.join(" ").replace(/(\w)- (\w)/g, "$1$2").replace(/\s+/g, " ").trim();
    if (text.length > 1) blocks.push({ t: "p", segs: [escapeText(text)] });
    para = [];
  };
  for (const l of kept) {
    const t = l.text.trim();
    const isHeading =
      l.size > bodySize * 1.15 && t.length < 120 && !/[.,;]$/.test(t) && /[A-Za-z]/.test(t);
    const numberedHeading = /^(\d+(\.\d+)*\.?|[IVX]+\.)\s+[A-Z][^.]{2,80}$/.test(t) && t.length < 90 && l.size >= bodySize;
    if (isHeading || numberedHeading) {
      flush();
      blocks.push({ t: "h", level: l.size > bodySize * 1.5 ? 2 : 3, segs: [escapeText(t)] });
      prev = l;
      continue;
    }
    if (/^references$|^bibliography$/i.test(t)) break; // stop before the reference list
    if (prev) {
      const gap = prev.page === l.page ? prev.y - l.y : 0;
      const newPara = gap > l.size * 1.7 || (prev.page === l.page && l.x - prev.x > l.size * 1.2) || /[.:]$/.test(prev.text.trim()) && gap > l.size * 1.3;
      if (newPara) flush();
    }
    para.push(t);
    prev = l;
  }
  flush();
  // Text scattered inside figures comes out as tiny fragments: drop them.
  return blocks.filter((b) => {
    if (b.t !== "p") return true;
    const t = b.segs[0];
    return t.length >= 40 || /[.!?:]$/.test(t);
  });
}

function needsSpace(a: string, b: string) {
  return !!a && !a.endsWith(" ") && !b.startsWith(" ") && !a.endsWith("-");
}
