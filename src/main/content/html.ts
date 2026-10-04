import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { Block } from "@shared/types";

type $T = cheerio.CheerioAPI;

const INLINE_KEEP = new Set(["a", "em", "i", "strong", "b", "sup", "sub", "code", "br", "span", "u", "small", "mark"]);
const MATHML = new Set([
  "math", "semantics", "mrow", "mi", "mo", "mn", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot", "mtext",
  "mspace", "mtable", "mtr", "mtd", "mover", "munder", "munderover", "mstyle", "mpadded", "mphantom", "menclose",
  "mfenced", "mmultiscripts", "mprescripts", "none", "merror", "ms", "mlabeledtr",
]);
const MATH_ATTRS = new Set(["display", "mathvariant", "stretchy", "fence", "separator", "lspace", "rspace", "accent", "accentunder", "columnalign", "rowspacing", "columnspacing", "displaystyle", "scriptlevel", "linethickness", "width", "height", "depth", "form", "largeop", "movablelimits", "symmetric", "minsize", "maxsize", "notation", "open", "close", "separators"]);

export function absolutize(url: string, base: string) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** Reduce an element's children to safe inline HTML (formatting, links, MathML). */
export function inlineHtml($: $T, el: AnyNode, base: string): string {
  const parts: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      parts.push(escapeText((node as any).data ?? ""));
      return;
    }
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return;
    const e = node as Element;
    const name = e.name.toLowerCase().replace(/^mml:/, "");
    if (["script", "style", "annotation", "annotation-xml", "button", "svg", "noscript"].includes(name)) return;
    if (name === "math") {
      parts.push(mathHtml($, e));
      return;
    }
    if (name === "img") return; // images inside paragraphs are icons or inline glyphs we skip
    if (INLINE_KEEP.has(name)) {
      if (name === "br") {
        parts.push("<br>");
        return;
      }
      const tag = name === "i" ? "em" : name === "b" ? "strong" : name === "span" || name === "u" || name === "small" || name === "mark" ? "span" : name;
      let attrs = "";
      if (tag === "a") {
        const href = e.attribs?.href;
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) attrs = ` href="${escapeAttr(absolutize(href, base))}"`;
        else attrs = ` class="ref"`;
      }
      parts.push(`<${tag}${attrs}>`);
      for (const c of e.children) walk(c);
      parts.push(`</${tag}>`);
      return;
    }
    for (const c of e.children) walk(c);
  };
  for (const c of (el as Element).children ?? []) walk(c);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function mathHtml($: $T, el: Element): string {
  const out: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      out.push(escapeText((node as any).data ?? ""));
      return;
    }
    if (node.type !== "tag") return;
    const e = node as Element;
    const name = e.name.toLowerCase().replace(/^mml:/, "");
    if (name === "annotation" || name === "annotation-xml") return;
    if (!MATHML.has(name)) {
      for (const c of e.children) walk(c);
      return;
    }
    const attrs = Object.entries(e.attribs ?? {})
      .filter(([k]) => MATH_ATTRS.has(k.replace(/^mml:/, "")))
      .map(([k, v]) => ` ${k.replace(/^mml:/, "")}="${escapeAttr(v)}"`)
      .join("");
    out.push(`<${name}${attrs}>`);
    for (const c of e.children) walk(c);
    out.push(`</${name}>`);
  };
  walk(el);
  return out.join("");
}

export function escapeText(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string) {
  return escapeText(s).replace(/"/g, "&quot;");
}

/** Clean a table: keep structure and cell content only. */
export function tableHtml($: $T, table: Element, base: string): string {
  const rows: string[] = [];
  $(table)
    .find("tr")
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .children("th,td")
        .each((_, c) => {
          const tag = (c as Element).name === "th" ? "th" : "td";
          const span = ["colspan", "rowspan"]
            .map((k) => ((c as Element).attribs?.[k] ? ` ${k}="${Number((c as Element).attribs[k]) || 1}"` : ""))
            .join("");
          cells.push(`<${tag}${span}>${inlineHtml($, c, base)}</${tag}>`);
        });
      if (cells.length) rows.push(`<tr>${cells.join("")}</tr>`);
    });
  return rows.length ? `<table>${rows.join("")}</table>` : "";
}

const textLen = (html: string) => html.replace(/<[^>]+>/g, "").trim().length;

export interface WalkOptions {
  base: string;
  /** Resolve an <img> to the best full-size URL. */
  image?: (img: Element) => string | undefined;
  /** Elements to ignore entirely (navigation, buttons, ads…). */
  skip?: string;
  /** Keep embedded data: images (documents converted locally). */
  allowData?: boolean;
}

/**
 * Generic HTML → blocks walker. It recognises headings, paragraphs, lists, figures,
 * tables and display equations, and recurses through any wrapper element.
 */
export function htmlToBlocks($: $T, root: AnyNode, opts: WalkOptions): Block[] {
  const blocks: Block[] = [];
  const imgSrc = (img: Element) =>
    opts.image?.(img) ?? absolutize(img.attribs?.["data-src"] || img.attribs?.src || "", opts.base);

  const pushP = (html: string) => {
    if (textLen(html) > 1 || /<math/.test(html)) blocks.push({ t: "p", segs: [html] });
  };

  const walk = (node: AnyNode) => {
    if (node.type !== "tag") return;
    const e = node as Element;
    if (opts.skip && $(e).is(opts.skip)) return;
    const name = e.name.toLowerCase();
    const cls = e.attribs?.class ?? "";

    if (/^h[1-6]$/.test(name)) {
      const html = inlineHtml($, e, opts.base);
      if (textLen(html)) blocks.push({ t: "h", level: Number(name[1]), segs: [html] });
      return;
    }
    if (name === "p") {
      pushP(inlineHtml($, e, opts.base));
      return;
    }
    if (name === "ul" || name === "ol") {
      const items = $(e)
        .children("li")
        .toArray()
        .map((li) => inlineHtml($, li, opts.base))
        .filter((h) => textLen(h));
      if (items.length) blocks.push({ t: "li", ordered: name === "ol", segs: items });
      return;
    }
    if (name === "blockquote") {
      const html = inlineHtml($, e, opts.base);
      if (textLen(html)) blocks.push({ t: "quote", segs: [html] });
      return;
    }
    if (name === "pre") {
      blocks.push({ t: "code", text: $(e).text() });
      return;
    }
    if (name === "table" && /ltx_equation/.test(cls)) {
      const maths = $(e).find("math").toArray();
      if (maths.length) blocks.push({ t: "eq", html: maths.map((m) => mathHtml($, m as Element)).join("<br>") });
      return;
    }
    if (name === "math") {
      blocks.push({ t: "eq", html: mathHtml($, e) });
      return;
    }
    if (name === "table") {
      const html = tableHtml($, e, opts.base);
      if (html) blocks.push({ t: "table", html, segs: [""] });
      return;
    }
    if (name === "figure" || /c-article-section__figure|ltx_figure/.test(cls)) {
      const table = $(e).find("table").first();
      const caption = $(e).find("figcaption, .c-article-section__figure-description").first();
      const capHtml = caption.length ? inlineHtml($, caption[0], opts.base) : "";
      if (table.length && !$(e).find("img").length) {
        const html = tableHtml($, table[0] as Element, opts.base);
        if (html) blocks.push({ t: "table", html, segs: [capHtml] });
        return;
      }
      const srcs = $(e)
        .find("img")
        .toArray()
        .map((i) => imgSrc(i as Element))
        .filter((s): s is string => !!s && (opts.allowData || !s.startsWith("data:")));
      if (srcs.length) {
        blocks.push({ t: "fig", src: [...new Set(srcs)], segs: [capHtml] });
        return;
      }
      if (capHtml) pushP(capHtml);
      return;
    }
    if (name === "img") {
      const s = imgSrc(e);
      if (s && (opts.allowData || !s.startsWith("data:"))) blocks.push({ t: "fig", src: [s], segs: [""] });
      return;
    }
    // LaTeXML wraps paragraphs in div.ltx_para > p; other sites use plain wrappers.
    for (const c of e.children) walk(c);
  };

  for (const c of (root as Element).children ?? []) walk(c);
  return blocks;
}
