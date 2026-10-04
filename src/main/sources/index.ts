import { XMLParser } from "fast-xml-parser";
import type { Article, DomainId, Interest, SourceId } from "@shared/types";
import { getJson, getText, isoDaysAgo, pdfReachable, stripTags } from "../http";
import { classifyText } from "./classify";
import { news } from "./news";

export type RawArticle = Omit<Article, "state" | "fetchedAt">;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  isArray: (name) => ["entry", "item", "link", "author", "category", "dc:subject"].includes(name),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arr = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- arXiv
/** arXiv categories grouped by OpenAlex field. */
const ARXIV_GROUPS: { domain: DomainId; cats: string[] }[] = [
  { domain: "17", cats: ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.CR", "cs.NI", "cs.DC", "cs.SE", "cs.HC"] },
  { domain: "22", cats: ["cs.RO", "eess.SY", "eess.SP", "cs.AR", "cs.ET"] },
  { domain: "31", cats: ["astro-ph.EP", "astro-ph.GA", "astro-ph.CO", "astro-ph.SR", "astro-ph.HE", "quant-ph", "physics.app-ph", "physics.optics", "gr-qc"] },
  { domain: "25", cats: ["cond-mat.mtrl-sci", "cond-mat.soft"] },
  { domain: "13", cats: ["q-bio.BM", "q-bio.GN", "q-bio.QM", "q-bio.PE", "q-bio.NC"] },
  { domain: "26", cats: ["math.PR", "math.OC", "math.NA", "math.ST", "math.CO", "math.AP"] },
  { domain: "20", cats: ["econ.EM", "econ.GN", "econ.TH", "q-fin.GN", "q-fin.ST", "q-fin.CP"] },
];

async function arxiv(o: FetchOptions): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const groups = ARXIV_GROUPS.filter((g) => o.fields.has(g.domain) || (g.domain === "13" && o.fields.has("28")));
  for (const [i, g] of groups.entries()) {
    if (i > 0) await sleep(3500); // arXiv asks for at least 3 s between calls
    const q = encodeURIComponent(g.cats.map((c) => `cat:${c}`).join(" OR "));
    const body = await getText(
      `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=60`,
      { timeoutMs: 45000 },
    );
    const feed = xml.parse(body).feed;
    for (const e of arr<any>(feed?.entry)) {
      const absUrl = text(e.id);
      const m = absUrl.match(/abs\/(.+?)(v\d+)?$/);
      if (!m) continue;
      const arxivId = m[1];
      const cats = arr<any>(e.category).map((c) => c["@term"]).filter(Boolean);
      const primary = e["arxiv:primary_category"]?.["@term"] ?? cats[0];
      const title = clean(text(e.title));
      const abstract = clean(text(e.summary));
      let domain = g.domain;
      if (primary === "q-bio.NC") domain = "28";
      if (primary === "cs.HC" && classifyText(`${title} ${abstract}`, g.domain) === "32") domain = "32";
      out.push({
        id: `arxiv:${arxivId}`,
        source: "arxiv",
        domain,
        title,
        abstract,
        authors: arr<any>(e.author).map((a) => text(a.name)),
        published: text(e.published),
        url: `https://arxiv.org/abs/${arxivId}`,
        doi: text(e["arxiv:doi"]) || undefined,
        venue: "arXiv",
        categories: cats,
        lang: "en",
        license: "arXiv",
        fullText: { kind: "arxiv", arxivId },
        availability: "ok",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Europe PMC
const EPMC_QUERIES: { domain: DomainId; q: string }[] = [
  {
    domain: "32",
    q: '(TITLE:emotion OR TITLE:emotions OR TITLE:emotional OR TITLE:"emotion regulation" OR TITLE:affective OR TITLE:mood OR TITLE:anxiety OR TITLE:depression OR TITLE:personality OR TITLE:impulsivity OR TITLE:psychological OR TITLE:stress OR TITLE:wellbeing)',
  },
  { domain: "28", q: '(TITLE:brain OR TITLE:neurons OR TITLE:neural OR TITLE:microbiome OR TITLE:"gene therapy" OR TITLE:genome OR TITLE:"synthetic biology")' },
  { domain: "17", q: '(TITLE:"machine learning" OR TITLE:"deep learning" OR TITLE:"artificial intelligence" OR TITLE:"language model")' },
];

function epmcToArticle(r: any, domain: DomainId): RawArticle | null {
  if (!r.pmcid) return null;
  const title = stripTags(r.title ?? "");
  const abstract = stripTags(r.abstractText ?? "");
  return {
    id: r.doi ? `doi:${r.doi.toLowerCase()}` : `pmc:${r.pmcid}`,
    source: "europepmc",
    domain,
    title,
    abstract,
    authors: (r.authorList?.author ?? []).map((a: any) => a.fullName).filter(Boolean),
    published: r.firstPublicationDate ?? r.firstIndexDate ?? new Date().toISOString(),
    url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/PMC/${r.pmcid}`,
    doi: r.doi,
    venue: r.journalInfo?.journal?.title,
    categories: (r.keywordList?.keyword ?? []).slice(0, 8),
    lang: "en",
    license: r.license,
    fullText: { kind: "pmc", pmcid: r.pmcid },
    availability: "ok",
  };
}

/** Disciplines Europe PMC covers well: life sciences, health, psychology. */
const EPMC_FIELDS = new Set(["11", "13", "24", "27", "28", "29", "30", "32", "34", "35", "36"]);

/** One query per interest, from its keywords; the fixed list before interests existed. */
function epmcQueries(o: FetchOptions): { domain: DomainId; q: string }[] {
  if (!o.interests?.length) return EPMC_QUERIES.filter((x) => o.fields.has(x.domain));
  return o.interests
    .filter((i) => !i.custom)
    .flatMap((i) => {
      const domain = i.fields.find((f) => EPMC_FIELDS.has(f));
      if (!domain) return [];
      return [{ domain, q: `(${i.keywords.map((k) => `TITLE:"${k}"`).join(" OR ")})` }];
    });
}

async function europepmc(o: FetchOptions): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(10);
  for (const { domain, q } of epmcQueries(o)) {
    const query = encodeURIComponent(`${q} AND OPEN_ACCESS:y AND HAS_FT:y AND FIRST_PDATE:[${from} TO 2100-01-01]`);
    const j = await getJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&pageSize=40&sort=P_PDATE_D%20desc&resultType=core`,
    );
    for (const r of j.resultList?.result ?? []) {
      const a = epmcToArticle(r, domain);
      if (a) out.push(a);
    }
  }
  return out;
}

/** Looks a DOI up in Europe PMC and returns the PMC id when the full text is open. */
export async function epmcFindByDoi(doi: string): Promise<{ pmcid: string; raw: any } | null> {
  const query = encodeURIComponent(`DOI:"${doi}" AND HAS_FT:y AND OPEN_ACCESS:y`);
  const j = await getJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=core&pageSize=1`);
  const r = j.resultList?.result?.[0];
  return r?.pmcid ? { pmcid: r.pmcid, raw: r } : null;
}

// ---------------------------------------------------------------- bioRxiv / medRxiv
/** bioRxiv / medRxiv categories → OpenAlex fields (medRxiv defaults to Medicine). */
const RXIV_DOMAINS: Record<string, DomainId> = {
  neuroscience: "28",
  neurology: "28",
  "animal behavior and cognition": "32",
  "psychiatry and clinical psychology": "32",
  bioinformatics: "13",
  "health informatics": "17",
  "synthetic biology": "13",
  "systems biology": "13",
  genetics: "13",
  genomics: "13",
  "genetic and genomic medicine": "13",
  "cell biology": "13",
  "molecular biology": "13",
  "developmental biology": "13",
  biochemistry: "13",
  biophysics: "13",
  physiology: "13",
  microbiology: "24",
  immunology: "24",
  "allergy and immunology": "24",
  "infectious diseases": "24",
  "evolutionary biology": "11",
  ecology: "11",
  "plant biology": "11",
  zoology: "11",
  paleontology: "19",
  bioengineering: "22",
  "pharmacology and toxicology": "30",
  "cancer biology": "27",
  "scientific communication and education": "33",
};

async function rxiv(server: "biorxiv" | "medrxiv", o: FetchOptions): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(3);
  const to = isoDaysAgo(0);
  for (let cursor = 0; cursor < 600; cursor += 100) {
    const j = await getJson(`https://api.biorxiv.org/details/${server}/${from}/${to}/${cursor}`);
    const coll: any[] = j.collection ?? [];
    for (const r of coll) {
      const cat = String(r.category ?? "").toLowerCase();
      const domain = RXIV_DOMAINS[cat] ?? (server === "medrxiv" ? "27" : "13");
      if (!o.fields.has(domain) || !r.jatsxml) continue;
      const title = clean(r.title ?? "");
      const abstract = clean(r.abstract ?? "");
      const base = String(r.jatsxml).replace(/\.source\.xml$/, "").replace("/content/early/", `/content/${server}/early/`);
      out.push({
        id: `doi:${String(r.doi).toLowerCase()}`,
        source: server,
        domain,
        title,
        abstract,
        authors: String(r.authors ?? "").split(";").map((s) => s.trim()).filter(Boolean),
        published: r.date,
        url: `https://www.${server}.org/content/${r.doi}v${r.version}`,
        doi: r.doi,
        venue: server === "biorxiv" ? "bioRxiv" : "medRxiv",
        categories: [r.category],
        lang: "en",
        license: r.license,
        fullText: { kind: "jats", url: r.jatsxml, imageBase: base, imageMode: "biorxiv" },
        availability: "ok",
      });
    }
    if (coll.length < 100) break;
  }
  // Keep the most recent ones per domain so a busy day does not drown everything else.
  return out.slice(-150);
}

// ---------------------------------------------------------------- PLOS
const PLOS_SUBJECTS: { domain: DomainId; subject: string }[] = [
  { domain: "32", subject: "Psychology" },
  { domain: "28", subject: "Neuroscience" },
  { domain: "17", subject: "Computer and information sciences" },
  { domain: "22", subject: "Engineering and technology" },
  { domain: "31", subject: "Physical sciences" },
  { domain: "19", subject: "Earth sciences" },
  { domain: "23", subject: "Ecology and environmental sciences" },
  { domain: "33", subject: "Social sciences" },
  { domain: "27", subject: "Medicine and health sciences" },
  { domain: "13", subject: "Biology and life sciences" },
];

async function plos(o: FetchOptions): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  for (const { domain, subject } of PLOS_SUBJECTS.filter((x) => o.fields.has(x.domain))) {
    const q = encodeURIComponent(
      `publication_date:[NOW-14DAYS TO NOW] AND subject:"${subject}" AND doc_type:full AND article_type:"Research Article"`,
    );
    const j = await getJson(
      `https://api.plos.org/search?q=${q}&fl=id,title_display,abstract,author_display,publication_date,journal,subject_level_1&rows=25&sort=publication_date%20desc`,
    );
    for (const d of j.response?.docs ?? []) {
      const doi = String(d.id);
      const journalSlug = doi.match(/journal\.(\w+)\./)?.[1] ?? "plosone";
      const slug = { pone: "plosone", pbio: "plosbiology", pcbi: "ploscompbiol", pmed: "plosmedicine", pgen: "plosgenetics", pntd: "plosntds", ppat: "plospathogens" }[journalSlug] ?? "plosone";
      out.push({
        id: `doi:${doi.toLowerCase()}`,
        source: "plos",
        domain,
        title: stripTags(d.title_display ?? ""),
        abstract: stripTags(arr<string>(d.abstract).join(" ")),
        authors: arr<string>(d.author_display),
        published: d.publication_date,
        url: `https://journals.plos.org/${slug}/article?id=${doi}`,
        doi,
        venue: d.journal,
        categories: arr<string>(d.subject_level_1),
        lang: "en",
        license: "CC BY",
        fullText: {
          kind: "jats",
          url: `https://journals.plos.org/${slug}/article/file?id=${doi}&type=manuscript`,
          imageBase: `https://journals.plos.org/${slug}/article/figure/image?size=large&id=`,
          imageMode: "plos",
        },
        availability: "ok",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- eLife
const ELIFE_DOMAINS: Record<string, DomainId> = {
  neuroscience: "28",
  "computational-systems-biology": "13",
  "physics-living-systems": "31",
  "structural-biology-molecular-biophysics": "13",
  "immunology-inflammation": "24",
  "microbiology-infectious-disease": "24",
  ecology: "11",
  "evolutionary-biology": "11",
  "plant-biology": "11",
  medicine: "27",
  "epidemiology-global-health": "27",
  "cancer-biology": "27",
};

async function elife(o: FetchOptions): Promise<RawArticle[]> {
  const j = await getJson("https://api.elifesciences.org/articles?per-page=40&order=desc&type[]=research-article", {
    headers: { Accept: "application/vnd.elife.article-list+json; version=1" },
  });
  const out: RawArticle[] = [];
  for (const a of j.items ?? []) {
    if (a.status !== "vor") continue;
    const subjects: string[] = (a.subjects ?? []).map((s: any) => s.id);
    let domain: DomainId = "13";
    for (const s of subjects) if (ELIFE_DOMAINS[s]) domain = ELIFE_DOMAINS[s];
    if (!o.fields.has(domain)) continue;
    const title = stripTags(a.title ?? "");
    const abstract = stripTags(a.impactStatement ?? "");
    out.push({
      id: `doi:${String(a.doi).toLowerCase()}`,
      source: "elife",
      domain,
      title,
      abstract,
      authors: a.authorLine ? [a.authorLine] : [],
      published: a.published,
      url: `https://elifesciences.org/articles/${a.id}`,
      doi: a.doi,
      venue: "eLife",
      categories: (a.subjects ?? []).map((s: any) => s.name),
      lang: "en",
      license: "CC BY",
      image: a.image?.thumbnail?.source?.uri ? `${a.image.thumbnail.source.uri}`.replace(/\/full\/.*/, "") + "/full/600,/0/default.jpg" : undefined,
      fullText: { kind: "jats", url: "", imageMode: "elife", articleId: String(a.id) },
      availability: "ok",
    });
  }
  return out;
}

// ---------------------------------------------------------------- NASA Science
async function nasa(): Promise<RawArticle[]> {
  const body = await getText("https://science.nasa.gov/feed/", { browser: true });
  const items = arr<any>(xml.parse(body).rss?.channel?.item);
  return items.map((it) => {
    const html = text(it["content:encoded"]);
    const img = html.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const link = text(arr<any>(it.link)[0]);
    const cats = arr<any>(it.category).map(text);
    return {
      id: `url:${link}`,
      source: "nasa" as const,
      kind: "news" as const,
      newsTags: ["space"],
      topic: "science" as const,
      domain: "31",
      title: stripTags(text(it.title)),
      abstract: stripTags(text(it.description)).replace(/The post .* appeared first on NASA Science\.?/, "").trim(),
      authors: ["NASA"],
      published: new Date(text(it.pubDate)).toISOString(),
      url: link,
      venue: "NASA Science",
      categories: cats,
      lang: "en",
      license: "Domaine public (NASA)",
      image: img,
      fullText: { kind: "inline" as const, html, baseUrl: link },
      availability: "ok" as const,
    };
  });
}

// ---------------------------------------------------------------- Nature Communications / Scientific Reports
async function nature(): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  for (const [feed, venue] of [
    ["https://www.nature.com/ncomms.rss", "Nature Communications"],
    ["https://www.nature.com/srep.rss", "Scientific Reports"],
  ] as const) {
    const body = await getText(feed, { browser: true });
    const doc = xml.parse(body);
    const items = arr<any>(doc["rdf:RDF"]?.item ?? doc.rss?.channel?.item);
    for (const it of items.slice(0, 40)) {
      const link = text(arr<any>(it.link)[0]);
      const title = clean(stripTags(text(it.title)));
      // The feed text is "<Journal>, Published online: <date>; doi:<doi><title>": not an abstract.
      const desc = stripTags(text(it["content:encoded"] ?? it.description))
        .replace(/^.*?doi:\S+?(?=[A-Z])/, "")
        .replace(title, "")
        .trim();
      const doi = text(it["prism:doi"] ?? it["dc:identifier"]).replace(/^doi:/, "");
      out.push({
        id: doi ? `doi:${doi.toLowerCase()}` : `url:${link}`,
        source: "nature",
        domain: classifyText(`${title} ${desc}`),
        title,
        abstract: desc,
        authors: arr<any>(it["dc:creator"]).map(text),
        published: text(it["dc:date"]) || new Date().toISOString(),
        url: link,
        doi: doi || undefined,
        venue,
        categories: [],
        lang: "en",
        license: "CC BY",
        fullText: { kind: "html", url: link, mode: "nature" },
        availability: "ok",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Science Advances (full text through Europe PMC)
async function sciadv(): Promise<RawArticle[]> {
  const body = await getText("https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=sciadv", { browser: true });
  const doc = xml.parse(body);
  const items = arr<any>(doc["rdf:RDF"]?.item ?? doc.rss?.channel?.item);
  return items.slice(0, 40).map((it) => {
    const doi = text(it["dc:identifier"]).replace(/^doi:/, "");
    const title = clean(stripTags(text(it.title)));
    const desc = stripTags(text(it.description));
    return {
      id: `doi:${doi.toLowerCase()}`,
      source: "sciadv" as const,
      domain: classifyText(`${title} ${desc}`),
      title,
      abstract: desc,
      authors: arr<any>(it["dc:creator"]).map(text),
      published: text(it["dc:date"]) || new Date().toISOString(),
      url: text(arr<any>(it.link)[0]) || `https://doi.org/${doi}`,
      doi,
      venue: "Science Advances",
      categories: arr<any>(it["dc:subject"]).map(text),
      lang: "en",
      license: "Libre accès",
      fullText: { kind: "doi-lookup" as const, doi },
      availability: "pending" as const,
    };
  });
}

// ---------------------------------------------------------------- OpenAlex
const OPENALEX_SELECT =
  "id,doi,title,language,publication_date,ids,best_oa_location,locations,primary_topic,authorships,abstract_inverted_index,cited_by_count";

function invertedToText(inv: Record<string, number[]> | null | undefined) {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ");
}

function openalexToArticle(w: any, fallbackField: DomainId): RawArticle | null {
  const doi = w.doi ? String(w.doi).replace("https://doi.org/", "") : undefined;
  const pmcid = w.ids?.pmcid ? String(w.ids.pmcid).split("/").pop() : undefined;
  const arxivLoc = (w.locations ?? []).find((l: any) => /arxiv\.org/.test(l.landing_page_url ?? ""));
  const arxivId = arxivLoc?.landing_page_url?.match(/abs\/([^v]+?)(v\d+)?$/)?.[1];
  const pdf = w.best_oa_location?.pdf_url;
  let fullText: RawArticle["fullText"] | null = null;
  if (arxivId) fullText = { kind: "arxiv", arxivId };
  else if (pmcid) fullText = { kind: "pmc", pmcid: pmcid.startsWith("PMC") ? pmcid : `PMC${pmcid}` };
  else if (pdf) fullText = { kind: "pdf", url: pdf };
  else if (doi) fullText = { kind: "doi-lookup", doi };
  if (!fullText) return null;
  const field = String(w.primary_topic?.field?.id ?? "").split("/").pop() || fallbackField;
  const topicId = String(w.primary_topic?.id ?? "").split("/").pop() || undefined;
  return {
    topicId,
    id: doi ? `doi:${doi.toLowerCase()}` : `openalex:${w.id}`,
    source: "openalex",
    domain: field,
    title: stripTags(w.title ?? ""),
    abstract: invertedToText(w.abstract_inverted_index),
    authors: (w.authorships ?? []).slice(0, 12).map((a: any) => a.author?.display_name).filter(Boolean),
    published: w.publication_date,
    url: w.best_oa_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : w.id),
    doi,
    venue: w.best_oa_location?.source?.display_name,
    categories: [w.primary_topic?.display_name].filter(Boolean),
    lang: w.language ?? "en",
    license: w.best_oa_location?.license ?? "Libre accès",
    fullText,
    availability: fullText.kind === "doi-lookup" ? "pending" : "ok",
  };
}

/** A title made mostly of letters (some records are garbled). */
const looksLikeTitle = (t: string) => t.length > 12 && (t.match(/\p{L}/gu)?.length ?? 0) / t.length > 0.6;

/**
 * OpenAlex covers every discipline: the most cited open-access papers of the last
 * weeks for each enabled field, plus recent papers in the other enabled languages
 * (German, Russian, Japanese, Chinese…), for which there is no better open source.
 */
async function openalex(o: FetchOptions): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(21);
  const fields = [...o.fields].filter((f) => f !== "0");
  for (const field of fields) {
    const j = await getJson(
      `https://api.openalex.org/works?filter=from_publication_date:${from},is_oa:true,has_abstract:true,primary_topic.field.id:fields/${field},type:article,language:en&sort=cited_by_count:desc&per-page=10&select=${OPENALEX_SELECT}`,
    );
    for (const w of j.results ?? []) {
      const a = openalexToArticle(w, field);
      if (a && looksLikeTitle(a.title)) out.push(a);
    }
  }
  // Topics followed directly (free search): the most recent open papers of each.
  for (const topic of o.topics ?? []) {
    const j = await getJson(
      `https://api.openalex.org/works?filter=from_publication_date:${isoDaysAgo(90)},is_oa:true,has_abstract:true,primary_topic.id:${topic},type:article&sort=publication_date:desc&per-page=15&select=${OPENALEX_SELECT}`,
    );
    for (const w of j.results ?? []) {
      const a = openalexToArticle(w, "0");
      if (a && looksLikeTitle(a.title)) out.push(a);
    }
  }
  // Discoveries: a handful of papers from disciplines next to the reader's interests.
  for (const field of o.explore ?? []) {
    const j = await getJson(
      `https://api.openalex.org/works?filter=from_publication_date:${from},is_oa:true,has_abstract:true,primary_topic.field.id:fields/${field},type:article,language:en&sort=cited_by_count:desc&per-page=6&select=${OPENALEX_SELECT}`,
    );
    for (const w of j.results ?? []) {
      const a = openalexToArticle(w, field);
      if (a && looksLikeTitle(a.title)) out.push(a);
    }
  }
  // Other languages: only papers whose PDF is reachable, so they can be read in full.
  // French, Spanish and Portuguese come from HAL and SciELO, which are richer.
  const others = [...o.languages].filter((l) => !["en", "fr", "es", "pt"].includes(l));
  if (others.length && fields.length) {
    const fieldFilter = fields.map((f) => `fields/${f}`).join("|");
    for (const lang of others) {
      const j = await getJson(
        `https://api.openalex.org/works?filter=from_publication_date:${isoDaysAgo(60)},language:${lang},is_oa:true,has_abstract:true,type:article,primary_topic.field.id:${fieldFilter}&sort=publication_date:desc&per-page=50&select=${OPENALEX_SELECT}`,
      );
      let kept = 0;
      for (const w of j.results ?? []) {
        if (!w.best_oa_location?.pdf_url || kept >= 15) continue;
        if (!(await pdfReachable(w.best_oa_location.pdf_url))) continue;
        const a = openalexToArticle(w, "0");
        if (a && looksLikeTitle(a.title) && a.abstract.length > 200) {
          out.push(a);
          kept++;
        }
      }
    }
  }
  return out;
}

/**
 * Research topics matching free text in any language: the topics of the recent papers
 * that match it (no AI needed: "couture" → Fashion and Cultural Textiles).
 */
export async function searchTopics(q: string): Promise<{ id: string; name: string; field: DomainId; count: number }[]> {
  const j = await getJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=from_publication_date:${isoDaysAgo(3 * 365)}&group_by=primary_topic.id&per-page=8`,
  );
  const groups: { key: string; key_display_name: string; count: number }[] = (j.group_by ?? []).slice(0, 6);
  // The field of each topic, in one request.
  const ids = groups.map((g) => g.key.split("/").pop()).filter(Boolean);
  const t = ids.length
    ? await getJson(`https://api.openalex.org/topics?filter=id:${ids.join("|")}&select=id,field&per-page=10`)
    : { results: [] };
  const fieldOf = new Map<string, string>(
    (t.results ?? []).map((x: any) => [String(x.id).split("/").pop(), String(x.field?.id ?? "").split("/").pop()]),
  );
  return groups.map((g) => {
    const id = g.key.split("/").pop()!;
    return { id, name: g.key_display_name, field: fieldOf.get(id) ?? "0", count: g.count };
  });
}

/** Field and language of known DOIs (50 per request), to classify articles from any source. */
export async function openalexClassify(
  dois: string[],
): Promise<Map<string, { field?: DomainId; lang?: string; topicId?: string }>> {
  const res = new Map<string, { field?: DomainId; lang?: string; topicId?: string }>();
  for (let i = 0; i < dois.length; i += 50) {
    const chunk = dois.slice(i, i + 50);
    const j = await getJson(
      `https://api.openalex.org/works?filter=doi:${chunk.map(encodeURIComponent).join("|")}&per-page=50&select=doi,primary_topic,language`,
    );
    for (const w of j.results ?? []) {
      const doi = String(w.doi ?? "").replace("https://doi.org/", "").toLowerCase();
      const field = String(w.primary_topic?.field?.id ?? "").split("/").pop() || undefined;
      const topicId = String(w.primary_topic?.id ?? "").split("/").pop() || undefined;
      res.set(doi, { field, lang: w.language ?? undefined, topicId });
    }
  }
  return res;
}

// ---------------------------------------------------------------- Semantic Scholar
const S2_QUERIES: { domain: DomainId; q: string }[] = [
  { domain: "32", q: "emotion regulation" },
  { domain: "22", q: "robot learning" },
  { domain: "17", q: "large language models" },
];

async function semanticscholar(o: FetchOptions): Promise<RawArticle[]> {
  const apiKey = o.s2Key;
  const out: RawArticle[] = [];
  const year = new Date().getFullYear();
  for (const [i, { domain, q }] of S2_QUERIES.filter((x) => o.fields.has(x.domain)).entries()) {
    if (i > 0) await sleep(apiKey ? 1100 : 3500);
    const j = await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&year=${year}&openAccessPdf&limit=20&fields=title,abstract,externalIds,openAccessPdf,publicationDate,authors,venue,fieldsOfStudy`,
      { headers: apiKey ? { "x-api-key": apiKey } : {}, retries: 1 },
    );
    for (const p of j.data ?? []) {
      const ext = p.externalIds ?? {};
      let fullText: RawArticle["fullText"] | null = null;
      if (ext.ArXiv) fullText = { kind: "arxiv", arxivId: ext.ArXiv };
      else if (ext.PubMedCentral) fullText = { kind: "pmc", pmcid: `PMC${ext.PubMedCentral}` };
      else if (p.openAccessPdf?.url) fullText = { kind: "pdf", url: p.openAccessPdf.url };
      if (!fullText || !p.abstract) continue;
      const doi = ext.DOI as string | undefined;
      out.push({
        id: ext.ArXiv ? `arxiv:${ext.ArXiv}` : doi ? `doi:${doi.toLowerCase()}` : `s2:${p.paperId}`,
        source: "semanticscholar",
        domain,
        title: clean(p.title ?? ""),
        abstract: clean(p.abstract ?? ""),
        authors: (p.authors ?? []).slice(0, 12).map((a: any) => a.name),
        published: p.publicationDate ?? `${year}-01-01`,
        url: `https://www.semanticscholar.org/paper/${p.paperId}`,
        doi,
        venue: p.venue || "Semantic Scholar",
        categories: p.fieldsOfStudy ?? [],
        lang: "en",
        license: "Libre accès",
        fullText,
        availability: "ok",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- PsyArXiv (OSF)
async function psyarxiv(): Promise<RawArticle[]> {
  const j = await getJson("https://api.osf.io/v2/preprints/?filter[provider]=psyarxiv&page[size]=40&sort=-date_published");
  return (j.data ?? []).map((p: any) => {
    const a = p.attributes ?? {};
    const title = clean(a.title ?? "");
    const abstract = clean(a.description ?? "");
    return {
      id: a.doi ? `doi:${String(a.doi).toLowerCase()}` : `osf:${p.id}`,
      source: "psyarxiv" as const,
      domain: "32",
      title,
      abstract,
      authors: [],
      published: a.date_published ?? a.date_created,
      url: `https://osf.io/preprints/psyarxiv/${String(p.id).split("_")[0]}`,
      doi: a.doi ?? undefined,
      venue: "PsyArXiv",
      categories: (a.tags ?? []).slice(0, 8),
      lang: "en",
      license: "Prépublication en libre accès",
      fullText: { kind: "osf" as const, preprintId: p.id },
      availability: "ok" as const,
    };
  });
}

// ---------------------------------------------------------------- HAL (French open archive)

/** HAL discipline codes → OpenAlex fields (most specific code wins). */
const HAL_FIELDS: [RegExp, DomainId][] = [
  [/^shs\.psy/, "32"],
  [/^shs\.eco/, "20"],
  [/^shs\.gestion/, "14"],
  [/^shs\.(hist|art|litt|langue|phil|archeo|class|musiq|religion|hisphilso)/, "12"],
  [/^shs/, "33"],
  [/^sdv\.neu/, "28"],
  [/^sdv\.(mhep|spee|can)/, "27"],
  [/^sdv\.(imm|mp)/, "24"],
  [/^sdv\.tox/, "30"],
  [/^sdv\.sa/, "11"],
  [/^sdv\.ee/, "23"],
  [/^sdv\.ib/, "22"],
  [/^sdv/, "13"],
  [/^scco/, "32"],
  [/^info/, "17"],
  [/^(math|stat)/, "26"],
  [/^chim/, "16"],
  [/^spi\.mat/, "25"],
  [/^spi\.nrj/, "21"],
  [/^spi/, "22"],
  [/^sdu\.astr/, "31"],
  [/^sdu/, "19"],
  [/^sde/, "23"],
  [/^qfin/, "20"],
  [/^(phys|nlin)/, "31"],
];

function halField(domains: string[]): DomainId {
  // "0.shs", "1.shs.hist": keep the deepest level.
  const codes = domains.map((d) => d.replace(/^\d+\./, "")).sort((a, b) => b.split(".").length - a.split(".").length);
  for (const c of codes) for (const [re, f] of HAL_FIELDS) if (re.test(c)) return f;
  return "0";
}

async function hal(o: FetchOptions): Promise<RawArticle[]> {
  const langs = [...o.languages].filter((l) => l !== "en");
  if (!langs.length) return [];
  const fq = [
    "submittedDate_tdate:[NOW-10DAYS TO NOW]",
    "openAccess_bool:true",
    "docType_s:ART",
    `language_s:(${langs.join(" OR ")})`,
  ]
    .map((f) => `&fq=${encodeURIComponent(f)}`)
    .join("");
  const fl = "halId_s,title_s,abstract_s,language_s,files_s,uri_s,domain_s,doiId_s,authFullName_s,producedDate_s,submittedDate_s,journalTitle_s,keyword_s,licence_s";
  const j = await getJson(`https://api.archives-ouvertes.fr/search/?q=*:*${fq}&fl=${fl}&sort=submittedDate_tdate%20desc&rows=80&wt=json`);
  // HAL may put an anti-robot page in front of its files: then none of them could be
  // opened, so none is added (the source status says why).
  const probe = arr<string>(j.response?.docs?.find((d: any) => arr<string>(d.files_s)[0])?.files_s)[0];
  if (probe && !(await pdfReachable(probe))) {
    throw new Error("HAL bloque pour l'instant les téléchargements automatiques (protection anti-robot) : ses articles ne sont pas ajoutés.");
  }
  const out: RawArticle[] = [];
  for (const d of j.response?.docs ?? []) {
    const pdf = arr<string>(d.files_s)[0];
    const title = clean(arr<string>(d.title_s)[0] ?? "");
    const abstract = clean(stripTags(arr<string>(d.abstract_s)[0] ?? ""));
    if (!pdf || !title || abstract.length < 150) continue;
    const domain = halField(arr<string>(d.domain_s));
    if (domain !== "0" && !o.fields.has(domain)) continue;
    const doi = d.doiId_s ? String(d.doiId_s) : undefined;
    out.push({
      id: doi ? `doi:${doi.toLowerCase()}` : `hal:${d.halId_s}`,
      source: "hal",
      domain,
      title,
      abstract,
      authors: arr<string>(d.authFullName_s).slice(0, 12),
      // Deposit date: "produced" can be years earlier for papers archived late.
      published: d.submittedDate_s ?? d.producedDate_s ?? new Date().toISOString(),
      url: d.uri_s,
      doi,
      venue: d.journalTitle_s ?? "HAL",
      categories: arr<string>(d.keyword_s).slice(0, 8),
      lang: arr<string>(d.language_s)[0] ?? "fr",
      license: d.licence_s ?? "Libre accès (HAL)",
      fullText: { kind: "pdf", url: pdf },
      availability: "ok",
    });
  }
  return out;
}

// ---------------------------------------------------------------- SciELO (Spanish and Portuguese)

/**
 * Collections: Brazil, Spain, Mexico, Portugal, Colombia, Argentina.
 * (Chile is left out: its site blocks automated downloads.)
 */
const SCIELO_COLLECTIONS = ["scl", "esp", "mex", "prt", "col", "arg"];

/** One SciELO record (JSON form: metadata and full-text links in one request). */
async function scieloArticle(collection: string, code: string, o: FetchOptions): Promise<RawArticle | null> {
  const j = await getJson(`https://articlemeta.scielo.org/api/v1/article/?collection=${collection}&code=${code}`);
  const a = j.article ?? {};
  const lang: string = a.v40?.[0]?._ ?? "es";
  // SciELO is here for Spanish and Portuguese: English papers come from other sources.
  if (lang === "en" || !o.languages.has(lang)) return null;
  // Records are often re-processed years later: keep recent research only.
  if (Number(j.publication_year) < new Date().getFullYear() - 1) return null;
  if (!["research-article", "review-article", "brief-report", "case-report"].includes(j.document_type)) return null;
  const pdf: string | undefined = j.fulltexts?.pdf?.[lang] ?? Object.values(j.fulltexts?.pdf ?? {})[0];
  // The web page carries the structure and the figures; the PDF is the fallback.
  const html: string | undefined = j.fulltexts?.html?.[lang] ?? Object.values(j.fulltexts?.html ?? {})[0];
  const pick = (list: any[] | undefined, key = "_") => (list ?? []).find((x) => x.l === lang)?.[key] ?? list?.[0]?.[key] ?? "";
  const title = clean(stripTags(pick(a.v12)));
  const abstract = clean(stripTags(pick(a.v83, "a")));
  if ((!pdf && !html) || !title || abstract.length < 150) return null;
  const https = (u?: string) => u?.replace(/^http:/, "https:");
  const doi: string | undefined = j.doi || undefined;
  const ymd = String(a.v65?.[0]?._ ?? `${j.publication_year}0101`).padEnd(8, "0");
  return {
    // Keyed by SciELO code so already-seen papers are skipped without a request.
    id: `scielo:${code}`,
    source: "scielo",
    // Classified by OpenAlex from the DOI after the refresh (keywords are not in English).
    domain: "0",
    title,
    abstract,
    authors: (a.v10 ?? []).map((p: any) => `${p.n ?? ""} ${p.s ?? ""}`.trim()).filter(Boolean).slice(0, 12),
    published: `${ymd.slice(0, 4)}-${ymd.slice(4, 6).replace("00", "01")}-${ymd.slice(6, 8).replace("00", "01")}`,
    url: doi ? `https://doi.org/${doi}` : String(https(html) ?? https(pdf)),
    doi,
    venue: j.title?.v100?.[0]?._ ?? "SciELO",
    categories: (a.v85 ?? []).filter((k: any) => k.k && k.l === lang).map((k: any) => k.k).slice(0, 8),
    lang,
    license: "Libre accès (SciELO)",
    fullText: html ? { kind: "html", url: https(html)!, mode: "scielo", pdf: https(pdf) } : { kind: "pdf", url: https(pdf)! },
    availability: "ok",
  };
}

async function scielo(o: FetchOptions): Promise<RawArticle[]> {
  if (!o.languages.has("es") && !o.languages.has("pt")) return [];
  const todo: { col: string; code: string }[] = [];
  for (const col of SCIELO_COLLECTIONS) {
    const ids = await getJson(
      `https://articlemeta.scielo.org/api/v1/article/identifiers/?collection=${col}&from=${isoDaysAgo(30)}&limit=40`,
    );
    for (const it of ids.objects ?? []) if (!o.known.has(`scielo:${it.code}`)) todo.push({ col, code: it.code });
  }
  // Records are small: six at a time keeps a refresh quick.
  const out: RawArticle[] = [];
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const { col, code } = queue.shift()!;
        try {
          const a = await scieloArticle(col, code, o);
          if (a) out.push(a);
        } catch {
          /* one broken record does not stop the others */
        }
      }
    }),
  );
  return out;
}

export interface FetchOptions {
  s2Key?: string;
  /** Enabled OpenAlex fields: a source is only asked about the fields it covers. */
  fields: Set<DomainId>;
  /** Enabled article languages. */
  languages: Set<string>;
  /** Ids already in the library, so sources can skip what was fetched before. */
  known: Set<string>;
  /** The reader's interests (Europe PMC builds its queries from their keywords). */
  interests?: Interest[];
  /** OpenAlex topics followed directly (interests found with the free search). */
  topics?: string[];
  /** A few disciplines outside the reader's interests, for discoveries. */
  explore?: Set<DomainId>;
}

export const FETCHERS: Record<SourceId, (o: FetchOptions) => Promise<RawArticle[]>> = {
  arxiv,
  europepmc,
  biorxiv: (o) => rxiv("biorxiv", o),
  medrxiv: (o) => rxiv("medrxiv", o),
  plos,
  elife,
  // Single-topic sources only run when their topic is enabled.
  nasa: (o) => (o.fields.has("31") ? nasa() : Promise.resolve([])),
  nature: () => nature(),
  sciadv: () => sciadv(),
  openalex,
  semanticscholar,
  psyarxiv: (o) => (o.fields.has("32") ? psyarxiv() : Promise.resolve([])),
  hal,
  scielo,
  esa: () => news("esa"),
  cnrs: () => news("cnrs"),
  inserm: () => news("inserm"),
  devtools: () => news("devtools"),
};
