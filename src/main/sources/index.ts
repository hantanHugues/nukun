import { XMLParser } from "fast-xml-parser";
import type { Article, DomainId, SourceId } from "@shared/types";
import { getJson, getText, isoDaysAgo, stripTags } from "../http";
import { classifyText } from "./classify";

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
const ARXIV_GROUPS: { domain: DomainId; cats: string[] }[] = [
  { domain: "info", cats: ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.CR", "cs.NI", "cs.DC", "cs.SE", "cs.HC"] },
  { domain: "robot", cats: ["cs.RO", "eess.SY", "eess.SP", "cs.AR", "cs.ET"] },
  { domain: "phys", cats: ["astro-ph.EP", "astro-ph.GA", "astro-ph.CO", "astro-ph.SR", "astro-ph.HE", "quant-ph", "physics.app-ph", "physics.optics", "gr-qc", "cond-mat.mtrl-sci"] },
  { domain: "bio", cats: ["q-bio.NC", "q-bio.BM", "q-bio.GN", "q-bio.QM", "q-bio.PE"] },
];

async function arxiv(): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  for (const [i, g] of ARXIV_GROUPS.entries()) {
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
      if (primary === "q-bio.NC" || primary === "cs.HC") {
        domain = classifyText(`${title} ${abstract}`, g.domain) === "psy" ? "psy" : g.domain;
      }
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
    domain: "psy",
    q: '(TITLE:emotion OR TITLE:emotions OR TITLE:emotional OR TITLE:"emotion regulation" OR TITLE:affective OR TITLE:mood OR TITLE:anxiety OR TITLE:depression OR TITLE:personality OR TITLE:impulsivity OR TITLE:psychological OR TITLE:stress OR TITLE:wellbeing)',
  },
  { domain: "bio", q: '(TITLE:brain OR TITLE:neurons OR TITLE:neural OR TITLE:microbiome OR TITLE:"gene therapy" OR TITLE:genome OR TITLE:"synthetic biology")' },
  { domain: "info", q: '(TITLE:"machine learning" OR TITLE:"deep learning" OR TITLE:"artificial intelligence" OR TITLE:"language model")' },
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
    license: r.license,
    fullText: { kind: "pmc", pmcid: r.pmcid },
    availability: "ok",
  };
}

async function europepmc(): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(10);
  for (const { domain, q } of EPMC_QUERIES) {
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
const RXIV_DOMAINS: Record<string, DomainId> = {
  neuroscience: "bio",
  "animal behavior and cognition": "psy",
  "psychiatry and clinical psychology": "psy",
  bioinformatics: "info",
  "health informatics": "info",
  "synthetic biology": "bio",
  "systems biology": "bio",
  genetics: "bio",
  genomics: "bio",
  "cell biology": "bio",
  microbiology: "bio",
  "evolutionary biology": "bio",
  biophysics: "bio",
  bioengineering: "robot",
  "cancer biology": "bio",
  immunology: "bio",
  neurology: "bio",
  "molecular biology": "bio",
  "developmental biology": "bio",
};

async function rxiv(server: "biorxiv" | "medrxiv"): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(3);
  const to = isoDaysAgo(0);
  for (let cursor = 0; cursor < 600; cursor += 100) {
    const j = await getJson(`https://api.biorxiv.org/details/${server}/${from}/${to}/${cursor}`);
    const coll: any[] = j.collection ?? [];
    for (const r of coll) {
      const cat = String(r.category ?? "").toLowerCase();
      let domain = RXIV_DOMAINS[cat];
      if (!domain) continue;
      const title = clean(r.title ?? "");
      const abstract = clean(r.abstract ?? "");
      if (domain === "bio" && classifyText(`${title} ${abstract}`, "bio") === "psy") domain = "psy";
      if (!r.jatsxml) continue;
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
  { domain: "psy", subject: "Psychology" },
  { domain: "psy", subject: "Emotions" },
  { domain: "bio", subject: "Neuroscience" },
  { domain: "info", subject: "Computer and information sciences" },
  { domain: "robot", subject: "Robotics" },
  { domain: "phys", subject: "Physical sciences" },
];

async function plos(): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  for (const { domain, subject } of PLOS_SUBJECTS) {
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
  neuroscience: "bio",
  "computational-systems-biology": "info",
  "physics-living-systems": "phys",
  "structural-biology-molecular-biophysics": "bio",
};

async function elife(): Promise<RawArticle[]> {
  const j = await getJson("https://api.elifesciences.org/articles?per-page=40&order=desc&type[]=research-article", {
    headers: { Accept: "application/vnd.elife.article-list+json; version=1" },
  });
  const out: RawArticle[] = [];
  for (const a of j.items ?? []) {
    if (a.status !== "vor") continue;
    const subjects: string[] = (a.subjects ?? []).map((s: any) => s.id);
    let domain: DomainId = "bio";
    for (const s of subjects) if (ELIFE_DOMAINS[s]) domain = ELIFE_DOMAINS[s];
    const title = stripTags(a.title ?? "");
    const abstract = stripTags(a.impactStatement ?? "");
    if (classifyText(`${title} ${abstract}`, domain) === "psy") domain = "psy";
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
    const link = text(it.link);
    const cats = arr<any>(it.category).map(text);
    return {
      id: `url:${link}`,
      source: "nasa" as const,
      domain: "phys" as const,
      title: clean(text(it.title)),
      abstract: stripTags(text(it.description)).replace(/The post .* appeared first on NASA Science\.?/, "").trim(),
      authors: ["NASA"],
      published: new Date(text(it.pubDate)).toISOString(),
      url: link,
      venue: "NASA Science",
      categories: cats,
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
      const link = text(it.link);
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
      url: text(it.link) || `https://doi.org/${doi}`,
      doi,
      venue: "Science Advances",
      categories: arr<any>(it["dc:subject"]).map(text),
      license: "Libre accès",
      fullText: { kind: "doi-lookup" as const, doi },
      availability: "pending" as const,
    };
  });
}

// ---------------------------------------------------------------- OpenAlex
const OPENALEX_FIELDS: { domain: DomainId; field: string }[] = [
  { domain: "psy", field: "32" },
  { domain: "info", field: "17" },
  { domain: "phys", field: "31" },
  { domain: "bio", field: "28" },
  { domain: "robot", field: "22" },
];

function invertedToText(inv: Record<string, number[]> | null | undefined) {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ");
}

async function openalex(): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const from = isoDaysAgo(21);
  for (const { domain, field } of OPENALEX_FIELDS) {
    const j = await getJson(
      `https://api.openalex.org/works?filter=from_publication_date:${from},is_oa:true,has_abstract:true,primary_topic.field.id:fields/${field},type:article&sort=cited_by_count:desc&per-page=15&select=id,doi,title,publication_date,ids,best_oa_location,locations,primary_topic,authorships,abstract_inverted_index,cited_by_count`,
    );
    for (const w of j.results ?? []) {
      const doi = w.doi ? String(w.doi).replace("https://doi.org/", "") : undefined;
      const pmcid = w.ids?.pmcid ? String(w.ids.pmcid).split("/").pop() : undefined;
      const arxivLoc = (w.locations ?? []).find((l: any) => /arxiv\.org/.test(l.landing_page_url ?? ""));
      const arxivId = arxivLoc?.landing_page_url?.match(/abs\/([^v]+?)(v\d+)?$/)?.[1];
      const pdf = w.best_oa_location?.pdf_url;
      let fullText: RawArticle["fullText"] | null = null;
      if (arxivId) fullText = { kind: "arxiv", arxivId };
      else if (pmcid) fullText = { kind: "pmc", pmcid: pmcid.startsWith("PMC") ? pmcid : `PMC${pmcid}` };
      else if (doi) fullText = { kind: "doi-lookup", doi };
      else if (pdf) fullText = { kind: "pdf", url: pdf };
      if (!fullText) continue;
      out.push({
        id: doi ? `doi:${doi.toLowerCase()}` : `openalex:${w.id}`,
        source: "openalex",
        domain,
        title: stripTags(w.title ?? ""),
        abstract: invertedToText(w.abstract_inverted_index),
        authors: (w.authorships ?? []).slice(0, 12).map((a: any) => a.author?.display_name).filter(Boolean),
        published: w.publication_date,
        url: w.best_oa_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : w.id),
        doi,
        venue: w.best_oa_location?.source?.display_name,
        categories: [w.primary_topic?.display_name].filter(Boolean),
        license: w.best_oa_location?.license ?? "Libre accès",
        fullText: fullText.kind === "doi-lookup" && pdf ? { kind: "pdf", url: pdf } : fullText,
        availability: fullText.kind === "doi-lookup" && !pdf ? "pending" : "ok",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Semantic Scholar
const S2_QUERIES: { domain: DomainId; q: string }[] = [
  { domain: "psy", q: "emotion regulation" },
  { domain: "robot", q: "robot learning" },
  { domain: "info", q: "large language models" },
];

async function semanticscholar(apiKey?: string): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  const year = new Date().getFullYear();
  for (const [i, { domain, q }] of S2_QUERIES.entries()) {
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
      domain: "psy" as const,
      title,
      abstract,
      authors: [],
      published: a.date_published ?? a.date_created,
      url: `https://osf.io/preprints/psyarxiv/${String(p.id).split("_")[0]}`,
      doi: a.doi ?? undefined,
      venue: "PsyArXiv",
      categories: (a.tags ?? []).slice(0, 8),
      license: "Prépublication en libre accès",
      fullText: { kind: "osf" as const, preprintId: p.id },
      availability: "ok" as const,
    };
  });
}

export const FETCHERS: Record<SourceId, (opts: { s2Key?: string }) => Promise<RawArticle[]>> = {
  arxiv: () => arxiv(),
  europepmc: () => europepmc(),
  biorxiv: () => rxiv("biorxiv"),
  medrxiv: () => rxiv("medrxiv"),
  plos: () => plos(),
  elife: () => elife(),
  nasa: () => nasa(),
  nature: () => nature(),
  sciadv: () => sciadv(),
  openalex: () => openalex(),
  semanticscholar: (o) => semanticscholar(o.s2Key),
  psyarxiv: () => psyarxiv(),
};
