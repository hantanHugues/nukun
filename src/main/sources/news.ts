import { XMLParser } from "fast-xml-parser";
import type { DomainId, NewsTopic } from "@shared/types";
import { getText, stripTags } from "../http";
import { classifyText, detectLanguage } from "./classify";
import type { RawArticle } from "./index";
import { NEWS_SOURCE_TAGS } from "@shared/interests";

/**
 * News from official organisations and official developer blogs, read from their
 * RSS or Atom feeds. When a feed carries the whole post it is used as is; otherwise
 * the reader extracts the article from the official page (Readability).
 */
interface NewsFeed {
  url: string;
  venue: string;
  topic: NewsTopic;
  /** Discipline of every post; classified from the text when absent. */
  field?: DomainId;
  /** Posts kept per refresh. */
  max?: number;
}

export const NEWS_FEEDS: Record<"esa" | "cnrs" | "inserm" | "devtools", NewsFeed[]> = {
  esa: [{ url: "https://www.esa.int/rssfeed/Our_Activities/Space_Science", venue: "ESA", topic: "science", field: "31" }],
  cnrs: [{ url: "https://lejournal.cnrs.fr/rss", venue: "CNRS Le journal", topic: "science" }],
  inserm: [{ url: "https://www.inserm.fr/feed/", venue: "Inserm", topic: "science", field: "27" }],
  devtools: [
    { url: "https://github.blog/feed/", venue: "GitHub Blog", topic: "tech", max: 6 },
    { url: "https://code.visualstudio.com/feed.xml", venue: "VS Code", topic: "tech", max: 4 },
    { url: "https://devblogs.microsoft.com/typescript/feed/", venue: "TypeScript", topic: "tech", max: 4 },
    { url: "https://nodejs.org/en/feed/blog.xml", venue: "Node.js", topic: "tech", max: 4 },
    { url: "https://react.dev/rss.xml", venue: "React", topic: "tech", max: 3 },
    { url: "https://blog.rust-lang.org/feed.xml", venue: "Rust", topic: "tech", max: 4 },
    { url: "https://blog.jetbrains.com/kotlin/feed/", venue: "Kotlin", topic: "tech", max: 4 },
    { url: "https://android-developers.googleblog.com/feeds/posts/default", venue: "Android Developers", topic: "tech", max: 4 },
    { url: "https://developer.chrome.com/static/blog/feed.xml", venue: "Chrome for Developers", topic: "tech", max: 4 },
    { url: "https://www.docker.com/blog/feed/", venue: "Docker", topic: "tech", max: 4 },
    { url: "https://hacks.mozilla.org/feed/", venue: "Mozilla Hacks", topic: "tech", max: 3 },
  ],
};

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  isArray: (name) => ["entry", "item", "link", "category", "media:content"].includes(name),
});
const arr = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

/** A whole post, not just a teaser: a few paragraphs of real text. */
const isFullPost = (html: string) => (html.match(/<p[\s>]/g)?.length ?? 0) >= 3 && stripTags(html).length > 800;

async function readFeed(f: NewsFeed): Promise<RawArticle[]> {
  const doc = xml.parse(await getText(f.url, { browser: true }));
  const rss = arr<any>(doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item);
  const atom = arr<any>(doc.feed?.entry);
  const entries = rss.length ? rss : atom;
  const out: RawArticle[] = [];
  for (const it of entries.slice(0, f.max ?? 10)) {
    const title = stripTags(text(it.title));
    // RSS: <link>url</link>. Atom: <link rel="alternate" href="url"/>.
    const links = arr<any>(it.link);
    const link =
      (typeof links[0] === "string" ? links[0] : "") ||
      links.find((l) => l?.["@rel"] === "alternate" || !l?.["@rel"])?.["@href"] ||
      text(it.guid);
    if (!title || !link) continue;
    const full = text(it["content:encoded"]) || text(it.content);
    const summary = stripTags(text(it.description) || text(it.summary) || full).slice(0, 1200);
    const date = text(it.pubDate) || text(it.published) || text(it.updated) || text(it["dc:date"]);
    const image =
      arr<any>(it["media:content"])[0]?.["@url"] ||
      it.enclosure?.["@url"] ||
      (full || text(it.description)).match(/<img[^>]+src="([^"]+)"/)?.[1];
    const body = `${title} ${summary}`;
    out.push({
      id: `url:${link}`,
      source: "devtools", // replaced by the caller
      kind: "news",
      topic: f.topic,
      domain: f.field ?? (f.topic === "tech" ? "17" : classifyText(body)),
      title,
      abstract: summary,
      authors: [f.venue],
      published: date ? new Date(date).toISOString() : new Date().toISOString(),
      url: link,
      venue: f.venue,
      categories: arr<any>(it.category).map((c) => text(c) || c?.["@term"]).filter(Boolean).slice(0, 6),
      lang: detectLanguage(body) ?? "en",
      license: `Publication officielle (${f.venue})`,
      image,
      fullText: isFullPost(full) ? { kind: "inline", html: full, baseUrl: link } : { kind: "html", url: link, mode: "readable" },
      availability: "ok",
    });
  }
  return out;
}

export async function news(source: keyof typeof NEWS_FEEDS): Promise<RawArticle[]> {
  const out: RawArticle[] = [];
  for (const f of NEWS_FEEDS[source]) {
    try {
      for (const a of await readFeed(f)) out.push({ ...a, source, newsTags: NEWS_SOURCE_TAGS[source] });
    } catch {
      /* one blog down does not stop the others */
    }
  }
  return out;
}
