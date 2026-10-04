import type { Article, DomainId } from "./types";

/**
 * What a reader can follow. An interest drives everything: which sources are asked,
 * the filters of both feeds, and where the recommendation algorithm starts from.
 */
export interface Interest {
  id: string;
  label: string;
  /** OpenAlex fields covered (research articles). */
  fields: DomainId[];
  /** OpenAlex topics (ids like "T10066"), for interests found with the free search. */
  topics?: string[];
  /** English keywords: give the algorithm a head start before any reading. */
  keywords: string[];
  /** French keywords: match news written in French (the news has no DOI to classify it). */
  fr?: string[];
  /** News tags: which official news sources match. */
  news: NewsTag[];
  /**
   * Tags this interest covers as a whole (Santé takes every Inserm post); for the
   * others only the posts that talk about the interest are kept.
   */
  newsBroad?: NewsTag[];
  /** Found with the free search rather than picked from the catalogue. */
  custom?: boolean;
}

export type NewsTag = "space" | "science" | "health" | "dev" | "ai" | "culture";

export type InterestGroup = "tech" | "life" | "human";

export const INTEREST_GROUPS: { id: InterestGroup; label: string }[] = [
  { id: "tech", label: "Sciences et technologies" },
  { id: "life", label: "Vivant et santé" },
  { id: "human", label: "Humain et société" },
];

export const INTEREST_CATALOG: (Interest & { group: InterestGroup })[] = [
  { group: "tech", id: "space", label: "Espace et astronomie", fields: ["31", "19"], keywords: ["space", "astronomy", "galaxy", "exoplanet", "telescope", "black hole"], fr: ["espace", "astronom", "galaxie", "exoplanète", "télescope", "trou noir", "planète", "étoile", "satellite"], news: ["space", "science"], newsBroad: ["space"] },
  { group: "tech", id: "physics", label: "Physique", fields: ["31"], keywords: ["quantum", "particle", "physics", "laser", "photon"], fr: ["physique", "quantique", "particule", "laser", "photon", "lumière"], news: ["science"] },
  { group: "tech", id: "ai", label: "Intelligence artificielle", fields: ["17"], keywords: ["artificial intelligence", "machine learning", "deep learning", "language model", "neural network"], fr: ["intelligence artificielle", "apprentissage automatique", "réseau de neurones", "algorithme", "IA", "AI", "LLM", "Copilot", "Gemini", "Claude"], news: ["ai", "science"] },
  { group: "tech", id: "dev", label: "Programmation et outils de dev", fields: ["17"], keywords: ["software engineering", "programming", "open source", "developer", "compiler"], fr: ["logiciel", "programmation", "développeur", "open source", "code source"], news: ["dev"], newsBroad: ["dev"] },
  { group: "tech", id: "security", label: "Cybersécurité", fields: ["17"], keywords: ["cybersecurity", "security", "vulnerability", "encryption", "privacy"], fr: ["cybersécurité", "sécurité informatique", "piratage", "chiffrement", "vie privée"], news: ["dev"] },
  { group: "tech", id: "robotics", label: "Robotique", fields: ["22", "17"], keywords: ["robot", "robotics", "autonomous", "drone", "manipulation"], fr: ["robot", "robotique", "drone", "autonome"], news: ["science"] },
  { group: "tech", id: "electronics", label: "Électronique et objets connectés", fields: ["22"], keywords: ["electronics", "embedded", "sensor", "internet of things", "circuit"], fr: ["électronique", "capteur", "objets connectés", "puce", "semi-conducteur"], news: ["dev"] },
  { group: "tech", id: "energy", label: "Énergie", fields: ["21", "22"], keywords: ["energy", "battery", "solar", "hydrogen", "renewable"], fr: ["énergie", "batterie", "solaire", "hydrogène", "renouvelable", "nucléaire"], news: ["science"] },
  { group: "tech", id: "maths", label: "Mathématiques", fields: ["26"], keywords: ["mathematics", "theorem", "algebra", "probability", "statistics"], fr: ["mathématique", "théorème", "algèbre", "probabilité", "statistique"], news: ["science"] },
  { group: "tech", id: "chemistry", label: "Chimie et matériaux", fields: ["16", "25", "15"], keywords: ["chemistry", "material", "polymer", "catalysis", "nanomaterial"], fr: ["chimie", "chimique", "matériau", "polymère", "molécule", "catalyse"], news: ["science"] },
  { group: "tech", id: "climate", label: "Climat et environnement", fields: ["23", "19"], keywords: ["climate", "environment", "pollution", "biodiversity", "carbon"], fr: ["climat", "environnement", "pollution", "biodiversité", "carbone", "CO₂", "réchauffement"], news: ["science"] },
  { group: "tech", id: "earth", label: "Sciences de la Terre", fields: ["19"], keywords: ["geology", "volcano", "earthquake", "ocean", "geophysics"], fr: ["géologie", "volcan", "séisme", "océan", "glacier", "géophysique"], news: ["science"] },
  { group: "life", id: "biology", label: "Biologie et génétique", fields: ["13"], keywords: ["gene", "genome", "cell", "protein", "dna", "evolution"], fr: ["gène", "génome", "cellule", "protéine", "ADN", "évolution", "biologie"], news: ["science"] },
  { group: "life", id: "brain", label: "Cerveau et neurosciences", fields: ["28"], keywords: ["brain", "neuron", "neuroscience", "memory", "cognition"], fr: ["cerveau", "neurone", "neuroscience", "mémoire", "cognition"], news: ["health", "science"] },
  { group: "life", id: "health", label: "Santé et médecine", fields: ["27", "36", "29"], keywords: ["health", "disease", "patient", "treatment", "clinical"], fr: ["santé", "maladie", "patient", "traitement", "médecin", "hôpital", "accouchement", "soin"], news: ["health"], newsBroad: ["health"] },
  { group: "life", id: "microbes", label: "Virus, microbes et immunité", fields: ["24"], keywords: ["virus", "bacteria", "immune", "vaccine", "microbiome"], fr: ["virus", "bactérie", "immunitaire", "vaccin", "microbiote", "épidémie"], news: ["health"] },
  { group: "life", id: "drugs", label: "Médicaments", fields: ["30"], keywords: ["drug", "pharmacology", "toxicity", "therapy"], fr: ["médicament", "pharmacologie", "toxicité", "thérapie"], news: ["health"] },
  { group: "life", id: "sport", label: "Sport et corps humain", fields: ["27", "36"], keywords: ["sport", "exercise", "physical activity", "athlete", "training"], fr: ["sport", "exercice", "activité physique", "athlète", "entraînement", "football"], news: ["health"] },
  { group: "life", id: "food", label: "Agriculture et alimentation", fields: ["11"], keywords: ["agriculture", "food", "crop", "soil", "nutrition"], fr: ["agriculture", "alimentation", "culture agricole", "sol", "nutrition", "aliment"], news: ["science"] },
  { group: "life", id: "nature", label: "Animaux et nature", fields: ["11", "34"], keywords: ["animal", "species", "ecology", "wildlife", "plant"], fr: ["animal", "animaux", "espèce", "écologie", "faune", "plante", "chauve-souris", "oiseau"], news: ["science"] },
  { group: "human", id: "psychology", label: "Psychologie et émotions", fields: ["32"], keywords: ["emotion", "psychology", "behavior", "mental health", "anxiety", "personality"], fr: ["émotion", "psychologie", "comportement", "santé mentale", "anxiété", "personnalité"], news: ["health", "science"] },
  { group: "human", id: "society", label: "Société et sociologie", fields: ["33"], keywords: ["society", "social", "inequality", "politics", "migration"], fr: ["société", "social", "inégalité", "politique", "migration", "natalité", "sociologie"], news: ["culture"] },
  { group: "human", id: "economy", label: "Économie et finance", fields: ["20", "14", "18"], keywords: ["economy", "finance", "market", "inflation", "business"], fr: ["économie", "finance", "marché", "inflation", "entreprise", "économique"], news: ["culture"] },
  { group: "human", id: "history", label: "Histoire et archéologie", fields: ["12"], keywords: ["history", "archaeology", "ancient", "heritage", "war"], fr: ["histoire", "historique", "archéologie", "antique", "patrimoine", "guerre", "gaulois", "médiéval"], news: ["culture"] },
  { group: "human", id: "arts", label: "Arts, littérature et culture", fields: ["12"], keywords: ["art", "literature", "music", "culture", "cinema"], fr: ["art", "littérature", "musique", "culture", "cinéma", "artiste", "orfèvre"], news: ["culture"] },
  { group: "human", id: "philosophy", label: "Philosophie et religions", fields: ["12"], keywords: ["philosophy", "ethics", "religion", "epistemology"], fr: ["philosophie", "éthique", "religion", "épistémologie"], news: ["culture"] },
  { group: "human", id: "education", label: "Éducation et apprentissage", fields: ["33", "32"], keywords: ["education", "learning", "teaching", "school", "students"], fr: ["éducation", "apprentissage", "enseignement", "école", "élève", "étudiant"], news: ["culture"] },
];

/** News sources and what they cover. */
export const NEWS_SOURCE_TAGS: Record<string, NewsTag[]> = {
  nasa: ["space"],
  esa: ["space"],
  cnrs: ["science", "culture", "health"],
  inserm: ["health"],
  devtools: ["dev", "ai"],
};

/**
 * Disciplines next to a set of interests, to explore: those of the other catalogue
 * interests in the same family, and those of the searched topics.
 */
export function neighbourFields(interests: Interest[]): DomainId[] {
  const mine = new Set(fieldsOf(interests));
  const ids = new Set(interests.map((i) => i.id));
  const groups = new Set(INTEREST_CATALOG.filter((c) => ids.has(c.id)).map((c) => c.group));
  const near = [
    ...INTEREST_CATALOG.filter((c) => groups.has(c.group) && !ids.has(c.id)).flatMap((c) => c.fields),
    ...interests.filter((i) => i.custom).flatMap((i) => i.fields),
  ];
  return [...new Set(near)].filter((f) => !mine.has(f));
}

/** Disciplines to fetch for a set of interests. */
export function fieldsOf(interests: Interest[]): DomainId[] {
  // A searched topic is followed on its own, not with its whole discipline.
  return [...new Set(interests.filter((i) => !i.custom).flatMap((i) => i.fields))];
}

/** News tags wanted by a set of interests. */
export function newsTagsOf(interests: Interest[]): Set<NewsTag> {
  return new Set(interests.flatMap((i) => i.news));
}

/**
 * How well the app covers an interest with official news: "full" (a source made for
 * it), "general" (only when the CNRS journal talks about it), "none".
 */
export function newsCoverage(saved: Interest): "full" | "general" | "none" {
  const i = INTEREST_CATALOG.find((c) => c.id === saved.id) ?? saved;
  const specialised = new Set(["space", "health", "dev", "ai"]);
  if (i.news.some((t) => specialised.has(t))) return "full";
  return i.news.length ? "general" : "none";
}

/** Does an article belong to an interest (used by the feed filters)? */
export function matchesInterest(saved: Interest, a: Article): boolean {
  // Catalogue interests are read from the catalogue, so its updates reach saved choices.
  const i = INTEREST_CATALOG.find((c) => c.id === saved.id) ?? saved;
  if (i.topics?.length && a.topicId && i.topics.includes(a.topicId)) return true;
  if (a.kind === "news") {
    // Posts saved before tags existed: the tags of their source.
    const tags = a.newsTags ?? NEWS_SOURCE_TAGS[a.source] ?? [];
    // A general source (CNRS…) covers everything: its posts are sorted by discipline.
    // A specialised one (NASA, Inserm, developer blogs) matches by what it covers.
    if (tags.includes("science")) return i.fields.includes(a.domain) || mentions(i, a);
    return i.news.some((t) => tags.includes(t) && (i.newsBroad?.includes(t) || mentions(i, a)));
  }
  return !i.custom && i.fields.includes(a.domain);
}

/** Does a news post talk about an interest: in its title, or twice in its summary? */
function mentions(i: Interest, a: Article): boolean {
  const norm = (t: string) => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}₂]+/gu, " ")} `;
  // Long words match as prefixes ("astronom…"); short ones only whole ("art" ≠ "article").
  const words = [i.label, ...i.keywords, ...(i.fr ?? [])]
    .map((w) => norm(w))
    .map((w) => (w.trim().length > 4 ? w.trimEnd() : w))
    .filter((w) => w.trim().length > 1);
  const title = norm(a.titleFr ? `${a.title} ${a.titleFr}` : a.title);
  if (words.some((w) => title.includes(w))) return true;
  const body = norm(a.abstract);
  return words.filter((w) => body.includes(w)).length >= 2;
}
