import type { Article, ArticleContent, ChatMessage } from "@shared/types";
import { llmJson } from "./llm";

const TEASER_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, title_fr: { type: "string" }, teaser_fr: { type: "string" } },
        required: ["id", "title_fr", "teaser_fr"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** French title and a two-sentence hook for feed cards. */
export async function makeTeasers(articles: Article[]): Promise<Map<string, { title: string; teaser: string }>> {
  const { data } = await llmJson<{ items: { id: string; title_fr: string; teaser_fr: string }[] }>({
    system: `Tu présentes des articles scientifiques à un lecteur francophone curieux, qui ne lit pas l'anglais.
Pour chaque article :
- "title_fr" : traduction fidèle du titre en français. Les termes techniques que les spécialistes utilisent en anglais restent en anglais : machine learning, transformer, topic MQTT, spin, kick, burst, dataset… Ne traduis jamais un terme technique par son sens courant (« kick » d'un trou noir n'est pas un « coup de pied », « spin » n'est pas une « rotation » au sens courant). Dans le doute, garde le mot anglais.
- "teaser_fr" : deux phrases simples et exactes qui disent ce que les chercheurs ont fait et ce qu'ils ont trouvé. Pas d'exagération, pas de « révolutionnaire », pas de promesse que l'article ne fait pas.`,
    user: JSON.stringify(articles.map((a) => ({ id: a.id, title: a.title, abstract: a.abstract.slice(0, 1400) }))),
    schema: TEASER_SCHEMA,
    maxTokens: 16000,
    tier: "light",
  });
  return new Map(data.items.map((i) => [i.id, { title: i.title_fr, teaser: i.teaser_fr }]));
}

export async function explainPassage(a: Article, passage: string): Promise<{ text: string; provider: string }> {
  const { data, provider } = await llmJson<{ explanation: string }>({
    system: `Tu aides un lecteur francophone à comprendre un article scientifique. Il a sélectionné un passage qu'il ne comprend pas.
Explique-le en français simple, comme à un étudiant motivé qui découvre le domaine : le sens du passage, les mots techniques qu'il contient (garde le terme anglais quand c'est l'usage et explique-le), et pourquoi c'est important dans l'article. Reste exact : ne déforme pas ce que disent les auteurs. 4 à 8 phrases, sans titre.`,
    user: `Article : « ${a.title} »\nRésumé : ${a.abstract.slice(0, 1500)}\n\nPassage sélectionné :\n${passage.slice(0, 4000)}`,
    schema: {
      type: "object",
      properties: { explanation: { type: "string" } },
      required: ["explanation"],
      additionalProperties: false,
    },
    maxTokens: 6000,
    tier: "heavy",
  });
  return { text: data.explanation, provider };
}

export interface AiInterest {
  label: string;
  keywords: string[];
}

/** Summarise what the reader likes, from the articles they engaged with. */
export async function analyzeInterests(liked: Article[], disliked: Article[]): Promise<AiInterest[]> {
  const fmt = (a: Article) => `- ${a.title} :: ${a.abstract.slice(0, 300)}`;
  const { data } = await llmJson<{ interests: AiInterest[] }>({
    system: `Tu es le moteur de recommandation d'une application de veille scientifique. À partir des articles qu'un lecteur a lus avec intérêt (et de ceux qu'il a écartés), décris ses centres d'intérêt.
Réponds avec 4 à 8 intérêts. Pour chacun : "label" (en français, précis, ex. « Régulation des émotions et instabilité de l'humeur ») et "keywords" (6 à 12 mots-clés EN ANGLAIS, tels qu'ils apparaissent dans les articles scientifiques, pour retrouver d'autres articles proches).`,
    user: `Articles appréciés :\n${liked.map(fmt).join("\n")}\n\nArticles écartés :\n${disliked.map(fmt).join("\n") || "(aucun)"}`,
    schema: {
      type: "object",
      properties: {
        interests: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, keywords: { type: "array", items: { type: "string" } } },
            required: ["label", "keywords"],
            additionalProperties: false,
          },
        },
      },
      required: ["interests"],
      additionalProperties: false,
    },
    maxTokens: 6000,
    tier: "light",
  });
  return data.interests;
}

// ---------------------------------------------------------------- chat about an article

const STOP_WORDS = new Set(
  "the of and to in is are was were that this with for which from by be as on these those has have it its their le la les de des du un une et en est sont que qui pour dans par sur au aux ce ces se sa son ses ne pas plus ou il elle ils elles on nous vous je tu".split(" "),
);
const words = (s: string) =>
  (s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));

/**
 * Picks the passages of the article that best match the question (and the recent
 * conversation), within a character budget: the model gets what it needs to answer
 * without being sent the whole article every time.
 */
export function relevantPassages(c: ArticleContent, query: string, budget: number): string {
  const plainText = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // Chunks = paragraphs (and captions) tagged with their section heading.
  const chunks: { text: string; order: number }[] = [];
  let section = "";
  c.blocks.forEach((b, i) => {
    if (b.t === "h") section = plainText(b.segs[0]);
    else if (b.t === "p" || b.t === "quote" || b.t === "li" || b.t === "fig" || b.t === "table") {
      const t = (b.segs ?? []).map(plainText).join(" ").trim();
      if (t.length > 40) chunks.push({ text: section ? `[${section}] ${t}` : t, order: i });
    }
  });
  const q = new Set(words(query));
  const df = new Map<string, number>();
  for (const ch of chunks) for (const w of new Set(words(ch.text))) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = chunks.map((ch) => {
    let s = 0;
    for (const w of new Set(words(ch.text))) if (q.has(w)) s += Math.log(1 + chunks.length / (df.get(w) ?? 1));
    return { ...ch, s };
  });
  // The opening of the article (abstract) is always useful context.
  const picked = new Set(scored.slice(0, 2));
  let used = [...picked].reduce((n, x) => n + x.text.length, 0);
  for (const ch of [...scored].sort((a, b) => b.s - a.s)) {
    if (used >= budget) break;
    if (picked.has(ch) || (ch.s === 0 && picked.size > 4)) continue;
    if (used + ch.text.length > budget * 1.1) continue;
    picked.add(ch);
    used += ch.text.length;
  }
  return [...picked].sort((a, b) => a.order - b.order).map((x) => x.text).join("\n\n");
}

export async function chatAboutArticle(
  a: Article,
  c: ArticleContent,
  history: ChatMessage[],
  question: string,
  local: boolean,
): Promise<{ text: string; provider: string }> {
  const recent = history.slice(-6);
  const query = [question, ...recent.filter((m) => m.role === "user").map((m) => m.text)].join(" ");
  // Small local models have a short memory: send them less.
  const passages = relevantPassages(c, query, local ? 3500 : 14000);
  const { data, provider } = await llmJson<{ answer: string }>({
    system: `Tu discutes avec un lecteur francophone d'un article scientifique qu'il est en train de lire. Il n'est pas forcément spécialiste du domaine.
Règles :
- Réponds en français clair et simple, comme un bon professeur. Garde les termes techniques anglais quand c'est l'usage, en les expliquant.
- Appuie-toi sur les extraits de l'article fournis. Quand tu cites un résultat, dis de quelle section il vient.
- Distingue bien ce que dit l'article de tes connaissances générales (« L'article dit… » / « De façon générale… »).
- Si l'article ne répond pas à la question, dis-le honnêtement au lieu d'inventer.
- Sois concis : 3 à 10 phrases, ou une courte liste si c'est plus clair. Tu peux utiliser du Markdown simple (gras, listes).`,
    user: `Article : « ${a.title} » (${a.venue ?? a.source}${a.authors.length ? `, ${a.authors.slice(0, 3).join(", ")}${a.authors.length > 3 ? " et al." : ""}` : ""})

Extraits de l'article utiles pour cette question :
${passages}

${recent.length ? `Conversation jusqu'ici :\n${recent.map((m) => `${m.role === "user" ? "Lecteur" : "Toi"} : ${m.text}`).join("\n")}\n\n` : ""}Question du lecteur : ${question}`,
    schema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    maxTokens: 6000,
    tier: "heavy",
  });
  return { text: data.answer, provider };
}
