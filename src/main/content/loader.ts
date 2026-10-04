import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Article, ArticleContent, Block, FullTextRef } from "@shared/types";
import { BLOCKED_MESSAGE, getBuffer, getJson, getText } from "../http";
import { epmcFindByDoi } from "../sources";
import { absolutize, escapeText, htmlToBlocks } from "./html";
import { jatsToBlocks } from "./jats";
import { pdfToBlocks } from "./pdf";
import { t } from "@shared/i18n";

type Loaded = Omit<ArticleContent, "id" | "tr">;

/** The free full text exists but is not online yet. */
export class PendingError extends Error {}

/** Fetch and parse the full text of an article into reading blocks. */
export async function loadFullText(a: Article): Promise<Loaded> {
  const loaded = await loadRef(a.fullText, a);
  // Some sources only give the body: make sure the abstract is always there.
  if (a.abstract && !loaded.blocks.some((b) => b.t === "h" && /abstract|résumé|summary/i.test(b.segs[0]))) {
    loaded.blocks.unshift({ t: "h", level: 2, segs: ["Abstract"] }, { t: "p", segs: [escapeText(a.abstract)] });
  }
  return loaded;
}

async function loadRef(ref: FullTextRef, a: Article): Promise<Loaded> {
  switch (ref.kind) {
    case "arxiv":
      return arxiv(ref.arxivId);
    case "pmc":
      return pmc(ref.pmcid, a);
    case "jats":
      return jats(ref, a);
    case "html":
      return ref.mode === "scielo" ? scielo(ref.url, ref.pdf) : ref.mode === "readable" ? readable(ref.url) : nature(ref.url);
    case "inline":
      return inline(ref.html, ref.baseUrl);
    case "pdf":
      return pdf(ref.url, a.url);
    case "osf":
      return osf(ref.preprintId, a.url);
    case "doi-lookup": {
      const hit = await epmcFindByDoi(ref.doi);
      if (!hit) throw new PendingError(t("Le texte intégral n'est pas encore disponible gratuitement pour cet article."));
      return pmc(hit.pmcid, a);
    }
  }
}

// ---------------------------------------------------------------- arXiv
async function arxiv(id: string): Promise<Loaded> {
  const pdfUrl = `https://arxiv.org/pdf/${id}`;
  const originalUrl = `https://arxiv.org/abs/${id}`;
  try {
    const html = await getText(`https://arxiv.org/html/${id}`, { browser: true, retries: 1 });
    const $ = cheerio.load(html);
    const root = $("article.ltx_document").first();
    if (!root.length) throw new Error("no html");
    root.find(".ltx_bibliography, .ltx_authors, .ltx_dates, nav, .ltx_page_footer, .ltx_note_outer, .ltx_tag_note").remove();
    // The page lives at /html/<id> without a final slash; its figures ("<id>v1/x1.png")
    // are relative to that address.
    const base = `https://arxiv.org/html/${id}`;
    // The paper title is shown by the reader header already.
    root.find("h1.ltx_title_document").remove();
    // The abstract heading is an h6 in LaTeXML; promote it.
    root.find(".ltx_abstract h6").each((_, h) => {
      (h as Element).name = "h2";
    });
    const blocks = htmlToBlocks($, root[0], {
      base,
      skip: ".ltx_role_footnote, .ltx_tag_section, button, .ltx_ERROR",
      image: (img) => (img.attribs?.src ? absolutize(img.attribs.src, base) : undefined),
    });
    // Numbering tags like "1 Introduction" are split in LaTeXML; tidy whitespace.
    for (const b of blocks) if (b.t === "h") b.segs[0] = b.segs[0].replace(/\s+/g, " ").trim();
    const bib = $(".ltx_bibliography .ltx_bibitem")
      .toArray()
      .map((e) => $(e).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (bib.length) blocks.push({ t: "refs", items: bib });
    if (blocks.filter((b) => b.t === "p").length < 3) throw new Error("html too short");
    return { blocks, pdfUrl, originalUrl };
  } catch {
    const blocks = await pdfToBlocks(await getBuffer(pdfUrl, { browser: true, timeoutMs: 60000 }));
    return { blocks, pdfUrl, originalUrl, note: "Texte extrait du PDF : les figures sont visibles dans la version originale." };
  }
}

// ---------------------------------------------------------------- PubMed Central (via Europe PMC)
async function pmcImageMap(pmcid: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const html = await getText(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`, { browser: true, retries: 1 });
    for (const m of html.matchAll(/https:\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\/[^"' )]+/g)) {
      const url = m[0];
      const stem = url.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      if (!map.has(stem)) map.set(stem, url);
    }
  } catch {
    /* figures will simply be missing */
  }
  return map;
}

async function pmc(pmcid: string, a: Article): Promise<Loaded> {
  const [xmlText, imgs] = await Promise.all([
    getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`, { timeoutMs: 45000 }),
    pmcImageMap(pmcid),
  ]);
  const originalUrl = `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;
  const { blocks } = jatsToBlocks(
    xmlText,
    { resolve: (href) => imgs.get(href.replace(/\.[a-z0-9]+$/i, "").toLowerCase()) },
    originalUrl,
  );
  return { blocks, originalUrl, pdfUrl: `https://europepmc.org/articles/${pmcid}?pdf=render` };
}

// ---------------------------------------------------------------- bioRxiv / medRxiv / PLOS / eLife
async function jats(ref: Extract<FullTextRef, { kind: "jats" }>, a: Article): Promise<Loaded> {
  let url = ref.url;
  if (ref.imageMode === "elife") {
    const meta = await getJson(`https://api.elifesciences.org/articles/${ref.articleId}`, {
      headers: { Accept: "application/vnd.elife.article-vor+json; version=8" },
    });
    url = meta.xml;
  }
  const xmlText = await getText(url, { browser: true, timeoutMs: 45000 });
  const resolve = (href: string, fig: Element): string | undefined => {
    switch (ref.imageMode) {
      case "biorxiv": {
        const hw = fig.attribs?.["hwp:id"] ?? fig.attribs?.id?.toUpperCase();
        return hw && ref.imageBase ? `${ref.imageBase}/${hw}.large.jpg` : undefined;
      }
      case "plos": {
        const doi = href.replace(/^info:doi\//, "");
        return ref.imageBase ? `${ref.imageBase}${doi}` : undefined;
      }
      case "elife":
        return `https://iiif.elifesciences.org/lax:${ref.articleId}%2F${encodeURIComponent(href)}/full/1500,/0/default.jpg`;
      default:
        return undefined;
    }
  };
  const { blocks } = jatsToBlocks(xmlText, { resolve }, a.url);
  const pdfUrl =
    ref.imageMode === "biorxiv"
      ? `${a.url}.full.pdf`
      : ref.imageMode === "plos"
        ? url.replace("type=manuscript", "type=printable")
        : undefined;
  return { blocks, originalUrl: a.url, pdfUrl };
}

// ---------------------------------------------------------------- Nature Communications / Scientific Reports
async function nature(url: string): Promise<Loaded> {
  const html = await getText(url, { browser: true, timeoutMs: 45000 });
  const $ = cheerio.load(html);
  const blocks: Block[] = [];
  const abs = $("#Abs1-content, section[data-title='Abstract'] .c-article-section__content").first();
  if (abs.length) {
    blocks.push({ t: "h", level: 2, segs: ["Abstract"] });
    blocks.push(...htmlToBlocks($, abs[0], { base: url }));
  }
  const body = $(".c-article-body .main-content, .c-article-body").first();
  const image = (img: Element) => {
    const src = img.attribs?.src || img.attribs?.["data-src"] || "";
    if (!src) return undefined;
    // Ask Springer's image service for a larger rendition.
    return absolutize(src, url).replace(/\/lw\d+\//, "/full/");
  };
  body.find(".c-article-section__figure-link, .c-article__pill-button, .c-article-buy-box, .u-hide-print, .c-article-references, #Abs1-section, script, style").remove();
  // Back matter is not part of the article itself.
  body.find("section[data-title]").each((_, s) => {
    const t = $(s).attr("data-title") ?? "";
    if (/^(Abstract|About this article|Additional information|Author information|Ethics declarations|Rights and permissions|References|Acknowledgements|Funding|Subjects|Supplementary information|Source data|Peer review)/i.test(t)) $(s).remove();
  });
  const bodyBlocks = body.length ? htmlToBlocks($, body[0], { base: url, image, skip: "nav, aside, .c-article-recommendations" }) : [];
  const pdfUrl = `${url}.pdf`;
  if (bodyBlocks.filter((b) => b.t === "p").length < 5) {
    // Freshly accepted papers only carry the abstract for a few days: try again later.
    throw new PendingError(t("Le texte intégral de cet article n'est pas encore en ligne. Il sera vérifié à nouveau plus tard."));
  }
  blocks.push(...bodyBlocks);
  return { blocks, originalUrl: url, pdfUrl };
}

// ---------------------------------------------------------------- SciELO (article web page)
async function scielo(url: string, pdfUrl?: string): Promise<Loaded> {
  try {
    const html = await getText(url, { browser: true, timeoutMs: 45000 });
    const $ = cheerio.load(html);
    $("script, style, .modal, .ref-list, #article-back, nav, footer").remove();
    // Classic pages write section titles as classed paragraphs: make them headings
    // so the table of contents works.
    for (const [cls, tag] of [["sec", "h2"], ["subsec", "h3"], ["sub-subsec", "h4"]]) {
      $(`p.${cls}`).each((_, el) => {
        (el as { name: string }).name = tag;
      });
    }
    const blocks: Block[] = [];
    // Classic SciELO sites (Spain…) put the text in #article-body; the new Brazilian
    // site splits it into .articleSection blocks.
    const classic = $("#article-body").first();
    const roots = classic.length ? [classic[0]] : $(".articleSection").toArray();
    for (const r of roots) {
      const title = $(r).attr("data-anchor") ?? "";
      if (/refer[eê]ncias|referencias|references/i.test(title)) continue;
      blocks.push(...htmlToBlocks($, r, { base: url, skip: ".ref, sup.xref-sup" }));
    }
    if (blocks.filter((b) => b.t === "p").length >= 3) return { blocks, originalUrl: url, pdfUrl };
  } catch {
    /* fall back to the PDF below */
  }
  if (!pdfUrl) throw new Error(t("Texte intégral SciELO indisponible."));
  return pdf(pdfUrl, url);
}

// ---------------------------------------------------------------- News pages (reader mode)
/** The article part of an official news page, extracted like Firefox's reader view. */
async function readable(url: string): Promise<Loaded> {
  const html = await getText(url, { browser: true, timeoutMs: 45000 });
  const { parseHTML } = await import("linkedom");
  const { Readability } = await import("@mozilla/readability");
  const { document } = parseHTML(html);
  const art = new Readability(document as unknown as Document).parse();
  if (!art?.content) throw new Error(t("Impossible d'extraire l'article de cette page."));
  return inline(art.content, url);
}

// ---------------------------------------------------------------- NASA (content embedded in the feed)
async function inline(html: string, baseUrl: string): Promise<Loaded> {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("script, style, iframe, .hds-social-share").remove();
  const blocks = htmlToBlocks($, $("#root")[0], {
    base: baseUrl,
    image: (img) => {
      const srcset = img.attribs?.srcset;
      if (srcset) {
        const best = srcset
          .split(",")
          .map((s) => s.trim().split(/\s+/))
          .sort((a, b) => parseInt(b[1] ?? "0") - parseInt(a[1] ?? "0"))[0]?.[0];
        if (best) return absolutize(best, baseUrl);
      }
      return img.attribs?.src ? absolutize(img.attribs.src, baseUrl) : undefined;
    },
  });
  // The feed ends with "The post … appeared first on NASA Science."
  const last = blocks[blocks.length - 1];
  if (last?.t === "p" && /appeared first on/.test(last.segs[0])) blocks.pop();
  return { blocks, originalUrl: baseUrl };
}

// ---------------------------------------------------------------- PDF-only sources
async function pdf(url: string, originalUrl: string): Promise<Loaded> {
  // 90 s for the whole file, one more try: a reader never waits more than 3 minutes.
  const data = await getBuffer(url, { browser: true, timeoutMs: 90000, retries: 1 });
  // An anti-robot page instead of the file: say so plainly.
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes("%PDF")) throw new Error(BLOCKED_MESSAGE);
  const blocks = await pdfToBlocks(data);
  return { blocks, pdfUrl: url, originalUrl, note: "Texte extrait du PDF : les figures sont visibles dans la version originale." };
}

async function osf(preprintId: string, originalUrl: string): Promise<Loaded> {
  const p = await getJson(`https://api.osf.io/v2/preprints/${preprintId}/`);
  const fileHref: string | undefined = p.data?.relationships?.primary_file?.links?.related?.href;
  if (!fileHref) throw new Error(t("Fichier de la prépublication introuvable sur OSF."));
  const f = await getJson(fileHref);
  const download: string | undefined = f.data?.links?.download;
  const name: string = f.data?.attributes?.name ?? "";
  if (!download) throw new Error(t("Fichier de la prépublication introuvable sur OSF."));
  if (/\.docx$/i.test(name)) return docx(download, originalUrl);
  return pdf(download, originalUrl);
}

/** Some preprints are Word documents: convert them, embedded figures included. */
async function docx(url: string, originalUrl: string): Promise<Loaded> {
  const mammoth = await import("mammoth");
  const buf = Buffer.from(await getBuffer(url, { browser: true, timeoutMs: 60000 }));
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const $ = cheerio.load(`<div id="root">${value}</div>`);
  const blocks = htmlToBlocks($, $("#root")[0], { base: originalUrl, allowData: true });
  return { blocks, originalUrl, note: "Document Word converti : la mise en page peut différer de l'original." };
}
