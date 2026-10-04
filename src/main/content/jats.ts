import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { Block } from "@shared/types";
import { absolutize, escapeText, mathHtml, tableHtml } from "./html";

/**
 * JATS is the XML format used by PubMed Central, bioRxiv, PLOS and eLife.
 * This turns the <abstract> and <body> into reading blocks.
 */
export interface JatsImages {
  resolve: (href: string, fig: Element) => string | undefined;
}

const tagName = (e: Element) => e.name.toLowerCase().replace(/^[a-z]+:/, (p) => (p === "mml:" ? "" : p));

export function jatsToBlocks(xmlText: string, images: JatsImages, base: string): { blocks: Block[]; title?: string } {
  const $ = cheerio.load(xmlText, { xml: true });

  const inline = (el: AnyNode): string => {
    const out: string[] = [];
    const walk = (n: AnyNode) => {
      if (n.type === "text") {
        out.push(escapeText((n as any).data ?? ""));
        return;
      }
      if (n.type !== "tag") return;
      const e = n as Element;
      const name = tagName(e);
      const kids = () => e.children.forEach(walk);
      switch (name) {
        case "italic":
          out.push("<em>"), kids(), out.push("</em>");
          return;
        case "bold":
          out.push("<strong>"), kids(), out.push("</strong>");
          return;
        case "sup":
        case "sub":
          out.push(`<${name}>`), kids(), out.push(`</${name}>`);
          return;
        case "monospace":
          out.push("<code>"), kids(), out.push("</code>");
          return;
        case "xref":
          out.push('<span class="ref">'), kids(), out.push("</span>");
          return;
        case "ext-link":
        case "uri": {
          const href = e.attribs?.["xlink:href"] ?? $(e).text();
          out.push(`<a href="${escapeText(absolutize(href, base)).replace(/"/g, "&quot;")}">`), kids(), out.push("</a>");
          return;
        }
        case "break":
          out.push("<br>");
          return;
        case "math":
          out.push(mathHtml($, e));
          return;
        case "inline-formula": {
          const m = $(e).find("mml\\:math, math").first();
          if (m.length) out.push(mathHtml($, m[0] as Element));
          else {
            const tex = $(e).find("tex-math").text();
            out.push(`<code>${escapeText(tex || $(e).text())}</code>`);
          }
          return;
        }
        case "fn":
        case "label":
        case "alternatives":
          if (name === "alternatives") {
            const m = $(e).children("mml\\:math, math").first();
            if (m.length) out.push(mathHtml($, m[0] as Element));
          }
          return;
        case "inline-graphic":
          return;
        default:
          kids();
      }
    };
    for (const c of (el as Element).children ?? []) walk(c);
    return out.join("").replace(/\s+/g, " ").trim();
  };

  const blocks: Block[] = [];
  const textLen = (h: string) => h.replace(/<[^>]+>/g, "").trim().length;

  const figure = (e: Element) => {
    const label = $(e).children("label").text().trim().replace(/[.:]$/, "");
    const cap = $(e).children("caption");
    const capHtml = [label ? `<strong>${escapeText(label)}.</strong>` : "", ...cap.children().toArray().map((c) => inline(c))]
      .filter(Boolean)
      .join(" ");
    const srcs = $(e)
      .find("graphic")
      .toArray()
      .map((g) => images.resolve((g as Element).attribs?.["xlink:href"] ?? "", e))
      .filter((s): s is string => !!s);
    if (srcs.length) blocks.push({ t: "fig", src: [...new Set(srcs)], label, segs: [capHtml] });
  };

  const tableWrap = (e: Element) => {
    const label = $(e).children("label").text().trim().replace(/[.:]$/, "");
    const cap = $(e).children("caption");
    const capHtml = [label ? `<strong>${escapeText(label)}.</strong>` : "", ...cap.children().toArray().map((c) => inline(c))]
      .filter(Boolean)
      .join(" ");
    const table = $(e).find("table").first();
    if (table.length) {
      const html = tableHtml($ as any, table[0] as Element, base);
      if (html) {
        blocks.push({ t: "table", html, label, segs: [capHtml] });
        return;
      }
    }
    const g = $(e).find("graphic").first();
    if (g.length) {
      const src = images.resolve((g[0] as Element).attribs?.["xlink:href"] ?? "", e);
      if (src) blocks.push({ t: "fig", src: [src], label, segs: [capHtml] });
    }
  };

  const formula = (e: Element) => {
    const m = $(e).find("mml\\:math, math").first();
    if (m.length) blocks.push({ t: "eq", html: mathHtml($, m[0] as Element) });
    else {
      const tex = $(e).find("tex-math").text().trim();
      if (tex) blocks.push({ t: "code", text: tex });
    }
  };

  const list = (e: Element) => {
    const items = $(e)
      .children("list-item")
      .toArray()
      .map((li) =>
        $(li)
          .children()
          .toArray()
          .map((c) => inline(c))
          .join(" "),
      )
      .filter((h) => textLen(h));
    const type = e.attribs?.["list-type"] ?? "";
    if (items.length) blocks.push({ t: "li", ordered: /order|alpha|roman/.test(type), segs: items });
  };

  /** A <p> may contain block children (figures, formulas, lists): split around them. */
  const paragraph = (e: Element) => {
    let buf: AnyNode[] = [];
    const flush = () => {
      if (!buf.length) return;
      const html = inline({ type: "tag", name: "p", children: buf } as any);
      if (textLen(html) > 1 || /<math/.test(html)) blocks.push({ t: "p", segs: [html] });
      buf = [];
    };
    for (const c of e.children) {
      if (c.type === "tag") {
        const n = tagName(c as Element);
        if (n === "fig" || n === "fig-group") {
          flush();
          $(c).find("fig").addBack("fig").each((_, f) => figure(f as Element));
          continue;
        }
        if (n === "table-wrap") {
          flush();
          tableWrap(c as Element);
          continue;
        }
        if (n === "disp-formula") {
          flush();
          formula(c as Element);
          continue;
        }
        if (n === "list") {
          flush();
          list(c as Element);
          continue;
        }
        if (n === "disp-quote") {
          flush();
          const html = inline(c);
          if (textLen(html)) blocks.push({ t: "quote", segs: [html] });
          continue;
        }
      }
      buf.push(c);
    }
    flush();
  };

  const section = (el: Element, depth: number) => {
    for (const c of el.children) {
      if (c.type !== "tag") continue;
      const e = c as Element;
      const n = tagName(e);
      if (n === "title") {
        const html = inline(e);
        if (textLen(html)) blocks.push({ t: "h", level: Math.min(depth + 1, 5), segs: [html] });
      } else if (n === "sec" || n === "boxed-text") section(e, depth + 1);
      else if (n === "p") paragraph(e);
      else if (n === "fig") figure(e);
      else if (n === "fig-group") $(e).find("fig").each((_, f) => figure(f as Element));
      else if (n === "table-wrap") tableWrap(e);
      else if (n === "disp-formula") formula(e);
      else if (n === "list") list(e);
      else if (n === "disp-quote") {
        const html = inline(e);
        if (textLen(html)) blocks.push({ t: "quote", segs: [html] });
      } else if (n === "supplementary-material" || n === "label") continue;
      else section(e, depth);
    }
  };

  const article = $("article").first();
  const front = article.children("front").first();
  const title = front.find("article-title").first().text().replace(/\s+/g, " ").trim() || undefined;

  // Abstract (the main one, not the graphical/teaser ones).
  const abstracts = front.find("abstract").toArray() as Element[];
  const mainAbs = abstracts.find((a) => !a.attribs?.["abstract-type"]) ?? abstracts[0];
  if (mainAbs) {
    blocks.push({ t: "h", level: 2, segs: ["Abstract"] });
    section(mainAbs, 1);
    // The abstract's own <title> duplicates our heading.
    const i = blocks.findIndex((b, k) => k > 0 && b.t === "h" && /^abstract$/i.test(b.segs[0].replace(/<[^>]+>/g, "")));
    if (i > 0) blocks.splice(i, 1);
  }

  const body = article.children("body").first();
  if (body.length) section(body[0] as Element, 1);

  // Floating figures/tables that sit in <floats-group> (PMC) are appended at the end.
  article
    .children("floats-group")
    .children()
    .each((_, f) => {
      const n = tagName(f as Element);
      if (n === "fig") figure(f as Element);
      else if (n === "table-wrap") tableWrap(f as Element);
    });

  const refs = article.children("back").find("ref").toArray();
  if (refs.length) {
    const items = refs
      .map((r) => {
        const cit = $(r).find("mixed-citation, element-citation, citation").first();
        return (cit.length ? cit.text() : $(r).text()).replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);
    if (items.length) blocks.push({ t: "refs", items });
  }

  return { blocks, title };
}
