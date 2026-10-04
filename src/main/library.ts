import fs from "node:fs";
import path from "node:path";
import type {
  Article,
  ArticleContent,
  ArticleState,
  DomainId,
  ArticleKind,
  ChatMessage,
  Draft,
  Explanation,
  Note,
  FeedItem,
  Interaction,
  InterestProfileView,
  RefreshProgress,
  SourceId,
  SourceStatus,
  TranslationProgress,
} from "@shared/types";
import type { Interest } from "@shared/types";
import { FIELDS, fieldGroup, SOURCES, UNCLASSIFIED } from "@shared/types";
import {
  fieldsOf,
  INTEREST_CATALOG,
  matchesInterest,
  neighbourFields,
  newsCoverage,
  NEWS_SOURCE_TAGS,
  newsTagsOf,
} from "@shared/interests";
import {
  analyzeInterests,
  chatAboutArticle,
  explainFigure,
  explainPassage,
  makeTeasers,
  translateTopicNames,
} from "./ai/assist";
import { BLOCKED_MESSAGE, get } from "./http";
import { claudeCodeAvailable } from "./ai/claudeCode";
import { describeError, geminiAvailableToday } from "./ai/llm";
import { glossarySize, recallExplanation, rememberExplanation, rememberGlossary } from "./ai/memory";
import { translateContent } from "./ai/translate";
import { loadFullText, PendingError } from "./content/loader";
import { Recommender } from "./reco/recommender";
import { embedQueries, modelDownloaded, modelProgress, SemanticIndex } from "./reco/semantic";
import { getSettings, saveSettings, semanticScholarKey } from "./settings";
import { epmcFindByDoi, FETCHERS, openalexClassify, searchTopics, type RawArticle } from "./sources";
import { classifyText, detectLanguage, LEGACY_DOMAINS } from "./sources/classify";
import { JsonDoc, readJson, removeFile, safeName, writeJson } from "./store";

type Emit = {
  refresh: (p: RefreshProgress) => void;
  translation: (p: TranslationProgress) => void;
  feedUpdated: () => void;
};

/** ".../html/2610.02170/2610.02170v1/x.png" → ".../html/2610.02170v1/x.png" */
const fixArxivUrl = (u: string) => u.replace(/(arxiv\.org\/html\/)([^/]+)\/(\2v\d+\/)/, "$1$3");

const emptyState = (): ArticleState => ({ impressions: 0, opened: 0, dwellSec: 0, progress: 0 });
const contentFile = (id: string) => `content/${safeName(id)}.json`;

export class Library {
  private db = new JsonDoc<Record<string, Article>>("articles.json", {});
  private status = new JsonDoc<Partial<Record<SourceId, SourceStatus>>>("sources.json", {});
  private drafts = new JsonDoc<Record<string, Draft>>("drafts.json", {});
  private notes = new JsonDoc<Record<string, Note[]>>("notes.json", {});
  /** `explore`: disciplines next to the reader's interests, picked again at each refresh. */
  private meta = new JsonDoc<{ lastRefresh?: string; explore?: DomainId[] }>("meta.json", {});
  readonly reco = new Recommender();
  /** Meaning of each article (multilingual model), for recommendations across languages. */
  readonly semantic = new SemanticIndex();
  private refreshing: Promise<void> | null = null;
  private translating = new Map<string, Promise<void>>();
  /** Passages waiting to be translated because they are on screen, per article. */
  private visibleQueue = new Map<string, Set<string>>();
  private visibleJobs = new Map<string, Promise<void>>();
  private teaserQueue = new Set<string>();
  private teaserRunning = false;
  private analyzing = false;

  constructor(private emit: Emit) {
    // Articles from before the 26 disciplines carry the old domain keys ("psy"…).
    let migrated = false;
    for (const a of this.all()) {
      const field = LEGACY_DOMAINS[a.domain];
      if (field !== undefined) {
        a.domain = field;
        migrated = true;
      }
      if (!a.langChecked) {
        a.lang = detectLanguage(`${a.title} ${a.abstract}`) ?? a.lang ?? "en";
        a.langChecked = true;
        migrated = true;
      }
    }
    // Feed items read with an empty link (fixed bug): drop them so they come back whole.
    for (const a of this.all()) {
      if (!a.url && ["nature", "nasa"].includes(a.source) && !a.state.opened && !a.state.saved) {
        delete this.db.data[a.id];
        migrated = true;
      }
    }
        // News saved before the Articles / Actus split was stored as papers.
    for (const a of this.all()) {
      if (!a.kind && ["nasa", "esa", "cnrs", "inserm", "devtools"].includes(a.source)) {
        a.kind = "news";
        a.topic = a.source === "devtools" ? "tech" : "science";
        migrated = true;
      }
    }
        // SciELO Chile blocks automated downloads: its papers could never be opened.
    for (const a of this.all()) {
      const ft = a.fullText as { url?: string };
      if (a.source === "scielo" && ft.url?.includes("scielo.cl") && !a.state.opened && !a.state.saved) {
        delete this.db.data[a.id];
        migrated = true;
      }
    }
    // arXiv figures saved with a wrong address (".../html/<id>/<id>v1/x.png").
    for (const a of this.all()) {
      const fixed = a.image && fixArxivUrl(a.image);
      if (fixed && fixed !== a.image) {
        a.image = fixed;
        migrated = true;
      }
    }
    if (migrated) this.db.save();
    this.reco.index(this.all());
  }

  all() {
    return Object.values(this.db.data);
  }

  get(id: string) {
    return this.db.data[id];
  }

  get lastRefresh() {
    return this.meta.data.lastRefresh;
  }

  flush() {
    this.notes.flush();
    this.semantic.flush();
    this.topicNames.flush();
    this.db.flush();
    this.status.flush();
    this.drafts.flush();
    this.meta.flush();
  }

  // ------------------------------------------------------------ interests
  private get explore() {
    return new Set(this.meta.data.explore ?? []);
  }

  /** Does an article belong to what the reader follows (interests or discoveries)? */
  private wanted(a: Article) {
    const s = getSettings();
    if (!s.interestsChosen) return true;
    if (s.interests.some((i) => matchesInterest(i, a))) return true;
    return a.kind !== "news" && this.explore.has(a.domain);
  }

  /** Two disciplines next to the reader's interests, different at each refresh. */
  private pickExplore(interests: Interest[]): DomainId[] {
    const mine = new Set(fieldsOf(interests));
    const near = neighbourFields(interests);
    const pool = near.length ? near : FIELDS.filter((f) => !mine.has(f.id)).map((f) => f.id);
    return pool.sort(() => Math.random() - 0.5).slice(0, 2);
  }

  /** Save the interests chosen by the reader and rebuild the feeds from them. */
  setInterests(interests: Interest[], languages: Record<string, boolean>) {
    const fields = new Set(fieldsOf(interests));
    saveSettings({
      interests,
      languages,
      interestsChosen: true,
      domains: Object.fromEntries(FIELDS.map((f) => [f.id, fields.has(f.id)])),
    });
    this.reco.seedInterests(
      interests.flatMap((i) => i.keywords),
      [...fields],
    );
    void this.seedMeaning();
    this.meta.data.explore = this.pickExplore(interests);
    this.meta.save();
    this.feedCache.clear();
    this.emit.feedUpdated();
    void this.refresh();
  }

  /** French names of research topics, translated once (shared by every search). */
  private topicNames = new JsonDoc<Record<string, string>>("topic-names.json", {});

  /** The meaning of the chosen interests, the semantic starting point of the feed. */
  async seedMeaning() {
    const s = getSettings();
    if (!s.interests.length) return;
    try {
      const vectors = await embedQueries(s.interests.map((i) => `${i.label} : ${i.keywords.join(", ")}`));
      this.reco.seedSemantic(vectors);
    } catch {
      /* model unavailable for now: tried again at next launch */
    }
  }

  /** First launch with the glossary memory: fill it from the articles already translated. */
  seedGlossaryMemory() {
    if (glossarySize()) return;
    for (const a of this.all()) {
      const c = readJson<ArticleContent | null>(contentFile(a.id), null);
      if (c?.glossary?.length) rememberGlossary(c.glossary, a.lang ?? "en");
    }
  }

  /** Meaning of the articles not analysed yet, in the background. */
  indexMeaning() {
    const s = getSettings();
    if (!s.interestsChosen) return;
    // Saving data: the model (130 MB) is not downloaded; if already there, it is used.
    if (s.dataSaver && !modelDownloaded()) return;
    // Read and dismissed articles too: they tell what the reader likes or not.
    void this.semantic.indexMissing(this.all().filter((a) => a.availability === "ok" || a.state.opened)).then(() => {
      if (!this.reco.hasSemanticSeed) void this.seedMeaning();
      const history = this.all()
        .filter((a) => a.state.opened || a.state.dismissed || a.state.liked || a.state.saved)
        .map((a) => ({ a, meaning: this.semantic.get(a.id)! }))
        .filter((x) => x.meaning);
      this.reco.replayMeaning(history);
    });
  }

  async searchTopics(q: string) {
    const hits = await searchTopics(q);
    const missing = hits.filter((h) => !this.topicNames.data[h.id]);
    if (missing.length) {
      const job = translateTopicNames(missing.map(({ id, name }) => ({ id, name })))
        .then((names) => {
          for (const [id, fr] of names) this.topicNames.data[id] = fr;
          this.topicNames.save();
        })
        .catch(() => {
          /* no AI right now: the English names stay */
        });
      // Do not keep the reader waiting: English names if the AI is slow.
      await Promise.race([job, new Promise((r) => setTimeout(r, 12000))]);
    }
    return hits.map((h) => ({ ...h, nameFr: this.topicNames.data[h.id] }));
  }

  /** A catalogue interest the reader keeps reading without having chosen it. */
  suggestion(): Interest | null {
    const s = getSettings();
    if (!s.interestsChosen) return null;
    const chosen = new Set(s.interests.map((i) => i.id));
    const mine = new Set(fieldsOf(s.interests));
    const outside = new Set(FIELDS.map((f) => f.id).filter((f) => !mine.has(f)));
    for (const field of this.reco.adopted(outside)) {
      const hit = INTEREST_CATALOG.find(
        (i) => i.fields.includes(field) && !chosen.has(i.id) && !s.dismissedSuggestions?.includes(i.id),
      );
      if (hit) {
        const { group: _group, ...interest } = hit;
        return interest;
      }
    }
    return null;
  }

  /** The recommender's view, with the reader's interests and what is explored. */
  profileView(): InterestProfileView {
    const s = getSettings();
    const weights = this.balance()?.weights;
    const total = weights ? [...weights.values()].reduce((a, b) => a + b, 0) : 1;
    const read = this.all().filter((a) => a.state.opened);
    return {
      ...this.reco.view(),
      interests: s.interests.map((i) => ({
        id: i.id,
        label: i.label,
        share: weights ? (weights.get(i.id) ?? 1) / total : 1,
        read: read.filter((a) => matchesInterest(i, a)).length,
        news: newsCoverage(i),
        custom: i.custom,
      })),
      explore: [...this.explore],
      semantic: {
        state: getSettings().dataSaver && !modelDownloaded() ? "off" : this.semantic.state,
        analysed: this.semantic.size,
        downloaded: modelProgress(),
      },
    };
  }

  dismissSuggestion(id: string) {
    const s = getSettings();
    saveSettings({ dismissedSuggestions: [...(s.dismissedSuggestions ?? []), id] });
  }

  // ------------------------------------------------------------ feed
  /** Articles that may appear in a feed: readable, not seen yet, in an enabled language, wanted. */
  private candidates(kind: ArticleKind = "paper") {
    const s = getSettings();
    return this.all().filter(
      (a) =>
        (a.kind ?? "paper") === kind &&
        a.availability === "ok" &&
        !a.state.dismissed &&
        !a.state.opened &&
        s.languages[a.lang ?? "en"] !== false &&
        this.wanted(a),
    );
  }

  /** Ranked feeds kept between pages, so scrolling down never reshuffles what is above. */
  private feedCache = new Map<ArticleKind, { filter: string; items: FeedItem[] }>();

  /**
   * `filter` is "all", "i:<interest>" for one of the reader's interests, a field id,
   * "g:<group>" for one of the 4 big domains, or "t:<topic>" for news (science, tech).
   */
  private rankFeed(filter: string, limit: number, kind: ArticleKind = "paper"): FeedItem[] {
    const s = getSettings();
    const interest = filter.startsWith("i:") ? s.interests.find((i) => i.id === filter.slice(2)) : undefined;
    const match = (a: Article) =>
      filter === "all" ||
      (interest ? matchesInterest(interest, a) : false) ||
      a.domain === filter ||
      (filter.startsWith("g:") && fieldGroup(a.domain) === filter.slice(2)) ||
      (filter.startsWith("t:") && a.topic === filter.slice(2));
    const candidates = this.candidates(kind).filter(match);
    // Candidates are already limited to the reader's interests; before they are
    // chosen (older profiles), the disciplines switched on in the settings apply.
    const enabled =
      filter === "all" && kind === "paper" && !s.interestsChosen ? s.domains : ({} as Record<DomainId, boolean>);
    if (filter !== "all") return this.reco.rank(candidates, limit, enabled, undefined, undefined, (a) => this.semantic.get(a.id));
    return this.reco.rank(candidates, limit, enabled, this.explore, this.balance(), (a) => this.semantic.get(a.id));
  }

  /** Share of the feed for each interest: equal at first, then larger for what is read. */
  private balance() {
    const s = getSettings();
    if (!s.interestsChosen || s.interests.length < 2) return undefined;
    const domains = this.reco.profile.domains;
    const weights = new Map(
      s.interests.map((i) => {
        const pos = i.fields.reduce((n, f) => n + (domains[f]?.pos ?? 0), 0);
        return [i.id, 1 + Math.min(pos, 20) / 5];
      }),
    );
    return { of: (a: Article) => s.interests.find((i) => matchesInterest(i, a))?.id, weights };
  }

  /**
   * One page of the feed. `fresh` ranks again (opening the feed, "new articles");
   * otherwise pages come from the same ranking, extended when the reader goes further.
   * `filter` is "all", a field id, or "g:<group>" for one of the 4 big domains.
   */
  feed(filter = "all", limit = 30, offset = 0, fresh = offset === 0, kind: ArticleKind = "paper"): FeedItem[] {
    let c = this.feedCache.get(kind);
    if (fresh || !c || c.filter !== filter) {
      c = { filter, items: this.rankFeed(filter, Math.max(offset + limit, 150), kind) };
      this.feedCache.set(kind, c);
    } else if (c.items.length < offset + limit && c.items.length >= 150) {
      // Deeper than the first ranking: extend it, keeping the order already shown.
      const seen = new Set(c.items.map((x) => x.article.id));
      const more = this.rankFeed(filter, offset + limit + 150, kind).filter((x) => !seen.has(x.article.id));
      c.items.push(...more);
    }
    // Raw slices: the page knows what it has hidden (dismissed cards).
    return c.items.slice(offset, offset + limit);
  }

  /** How many readable articles each interest has, for the feed filters. */
  interestCounts(kind: ArticleKind = "paper"): Record<string, number> {
    const s = getSettings();
    const counts: Record<string, number> = {};
    for (const a of this.candidates(kind))
      for (const i of s.interests) if (matchesInterest(i, a)) counts[i.id] = (counts[i.id] ?? 0) + 1;
    return counts;
  }

  libraryList() {
    return this.all()
      .filter((a) => !a.state.removed && (a.state.opened || a.state.saved || a.state.liked || a.state.posted))
      .sort((a, b) => Date.parse(b.state.lastOpened ?? b.fetchedAt) - Date.parse(a.state.lastOpened ?? a.fetchedAt));
  }

  // ------------------------------------------------------------ refresh
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh() {
    const s = getSettings();
    // News sources only when one of the reader's interests matches what they cover.
    const tags = newsTagsOf(s.interests);
    const enabled = SOURCES.filter(
      (src) => s.sources[src.id] && (!NEWS_SOURCE_TAGS[src.id] || NEWS_SOURCE_TAGS[src.id].some((t) => tags.has(t))),
    );
    // New neighbours to explore at each refresh, so discoveries keep changing.
    if (s.interestsChosen) {
      this.meta.data.explore = this.pickExplore(s.interests);
      this.meta.save();
    }
    const fields = new Set([...fieldsOf(s.interests), ...this.explore]);
    let done = 0;
    let added = 0;
    const progress = (step: string) =>
      this.emit.refresh({ running: true, step, done, total: enabled.length + 3, newArticles: added });
    progress("Interrogation des sources scientifiques");

    const run = async (id: SourceId) => {
      const st: SourceStatus = { source: id, lastRun: new Date().toISOString() };
      try {
        const raws = await FETCHERS[id]({
          s2Key: semanticScholarKey(),
          fields,
          interests: s.interests,
          topics: s.interests.flatMap((i) => i.topics ?? []),
          explore: this.explore,
          languages: new Set(Object.entries(s.languages).filter(([, on]) => on).map(([l]) => l)),
          known: new Set(Object.keys(this.db.data)),
        });
        st.lastCount = raws.length;
        const n = this.merge(raws);
        added += n;
        // The feed fills source by source instead of waiting for all of them.
        if (n) {
          this.reco.index(this.all());
          this.emit.feedUpdated();
        }
      } catch (e) {
        st.error = describeError(e);
        if (id === "hal" && /anti-robot/.test(st.error)) this.drop(this.all().filter((a) => a.source === "hal"));
      }
      this.status.data[id] = st;
      done++;
      progress(`${SOURCES.find((x) => x.id === id)?.label} : terminé`);
    };
    // A few sources at a time: polite with the APIs, and quick enough.
    const queue = enabled.map((x) => x.id);
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) await run(queue.shift()!);
      }),
    );
    this.status.save();

    progress("Classement des articles par discipline");
    await this.classifyNew();

    this.prune();
    this.reco.index(this.all());
    this.meta.data.lastRefresh = new Date().toISOString();
    this.meta.save();
    this.db.save();
    this.emit.refresh({ running: false, step: "Fil à jour", done, total: done, newArticles: added });
    this.emit.feedUpdated();

    // Not needed to read the feed: done in the background, without the spinner.
    // (Card images and titles are prepared as the reader scrolls: prepareCards.)
    void (async () => {
      this.indexMeaning();
      await this.resolvePending();
      this.emit.feedUpdated();
      // News titles, for when the reader opens the Actus tab.
      await this.queueTeasers(this.rankFeed("all", 12, "news").map((f) => f.article.id));
    })();
  }

  /** Remove articles for good, except those the reader saved, liked or wrote about. */
  private drop(articles: Article[]) {
    for (const a of articles) {
      if (a.state.saved || a.state.liked || a.state.posted || this.drafts.data[a.id] || this.notes.data[a.id]?.length) continue;
      delete this.db.data[a.id];
      removeFile(contentFile(a.id));
    }
    this.db.save();
    this.feedCache.clear();
    this.emit.feedUpdated();
  }

  private merge(raws: RawArticle[]): number {
    let added = 0;
    const now = new Date().toISOString();
    for (const r of raws) {
      if (!r.id || !r.title) continue;
      const existing = this.db.data[r.id];
      if (existing) {
        // Prefer the richer source for the same paper; never lose user state.
        if (existing.availability === "pending" && r.availability === "ok") {
          existing.fullText = r.fullText;
          existing.availability = "ok";
        }
        if (!existing.abstract && r.abstract) existing.abstract = r.abstract;
        if (!existing.image && r.image) existing.image = r.image;
        if (r.kind && !existing.kind) {
          existing.kind = r.kind;
          existing.topic = r.topic;
        }
        continue;
      }
      // Declared languages are sometimes wrong (an English paper tagged Spanish…):
      // trust the text itself when it is clear.
      const lang = detectLanguage(`${r.title} ${r.abstract}`) ?? r.lang ?? "en";
      this.db.data[r.id] = { ...r, lang, fetchedAt: now, state: emptyState() };
      added++;
    }
    this.db.save();
    return added;
  }

  /**
   * OpenAlex gives the discipline (and language) of any paper with a DOI: one
   * reliable classification for every source, instead of guessing from keywords.
   */
  private async classifyNew() {
    const todo = this.all().filter((a) => a.doi && !a.classified).slice(0, 300);
    if (!todo.length) return;
    try {
      const found = await openalexClassify(todo.map((a) => a.doi!.toLowerCase()));
      for (const a of todo) {
        a.classified = true;
        const hit = found.get(a.doi!.toLowerCase());
        if (hit?.field) a.domain = hit.field;
        if (hit?.topicId) a.topicId = hit.topicId;
        else if (a.domain === UNCLASSIFIED) a.domain = classifyText(`${a.title} ${a.abstract}`);
        if (hit?.lang && !a.lang) a.lang = hit.lang;
        // Now that its discipline is known, drop it if the reader does not follow it.
        if (!this.wanted(a) && !a.state.opened && !a.state.saved) delete this.db.data[a.id];
      }
      this.db.save();
    } catch {
      /* OpenAlex unreachable: the source's own classification stays */
    }
  }

  private async resolvePending() {
    const now = Date.now();
    const pending = this.all()
      .filter((a) => a.availability === "pending" && (!a.checkedAt || now - Date.parse(a.checkedAt) > 12 * 3600000))
      .slice(0, 40);
    for (const a of pending) {
      a.checkedAt = new Date().toISOString();
      try {
        if (a.fullText.kind === "doi-lookup") {
          const hit = await epmcFindByDoi(a.fullText.doi);
          if (hit) {
            a.fullText = { kind: "pmc", pmcid: hit.pmcid };
            a.availability = "ok";
          }
        } else if (!getSettings().dataSaver) {
          // Other kinds became pending after a failed load: try again.
          await this.loadContent(a.id);
        }
      } catch {
        /* still pending */
      }
    }
    this.db.save();
  }

  private prune() {
    const cutoff = Date.now() - 45 * 86400000;
    // News ages faster than research.
    const newsCutoff = Date.now() - 21 * 86400000;
    for (const a of this.all()) {
      const touched =
        a.state.opened || a.state.saved || a.state.liked || a.state.posted || this.drafts.data[a.id] || this.notes.data[a.id]?.length;
      const limit = a.kind === "news" ? newsCutoff : cutoff;
      if (!touched && Date.parse(a.fetchedAt) < limit) {
        delete this.db.data[a.id];
        removeFile(contentFile(a.id));
      }
    }
    this.semantic.prune(new Set(Object.keys(this.db.data)));
  }

  /** Start the algorithm again from the chosen interests (reading history is kept). */
  resetProfile() {
    const s = getSettings();
    this.reco.reset();
    this.reco.seedInterests(
      s.interests.flatMap((i) => i.keywords),
      fieldsOf(s.interests),
    );
    void this.seedMeaning();
    this.feedCache.clear();
    this.emit.feedUpdated();
  }

  /** Articles already prepared for their card (full text fetched once). */
  private prepared = new Set<string>();
  private prepareQueue: string[] = [];
  private preparing = 0;
  private lastPrepareEmit = 0;

  /**
   * Cards on screen: French title and summary, and the full text, which gives the
   * card its image and makes the article open at once. Called as the reader scrolls,
   * so only what is seen is prepared.
   */
  prepareCards(ids: string[]) {
    void this.queueTeasers(ids, true);
    // Saving data: full texts only when an article is opened.
    if (getSettings().dataSaver) return;
    const todo = ids.filter((id) => !this.prepared.has(id) && this.get(id));
    todo.forEach((id) => this.prepared.add(id));
    this.prepareQueue = [...todo, ...this.prepareQueue];
    while (this.preparing < 3 && this.prepareQueue.length) void this.prepareNext();
  }

  private async prepareNext() {
    this.preparing++;
    try {
      while (this.prepareQueue.length) {
        const id = this.prepareQueue.shift()!;
        const hadImage = !!this.get(id)?.image;
        try {
          await this.loadContent(id);
        } catch {
          /* marked pending inside loadContent */
        }
        // A new image: show it, at most every second and a half.
        if (!hadImage && this.get(id)?.image && Date.now() - this.lastPrepareEmit > 1500) {
          this.lastPrepareEmit = Date.now();
          this.emit.feedUpdated();
        }
      }
    } finally {
      this.preparing--;
      this.emit.feedUpdated();
    }
  }

  // ------------------------------------------------------------ content
  async loadContent(id: string): Promise<ArticleContent> {
    const cached = readJson<ArticleContent | null>(contentFile(id), null);
    if (cached) {
      // Parsed before the arXiv figure fix: repair the addresses once.
      if (id.startsWith("arxiv:") && cached.blocks.some((b) => b.t === "fig" && b.src.some((s) => fixArxivUrl(s) !== s))) {
        for (const b of cached.blocks) if (b.t === "fig") b.src = b.src.map(fixArxivUrl);
        writeJson(contentFile(id), cached);
      }
      return cached;
    }
    const a = this.get(id);
    if (!a) throw new Error("Article introuvable.");
    try {
      const loaded = await loadFullText(a);
      if (loaded.blocks.filter((b) => b.t === "p").length < 2) throw new PendingError("Texte intégral trop court.");
      const content: ArticleContent = { id, ...loaded, tr: {} };
      writeJson(contentFile(id), content);
      const firstFig = content.blocks.find((b) => b.t === "fig");
      if (!a.image && firstFig?.t === "fig") a.image = firstFig.src[0];
      if (!a.abstract) {
        const firstP = content.blocks.find((b) => b.t === "p");
        if (firstP?.t === "p") a.abstract = firstP.segs[0].replace(/<[^>]+>/g, "").slice(0, 1500);
      }
      a.availability = "ok";
      a.loadError = undefined;
      this.db.save();
      return content;
    } catch (e) {
      // Protected by its site (anti-robot page): not for this app, removed.
      if (e instanceof Error && e.message === BLOCKED_MESSAGE) {
        this.drop([a]);
        throw e;
      }
      a.loadError = describeError(e);
      a.checkedAt = new Date().toISOString();
      // Unreadable for now: keep it out of the feed until a later check succeeds.
      if (!a.state.opened) a.availability = "pending";
      this.db.save();
      throw e;
    }
  }

  /**
   * Browser-style translation: only what the reader is looking at (plus a screen ahead),
   * newest requests first. Everything translated is kept, so nothing is paid for twice.
   */
  translateVisible(id: string, keys: string[]) {
    if (this.translating.has(id)) return; // a full translation already covers it
    if (this.get(id)?.lang === "fr") return; // already in French
    const q = this.visibleQueue.get(id) ?? new Set<string>();
    for (const k of keys) {
      q.delete(k); // re-add so the latest request moves to the end (= served first)
      q.add(k);
    }
    this.visibleQueue.set(id, q);
    if (this.visibleJobs.has(id)) return;
    const job = (async () => {
      try {
        while (q.size) {
          const take = new Set([...q].slice(-24));
          take.forEach((k) => q.delete(k));
          const a = this.get(id);
          const c = await this.loadContent(id);
          await translateContent(
            a,
            c,
            (done, total) => {
              writeJson(contentFile(id), c);
              this.emit.translation({ id, done, total });
            },
            take,
          );
          writeJson(contentFile(id), c);
          this.emit.translation({ id, done: 1, total: 1, finished: q.size === 0 });
        }
      } catch (e) {
        q.clear();
        this.emit.translation({ id, done: 0, total: 0, error: describeError(e), finished: true });
      }
    })().finally(() => this.visibleJobs.delete(id));
    this.visibleJobs.set(id, job);
  }

  translate(id: string, force = false): Promise<void> {
    const running = this.translating.get(id);
    if (running) return running;
    const job = (async () => {
      // Let an on-screen translation finish first: both write the same file.
      this.visibleQueue.get(id)?.clear();
      await this.visibleJobs.get(id);
      const a = this.get(id);
      const c = await this.loadContent(id);
      if (force) {
        c.tr = {};
        c.trBy = {};
        c.glossary = undefined;
      }
      try {
        await translateContent(a, c, (done, total) => {
          writeJson(contentFile(id), c);
          this.emit.translation({ id, done, total });
        }, undefined, !force);
        writeJson(contentFile(id), c); // final state: repairs and the "translated by" note
        this.emit.translation({ id, done: 1, total: 1, finished: true });
      } catch (e) {
        writeJson(contentFile(id), c);
        this.emit.translation({ id, done: 0, total: 0, error: describeError(e), finished: true });
      }
    })().finally(() => this.translating.delete(id));
    this.translating.set(id, job);
    return job;
  }

  /**
   * Explains a figure from its image and caption. The answer is kept with the article
   * and in the shared memory (keyed by the image), like text explanations.
   */
  async explainFigure(id: string, blockIndex: number): Promise<Explanation> {
    const c = await this.loadContent(id);
    const b = c.blocks[blockIndex];
    if (!b || b.t !== "fig") throw new Error("Figure introuvable.");
    const src = b.src[0];
    const caption = (c.tr[blockIndex]?.[0] || b.segs[0] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const num = b.label?.replace(/^(fig(ure)?\.?\s*)/i, "") || String(c.blocks.slice(0, blockIndex + 1).filter((x) => x.t === "fig").length);
    const label = caption ? `Figure ${num} : ${caption.slice(0, 120)}${caption.length > 120 ? "…" : ""}` : `Figure ${num}`;
    const save = (e: Explanation) => {
      c.explanations = [...(c.explanations ?? []).filter((x) => x.q !== e.q), e];
      writeJson(contentFile(id), c);
      return e;
    };
    const at = new Date().toISOString();
    const known = recallExplanation(`figure:${src}`);
    if (known) return save({ q: label, a: known.a, by: `Mémoire (${known.by})`, at });

    let image: { data: Buffer; mime: string };
    if (src.startsWith("data:")) {
      const m = src.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) throw new Error("Image illisible.");
      image = { mime: m[1], data: Buffer.from(m[2], "base64") };
    } else {
      const res = await get(src, { browser: true, timeoutMs: 45000 });
      image = { mime: (res.headers.get("content-type") ?? "image/jpeg").split(";")[0], data: Buffer.from(await res.arrayBuffer()) };
    }
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(image.mime)) throw new Error(`Format d'image non pris en charge (${image.mime}).`);
    if (image.data.length > 8 * 1024 * 1024) throw new Error("Image trop lourde pour être analysée.");
    const { text, provider } = await explainFigure(this.get(id), caption, image);
    rememberExplanation(`figure:${src}`, text, provider);
    return save({ q: label, a: text, by: provider, at });
  }

  /** A question about the article, answered by the AI from the article's own text. */
  async chat(id: string, question: string): Promise<ChatMessage> {
    const c = await this.loadContent(id);
    const history = c.chat ?? [];
    const s = getSettings();
    const local = s.provider === "ollama" || (s.provider !== "claude" && !claudeCodeAvailable() && !geminiAvailableToday());
    const { text, provider } = await chatAboutArticle(this.get(id), c, history, question.trim(), local);
    const now = new Date().toISOString();
    const answer: ChatMessage = { role: "assistant", text, by: provider, at: now };
    c.chat = [...history, { role: "user", text: question.trim(), at: now }, answer];
    writeJson(contentFile(id), c);
    return answer;
  }

  async clearChat(id: string) {
    const c = await this.loadContent(id);
    c.chat = [];
    writeJson(contentFile(id), c);
  }

  /**
   * Explain a selected passage, cheapest source first: a single glossary term is
   * answered from the article's glossary, a passage explained before comes from the
   * shared memory, and only new passages go to an AI. Every answer is kept with the
   * article so it is still there next time.
   */
  async explain(id: string, text: string): Promise<Explanation> {
    const passage = text.replace(/\s+/g, " ").trim();
    const c = await this.loadContent(id);
    const save = (e: Explanation) => {
      c.explanations = [...(c.explanations ?? []).filter((x) => x.q !== e.q), e];
      writeJson(contentFile(id), c);
      return e;
    };
    const at = new Date().toISOString();

    const term = c.glossary?.find((g) => g.term.toLowerCase() === passage.toLowerCase().replace(/[.,;:]$/, ""));
    if (term) {
      const a = `${term.definition}${term.keep ? ` Les spécialistes francophones gardent le terme anglais « ${term.term} ».` : ` En français : « ${term.fr} ».`}`;
      return save({ q: passage, a, by: "Lexique de l'article", at });
    }

    const known = recallExplanation(passage);
    if (known) return save({ q: passage, a: known.a, by: `Mémoire (${known.by})`, at });

    const { text: a, provider } = await explainPassage(this.get(id), passage);
    rememberExplanation(passage, a, provider);
    return save({ q: passage, a, by: provider, at });
  }

  /** `first`: cards on screen, translated before the ones queued by a refresh. */
  async queueTeasers(ids: string[], first = false) {
    const todo = ids.filter((id) => this.get(id) && !this.get(id).titleFr);
    this.teaserQueue = first ? new Set([...todo, ...this.teaserQueue]) : new Set([...this.teaserQueue, ...todo]);
    if (this.teaserRunning) return;
    this.teaserRunning = true;
    try {
      while (this.teaserQueue.size) {
        const batch = [...this.teaserQueue].slice(0, 6); // small batches fit a local model's context
        batch.forEach((id) => this.teaserQueue.delete(id));
        const arts = batch.map((id) => this.get(id)).filter(Boolean);
        try {
          const res = await makeTeasers(arts);
          for (const a of arts) {
            const t = res.get(a.id);
            if (t) {
              a.titleFr = t.title;
              a.teaserFr = t.teaser;
            }
          }
          this.db.save();
          this.emit.feedUpdated();
        } catch {
          this.teaserQueue.clear(); // no AI available right now: cards stay in English
        }
      }
    } finally {
      this.teaserRunning = false;
    }
  }

  // ------------------------------------------------------------ interactions
  interact(i: Interaction) {
    const a = this.get(i.id);
    if (!a) return;
    const st = a.state;
    switch (i.type) {
      case "impression":
        st.impressions += 1;
        break;
      case "open":
        st.opened += 1;
        st.lastOpened = new Date().toISOString();
        break;
      case "dwell":
        st.dwellSec += i.value ?? 0;
        break;
      case "progress":
        st.progress = Math.max(st.progress, i.value ?? 0);
        if (st.progress >= 0.92 && !st.finished) {
          st.finished = true;
          this.reco.learn(a, { id: a.id, type: "finish" }, this.semantic.get(a.id));
        }
        break;
      case "like":
        st.liked = true;
        break;
      case "unlike":
        st.liked = false;
        break;
      case "save":
        st.saved = true;
        break;
      case "unsave":
        st.saved = false;
        break;
      case "dismiss":
        st.dismissed = true;
        break;
      case "posted":
        st.posted = true;
        break;
      case "remove":
        // Out of the library and the feed; its parsed text and translations go too.
        st.removed = true;
        st.dismissed = true;
        st.saved = false;
        removeFile(contentFile(a.id));
        delete this.notes.data[a.id];
        this.notes.save();
        break;
    }
    this.db.save();
    const due = this.reco.learn(a, i, this.semantic.get(a.id));
    if (due) void this.analyzeInterests();
  }

  saveScroll(id: string, ratio: number) {
    const a = this.get(id);
    if (!a) return;
    a.state.scrollPos = ratio;
    this.db.save();
  }

  async analyzeInterests() {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      const arts = this.all();
      const liked = arts
        .filter((a) => a.state.liked || a.state.finished || a.state.posted || a.state.saved || a.state.dwellSec > 180)
        .sort((a, b) => Date.parse(b.state.lastOpened ?? b.fetchedAt) - Date.parse(a.state.lastOpened ?? a.fetchedAt))
        .slice(0, 25);
      if (liked.length < 2) return;
      const disliked = arts.filter((a) => a.state.dismissed).slice(-15);
      const interests = await analyzeInterests(liked, disliked);
      this.reco.setAiInterests(interests);
      this.emit.feedUpdated();
    } catch {
      /* AI unavailable: the term-based profile keeps working on its own */
    } finally {
      this.analyzing = false;
    }
  }

  sourceStatus(): SourceStatus[] {
    return SOURCES.map((s) => this.status.data[s.id] ?? { source: s.id });
  }

  // ------------------------------------------------------------ drafts & export
  // ------------------------------------------------------------ notes
  getNotes(id: string): Note[] {
    return this.notes.data[id] ?? [];
  }

  saveNote(id: string, note: Note): Note[] {
    const list = (this.notes.data[id] ??= []);
    const i = list.findIndex((n) => n.id === note.id);
    if (i >= 0) list[i] = note;
    else list.push(note);
    this.notes.save();
    return list;
  }

  deleteNote(id: string, noteId: string): Note[] {
    const list = (this.notes.data[id] ?? []).filter((n) => n.id !== noteId);
    if (list.length) this.notes.data[id] = list;
    else delete this.notes.data[id];
    this.notes.save();
    return list;
  }

  noteCounts(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.notes.data).map(([id, l]) => [id, l.length]));
  }

  getDraft(id: string) {
    return this.drafts.data[id];
  }

  listDrafts() {
    return Object.values(this.drafts.data).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  saveDraft(d: Draft) {
    this.drafts.data[d.articleId] = { ...this.drafts.data[d.articleId], ...d, updatedAt: new Date().toISOString() };
    this.drafts.save();
  }

  exportDraft(id: string): string {
    const d = this.drafts.data[id];
    const a = this.get(id);
    if (!d || !a) throw new Error("Brouillon introuvable.");
    const dir = getSettings().exportDir;
    fs.mkdirSync(dir, { recursive: true });
    const slug =
      (d.title || a.titleFr || a.title)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || safeName(id);
    const q = (s: string) => JSON.stringify(s);
    const tags = d.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const front = [
      "---",
      `title: ${q(d.title || a.titleFr || a.title)}`,
      `publishedAt: ${q(new Date().toLocaleDateString("sv-SE"))}`,
      `summary: ${q(d.summary)}`,
      ...(a.image ? [`image: ${q(a.image)}`] : []),
      ...(tags.length ? [`tag: ${q(tags[0])}`] : []),
      `source:`,
      `  title: ${q(a.title)}`,
      `  authors: ${q(a.authors.slice(0, 6).join(", "))}`,
      `  venue: ${q(a.venue ?? "")}`,
      `  url: ${q(a.url)}`,
      ...(a.doi ? [`  doi: ${q(a.doi)}`] : []),
      "---",
      "",
    ].join("\n");
    const credit = `\n\n---\n\n*Article original : [${a.title}](${a.url}) — ${a.authors.slice(0, 3).join(", ")}${a.authors.length > 3 ? " et al." : ""}${a.venue ? `, ${a.venue}` : ""}.*\n`;
    const file = path.join(dir, `${slug}.mdx`);
    fs.writeFileSync(file, front + d.body.trim() + credit, "utf8");
    d.exportedPath = file;
    this.drafts.save();
    if (!a.state.posted) this.interact({ id, type: "posted" });
    return file;
  }
}
