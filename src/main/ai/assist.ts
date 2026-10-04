import type { Article } from "@shared/types";
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
