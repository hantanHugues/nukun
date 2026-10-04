import fs from "node:fs";
import path from "node:path";
import type {
  Article,
  ArticleContent,
  ArticleState,
  DomainId,
  Draft,
  FeedItem,
  Interaction,
  RefreshProgress,
  SourceId,
  SourceStatus,
  TranslationProgress,
} from "@shared/types";
import { SOURCES } from "@shared/types";
import { analyzeInterests, explainPassage, makeTeasers } from "./ai/assist";
import { describeError } from "./ai/llm";
import { translateContent } from "./ai/translate";
import { loadFullText, PendingError } from "./content/loader";
import { Recommender } from "./reco/recommender";
import { getSettings, semanticScholarKey } from "./settings";
import { epmcFindByDoi, FETCHERS, type RawArticle } from "./sources";
import { JsonDoc, readJson, removeFile, safeName, writeJson } from "./store";

type Emit = {
  refresh: (p: RefreshProgress) => void;
  translation: (p: TranslationProgress) => void;
  feedUpdated: () => void;
};

const emptyState = (): ArticleState => ({ impressions: 0, opened: 0, dwellSec: 0, progress: 0 });
const contentFile = (id: string) => `content/${safeName(id)}.json`;

export class Library {
  private db = new JsonDoc<Record<string, Article>>("articles.json", {});
  private status = new JsonDoc<Partial<Record<SourceId, SourceStatus>>>("sources.json", {});
  private drafts = new JsonDoc<Record<string, Draft>>("drafts.json", {});
  private meta = new JsonDoc<{ lastRefresh?: string }>("meta.json", {});
  readonly reco = new Recommender();
  private refreshing: Promise<void> | null = null;
  private translating = new Map<string, Promise<void>>();
  /** Passages waiting to be translated because they are on screen, per article. */
  private visibleQueue = new Map<string, Set<string>>();
  private visibleJobs = new Map<string, Promise<void>>();
  private teaserQueue = new Set<string>();
  private teaserRunning = false;
  private analyzing = false;

  constructor(private emit: Emit) {
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
    this.db.flush();
    this.status.flush();
    this.drafts.flush();
    this.meta.flush();
  }

  // ------------------------------------------------------------ feed
  feed(domain: DomainId | "all" = "all", limit = 60): FeedItem[] {
    const s = getSettings();
    const candidates = this.all().filter(
      (a) => a.availability === "ok" && !a.state.dismissed && !a.state.opened && (domain === "all" || a.domain === domain),
    );
    return this.reco.rank(candidates, limit, domain === "all" ? s.domains : ({ [domain]: true } as Record<DomainId, boolean>));
  }

  libraryList() {
    return this.all()
      .filter((a) => a.state.opened || a.state.saved || a.state.liked || a.state.posted)
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
    const enabled = SOURCES.filter((src) => s.sources[src.id]);
    let done = 0;
    let added = 0;
    const progress = (step: string) =>
      this.emit.refresh({ running: true, step, done, total: enabled.length + 3, newArticles: added });
    progress("Interrogation des sources scientifiques");

    const run = async (id: SourceId) => {
      const st: SourceStatus = { source: id, lastRun: new Date().toISOString() };
      try {
        const raws = await FETCHERS[id]({ s2Key: semanticScholarKey() });
        st.lastCount = raws.length;
        added += this.merge(raws);
      } catch (e) {
        st.error = describeError(e);
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

    progress("Recherche des textes intégraux en attente");
    await this.resolvePending();
    done++;

    this.prune();
    this.reco.index(this.all());
    this.meta.data.lastRefresh = new Date().toISOString();
    this.meta.save();
    this.db.save();
    this.emit.feedUpdated();

    progress("Préparation des articles en tête du fil");
    await this.prefetchTop(12);
    done++;
    this.emit.feedUpdated();

    progress("Traduction des titres");
    const top = this.feed("all", 30).map((f) => f.article.id);
    await this.queueTeasers(top);
    done++;
    this.emit.refresh({ running: false, step: "Fil à jour", done, total: done, newArticles: added });
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
        continue;
      }
      this.db.data[r.id] = { ...r, fetchedAt: now, state: emptyState() };
      added++;
    }
    this.db.save();
    return added;
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
        } else {
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
    for (const a of this.all()) {
      const touched = a.state.opened || a.state.saved || a.state.liked || a.state.posted || this.drafts.data[a.id];
      if (!touched && Date.parse(a.fetchedAt) < cutoff) {
        delete this.db.data[a.id];
        removeFile(contentFile(a.id));
      }
    }
  }

  private async prefetchTop(n: number) {
    const ids = this.feed("all", n).map((f) => f.article.id);
    const queue = [...ids];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const id = queue.shift()!;
          try {
            await this.loadContent(id);
          } catch {
            /* marked pending inside loadContent */
          }
        }
      }),
    );
  }

  // ------------------------------------------------------------ content
  async loadContent(id: string): Promise<ArticleContent> {
    const cached = readJson<ArticleContent | null>(contentFile(id), null);
    if (cached) return cached;
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

  explain(id: string, text: string) {
    return explainPassage(this.get(id), text);
  }

  async queueTeasers(ids: string[]) {
    for (const id of ids) {
      const a = this.get(id);
      if (a && !a.titleFr) this.teaserQueue.add(id);
    }
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
          this.reco.learn(a, { id: a.id, type: "finish" });
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
    }
    this.db.save();
    const due = this.reco.learn(a, i);
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
