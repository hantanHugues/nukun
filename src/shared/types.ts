/**
 * A discipline, as classified by OpenAlex ("fields" 11 to 36, grouped in 4 domains).
 * "0" means not classified yet.
 */
export type DomainId = string;

import type { Interest } from "./interests";
export type { Interest } from "./interests";

export type FieldGroup = "life" | "social" | "physical" | "health";

export const FIELD_GROUPS: { id: FieldGroup; label: string }[] = [
  { id: "physical", label: "Sciences physiques et ingénierie" },
  { id: "life", label: "Sciences de la vie" },
  { id: "health", label: "Sciences de la santé" },
  { id: "social", label: "Sciences humaines et sociales" },
];

export const FIELDS: { id: DomainId; label: string; group: FieldGroup }[] = [
  { id: "17", label: "Informatique", group: "physical" },
  { id: "22", label: "Ingénierie", group: "physical" },
  { id: "31", label: "Physique et astronomie", group: "physical" },
  { id: "26", label: "Mathématiques", group: "physical" },
  { id: "16", label: "Chimie", group: "physical" },
  { id: "15", label: "Génie chimique", group: "physical" },
  { id: "25", label: "Science des matériaux", group: "physical" },
  { id: "21", label: "Énergie", group: "physical" },
  { id: "19", label: "Sciences de la Terre", group: "physical" },
  { id: "23", label: "Environnement", group: "physical" },
  { id: "13", label: "Biochimie et génétique", group: "life" },
  { id: "28", label: "Neurosciences", group: "life" },
  { id: "24", label: "Immunologie et microbiologie", group: "life" },
  { id: "11", label: "Agriculture et biologie", group: "life" },
  { id: "30", label: "Pharmacologie", group: "life" },
  { id: "27", label: "Médecine", group: "health" },
  { id: "29", label: "Soins infirmiers", group: "health" },
  { id: "36", label: "Professions de santé", group: "health" },
  { id: "35", label: "Odontologie", group: "health" },
  { id: "34", label: "Médecine vétérinaire", group: "health" },
  { id: "32", label: "Psychologie", group: "social" },
  { id: "33", label: "Sciences sociales", group: "social" },
  { id: "12", label: "Arts et humanités", group: "social" },
  { id: "20", label: "Économie et finance", group: "social" },
  { id: "14", label: "Gestion", group: "social" },
  { id: "18", label: "Sciences de la décision", group: "social" },
];

export const UNCLASSIFIED: DomainId = "0";

export const fieldLabel = (id: DomainId) => FIELDS.find((f) => f.id === id)?.label ?? "Non classé";
export const fieldGroup = (id: DomainId): FieldGroup | undefined => FIELDS.find((f) => f.id === id)?.group;

/** Languages of articles the app can fetch and translate (ISO 639-1). */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "Anglais" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Espagnol" },
  { id: "pt", label: "Portugais" },
  { id: "de", label: "Allemand" },
  { id: "ru", label: "Russe" },
  { id: "ja", label: "Japonais" },
  { id: "zh", label: "Chinois" },
];
export const languageLabel = (id?: string) => LANGUAGES.find((l) => l.id === id)?.label ?? id ?? "Anglais";

export type SourceId =
  | "arxiv"
  | "europepmc"
  | "biorxiv"
  | "medrxiv"
  | "plos"
  | "elife"
  | "nasa"
  | "nature"
  | "sciadv"
  | "openalex"
  | "semanticscholar"
  | "psyarxiv"
  | "hal"
  | "scielo"
  | "esa"
  | "cnrs"
  | "inserm"
  | "devtools";

/** "paper": research published by scientists. "news": short news from official organisations. */
export type ArticleKind = "paper" | "news";
/** Topic of a news item. */
export type NewsTopic = "science" | "tech";

export const SOURCES: { id: SourceId; label: string; description: string }[] = [
  { id: "arxiv", label: "arXiv", description: "Prépublications en informatique, IA, robotique, physique et biologie quantitative" },
  { id: "europepmc", label: "Europe PMC", description: "Articles biomédicaux et de psychologie en libre accès (PubMed Central)" },
  { id: "biorxiv", label: "bioRxiv", description: "Prépublications en biologie" },
  { id: "medrxiv", label: "medRxiv", description: "Prépublications en médecine et psychiatrie" },
  { id: "plos", label: "PLOS", description: "Revues entièrement en libre accès (PLOS One, Biology…)" },
  { id: "elife", label: "eLife", description: "Revue en libre accès en sciences du vivant et neurosciences" },
  { id: "nasa", label: "NASA Science", description: "Actus : actualités scientifiques officielles de la NASA" },
  { id: "nature", label: "Nature (OA)", description: "Nature Communications et Scientific Reports, en libre accès" },
  { id: "sciadv", label: "Science Advances", description: "Revue en libre accès de l'AAAS (texte via Europe PMC)" },
  { id: "openalex", label: "OpenAlex", description: "Index mondial de toutes les disciplines, en libre accès, et articles en allemand, russe, japonais et chinois" },
  { id: "semanticscholar", label: "Semantic Scholar", description: "Moteur de recherche académique (limité sans clé API)" },
  { id: "psyarxiv", label: "PsyArXiv", description: "Prépublications en psychologie" },
  { id: "hal", label: "HAL", description: "Archive ouverte française, toutes disciplines, beaucoup d'articles en français" },
  { id: "scielo", label: "SciELO", description: "Revues d'Amérique latine, d'Espagne et du Portugal, en espagnol et en portugais" },
  { id: "esa", label: "ESA", description: "Actus : Agence spatiale européenne" },
  { id: "cnrs", label: "CNRS Le journal", description: "Actus : le journal du CNRS, toutes sciences, en français" },
  { id: "inserm", label: "Inserm", description: "Actus : santé et recherche médicale, en français" },
  {
    id: "devtools",
    label: "Outils de développement",
    description: "Actus : blogs officiels de GitHub, VS Code, TypeScript, Node.js, React, Rust, Kotlin, Android, Chrome, Docker, Mozilla",
  },
];

/** How the full text of an article can be obtained. */
export type FullTextRef =
  | { kind: "arxiv"; arxivId: string }
  | { kind: "jats"; url: string; imageBase?: string; imageMode: "biorxiv" | "plos" | "pmc" | "elife"; pmcid?: string; articleId?: string }
  | { kind: "pmc"; pmcid: string }
  | { kind: "html"; url: string; mode: "nature" | "scielo" | "readable"; pdf?: string }
  | { kind: "inline"; html: string; baseUrl: string }
  | { kind: "pdf"; url: string }
  | { kind: "osf"; preprintId: string }
  | { kind: "doi-lookup"; doi: string };

export interface Article {
  id: string;
  source: SourceId;
  domain: DomainId;
  title: string;
  abstract: string;
  authors: string[];
  published: string; // ISO date
  fetchedAt: string;
  url: string; // landing page
  kind?: ArticleKind; // "paper" when absent
  topic?: NewsTopic; // for news
  newsTags?: string[]; // for news: what its source covers (space, health, dev…)
  topicId?: string; // OpenAlex topic ("T10066"), when known
  lang?: string; // language of the article (ISO 639-1), "en" when unknown
  doi?: string;
  venue?: string;
  categories: string[];
  license?: string;
  image?: string; // thumbnail
  fullText: FullTextRef;
  /** "pending" means the free full text is not reachable yet (rechecked later). */
  availability: "ok" | "pending";
  checkedAt?: string; // last time a pending full text was looked for
  classified?: boolean; // discipline checked with OpenAlex
  langChecked?: boolean; // language checked against the text itself
  loadError?: string;
  // AI-generated French presentation
  titleFr?: string;
  teaserFr?: string;
  // user state
  state: ArticleState;
}

export interface ArticleState {
  impressions: number;
  opened: number;
  dwellSec: number;
  progress: number; // 0..1 max scroll
  scrollPos?: number; // last scroll ratio
  liked?: boolean;
  saved?: boolean;
  dismissed?: boolean;
  /** Taken out of the library by the reader. */
  removed?: boolean;
  finished?: boolean;
  posted?: boolean;
  lastOpened?: string;
}

export type Block =
  | { t: "h"; level: number; segs: [string] }
  | { t: "p"; segs: [string] }
  | { t: "li"; ordered: boolean; segs: string[] }
  | { t: "quote"; segs: [string] }
  | { t: "fig"; src: string[]; label?: string; segs: [string] }
  | { t: "table"; html: string; label?: string; segs: [string] }
  | { t: "eq"; html: string; segs?: [] }
  | { t: "code"; text: string; segs?: [] }
  | { t: "refs"; items: string[]; segs?: [] };

export interface GlossaryTerm {
  term: string;
  keep: boolean; // kept in English in the translation
  fr?: string; // French rendering when translated
  definition: string; // short explanation in French
}

export interface ArticleContent {
  id: string;
  blocks: Block[];
  pdfUrl?: string;
  originalUrl: string;
  note?: string; // e.g. "Texte extrait du PDF"
  /** translations[blockIndex][segIndex] = French html */
  tr: Record<number, string[]>;
  glossary?: GlossaryTerm[];
  translatedBy?: string;
  /** Passages translated so far, by provider (including the shared memory). */
  trBy?: Record<string, number>;
  /** Explanations asked while reading this article, kept for later visits. */
  explanations?: Explanation[];
  /** Conversation with the AI about this article. */
  chat?: ChatMessage[];
}

export interface Explanation {
  q: string; // the selected passage
  a: string; // the explanation in French
  by: string; // who answered: an AI, the shared memory or the glossary
  at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  by?: string; // which AI answered
  at: string;
}

export interface AiStatus {
  gemini: boolean;
  claudeCode: boolean;
  ollama: boolean;
  ollamaModels: string[];
  /** Graphics card of this PC and the local model it can run best. */
  gpu: string;
  vramGb: number;
  advice: { model: string; sizeGb: number; why: string };
}

export interface TopicHit {
  id: string; // "T10066"
  name: string; // English name from OpenAlex
  nameFr?: string; // translated once, then kept
  field: DomainId;
  count: number; // recent papers found
}

export interface FeedItem {
  article: Article;
  score: number;
  reasons: string[];
  discovery?: boolean;
}

export type AiProvider = "hybrid" | "gemini" | "ollama" | "claude-code" | "claude" | "auto";

export interface Settings {
  provider: AiProvider;
  claudeModel: string;
  claudeCodeModel: "opus" | "sonnet" | "haiku";
  geminiModel: string;
  hasGeminiKey: boolean;
  hasClaudeKey: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  autoTranslate: boolean;
  keepTermsHint: string; // extra user rules for the translator
  sources: Record<SourceId, boolean>;
  domains: Record<DomainId, boolean>;
  /** Languages of articles to show. */
  languages: Record<string, boolean>;
  /** What the reader follows; drives sources, filters and the algorithm. */
  interests: Interest[];
  /** The interests screen has been completed (shown before the very first refresh). */
  interestsChosen?: boolean;
  /** Interest suggestions the reader turned down. */
  dismissedSuggestions?: string[];
  refreshHours: number;
  exportDir: string;
  theme: "system" | "dark" | "light";
  readerSize: number;
  semanticScholarKey?: string;
  hasSemanticScholarKey?: boolean;
  /** The first-run tutorial has been completed (or skipped). */
  onboarded?: boolean;
}

export interface UsageStats {
  claudeInputTokens: number;
  claudeOutputTokens: number;
  claudeCostUsd: number;
  ollamaCalls: number;
  claudeCodeCalls: number;
  geminiCalls: number;
  monthKey: string;
  monthCostUsd: number;
}

export interface SourceStatus {
  source: SourceId;
  lastRun?: string;
  lastCount?: number;
  error?: string;
}

export interface Draft {
  articleId: string;
  title: string;
  summary: string;
  tags: string;
  body: string;
  updatedAt: string;
  exportedPath?: string;
}

export interface InterestProfileView {
  /** The reader's interests: share of the feed, articles read, news coverage. */
  interests: { id: string; label: string; share: number; read: number; news: "full" | "general" | "none"; custom?: boolean }[];
  /** Disciplines explored next to the interests at the moment. */
  explore: DomainId[];
  /** Recommendations by meaning (multilingual model): state and articles analysed. */
  semantic: { state: "idle" | "loading" | "ready" | "error"; analysed: number };
  topTerms: { term: string; weight: number }[];
  domains: { id: DomainId; weight: number; impressions: number }[];
  aiInterests: { label: string; keywords: string[] }[];
  signals: number;
}

export type InteractionType =
  | "impression"
  | "open"
  | "dwell"
  | "progress"
  | "like"
  | "unlike"
  | "save"
  | "unsave"
  | "dismiss"
  | "finish"
  | "posted"
  /** Taken out of the library: gone from the library and the feed, not a dislike. */
  | "remove";

export interface Interaction {
  id: string;
  type: InteractionType;
  value?: number;
}

export interface RefreshProgress {
  running: boolean;
  step: string;
  done: number;
  total: number;
  newArticles?: number;
}

export interface TranslationProgress {
  id: string;
  done: number;
  total: number;
  error?: string;
  finished?: boolean;
}

export interface NukunApi {
  /** `domain`: "all", a field id, or "g:<group>". */
  /** One page of the feed; `fresh` ranks again instead of continuing the current ranking. */
  getFeed(opts: { domain?: string; limit?: number; offset?: number; fresh?: boolean; kind?: ArticleKind }): Promise<FeedItem[]>;
  /** How many readable articles each of the reader's interests has, per feed. */
  fieldCounts(kind?: ArticleKind): Promise<Record<string, number>>;
  getLibrary(): Promise<Article[]>;
  getArticle(id: string): Promise<Article | undefined>;
  loadContent(id: string): Promise<ArticleContent>;
  translate(id: string, force?: boolean): Promise<void>;
  /** Translate only these passages ("block:segment"), typically the ones on screen. */
  translateVisible(id: string, keys: string[]): Promise<void>;
  explain(id: string, text: string): Promise<Explanation>;
  /** Explain a figure (block index) from its image and caption. */
  explainFigure(id: string, block: number): Promise<Explanation>;
  /** Ask the AI a question about the article; it answers from the article's text. */
  chat(id: string, question: string): Promise<ChatMessage>;
  clearChat(id: string): Promise<void>;
  aiStatus(): Promise<AiStatus>;
  /** Save the reader's interests and languages, then fetch articles for them. */
  setInterests(interests: Interest[], languages: Record<string, boolean>): Promise<void>;
  /** Research topics matching free text (any language), from OpenAlex. */
  searchTopics(q: string): Promise<TopicHit[]>;
  /** An interest the reader seems to like without having chosen it, if any. */
  suggestion(): Promise<Interest | null>;
  dismissSuggestion(id: string): Promise<void>;
  interact(i: Interaction): Promise<void>;
  saveScroll(id: string, ratio: number): Promise<void>;
  refresh(): Promise<void>;
  /** Cards on screen: French title, image and full text, prepared in the background. */
  prepareCards(ids: string[]): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings> & { claudeKey?: string; semanticScholarKey?: string; geminiKey?: string }): Promise<Settings>;
  testAi(): Promise<{ ok: boolean; message: string }>;
  ollamaModels(): Promise<string[]>;
  getUsage(): Promise<UsageStats>;
  getSourceStatus(): Promise<SourceStatus[]>;
  getProfile(): Promise<InterestProfileView>;
  resetProfile(): Promise<void>;
  analyzeInterests(): Promise<void>;
  getDraft(articleId: string): Promise<Draft | undefined>;
  listDrafts(): Promise<Draft[]>;
  saveDraft(d: Draft): Promise<void>;
  exportDraft(articleId: string): Promise<string>;
  chooseDir(): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
  setTitleBarTheme(dark: boolean): Promise<void>;
  on(channel: "refresh-progress", cb: (p: RefreshProgress) => void): () => void;
  on(channel: "translation-progress", cb: (p: TranslationProgress) => void): () => void;
  on(channel: "feed-updated", cb: () => void): () => void;
}
