export type DomainId = "info" | "robot" | "phys" | "bio" | "psy" | "autre";

export const DOMAINS: { id: DomainId; label: string; short: string }[] = [
  { id: "info", label: "Informatique & IA", short: "Info & IA" },
  { id: "robot", label: "Robotique & électronique", short: "Robotique" },
  { id: "phys", label: "Physique & espace", short: "Physique & espace" },
  { id: "bio", label: "Biologie & médecine", short: "Bio & médecine" },
  { id: "psy", label: "Psychologie & émotions", short: "Psychologie" },
  { id: "autre", label: "Autres sciences", short: "Autre" },
];

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
  | "psyarxiv";

export const SOURCES: { id: SourceId; label: string; description: string }[] = [
  { id: "arxiv", label: "arXiv", description: "Prépublications en informatique, IA, robotique, physique et biologie quantitative" },
  { id: "europepmc", label: "Europe PMC", description: "Articles biomédicaux et de psychologie en libre accès (PubMed Central)" },
  { id: "biorxiv", label: "bioRxiv", description: "Prépublications en biologie" },
  { id: "medrxiv", label: "medRxiv", description: "Prépublications en médecine et psychiatrie" },
  { id: "plos", label: "PLOS", description: "Revues entièrement en libre accès (PLOS One, Biology…)" },
  { id: "elife", label: "eLife", description: "Revue en libre accès en sciences du vivant et neurosciences" },
  { id: "nasa", label: "NASA Science", description: "Actualités scientifiques officielles de la NASA" },
  { id: "nature", label: "Nature (OA)", description: "Nature Communications et Scientific Reports, en libre accès" },
  { id: "sciadv", label: "Science Advances", description: "Revue en libre accès de l'AAAS (texte via Europe PMC)" },
  { id: "openalex", label: "OpenAlex", description: "Index mondial des publications, filtré sur le libre accès" },
  { id: "semanticscholar", label: "Semantic Scholar", description: "Moteur de recherche académique (limité sans clé API)" },
  { id: "psyarxiv", label: "PsyArXiv", description: "Prépublications en psychologie" },
];

/** How the full text of an article can be obtained. */
export type FullTextRef =
  | { kind: "arxiv"; arxivId: string }
  | { kind: "jats"; url: string; imageBase?: string; imageMode: "biorxiv" | "plos" | "pmc" | "elife"; pmcid?: string; articleId?: string }
  | { kind: "pmc"; pmcid: string }
  | { kind: "html"; url: string; mode: "nature" }
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
  doi?: string;
  venue?: string;
  categories: string[];
  license?: string;
  image?: string; // thumbnail
  fullText: FullTextRef;
  /** "pending" means the free full text is not reachable yet (rechecked later). */
  availability: "ok" | "pending";
  checkedAt?: string; // last time a pending full text was looked for
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
}

export interface Explanation {
  q: string; // the selected passage
  a: string; // the explanation in French
  by: string; // who answered: an AI, the shared memory or the glossary
  at: string;
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
  refreshHours: number;
  exportDir: string;
  theme: "system" | "dark" | "light";
  readerSize: number;
  semanticScholarKey?: string;
  hasSemanticScholarKey?: boolean;
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
  | "posted";

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

export interface VeilleApi {
  getFeed(opts: { domain?: DomainId | "all"; limit?: number }): Promise<FeedItem[]>;
  getLibrary(): Promise<Article[]>;
  getArticle(id: string): Promise<Article | undefined>;
  loadContent(id: string): Promise<ArticleContent>;
  translate(id: string, force?: boolean): Promise<void>;
  /** Translate only these passages ("block:segment"), typically the ones on screen. */
  translateVisible(id: string, keys: string[]): Promise<void>;
  explain(id: string, text: string): Promise<Explanation>;
  interact(i: Interaction): Promise<void>;
  saveScroll(id: string, ratio: number): Promise<void>;
  refresh(): Promise<void>;
  translateTeasers(ids: string[]): Promise<void>;
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
