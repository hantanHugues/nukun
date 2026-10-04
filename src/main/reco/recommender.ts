import type { Article, DomainId, FeedItem, Interaction, InterestProfileView } from "@shared/types";
import { FIELDS, fieldLabel, languageLabel } from "@shared/types";
import { LEGACY_DOMAINS } from "../sources/classify";
import { JsonDoc } from "../store";
import { cosine, DIM } from "./semantic";
import type { AiInterest } from "../ai/assist";
import { t } from "@shared/i18n";

/**
 * Content-based recommender with implicit feedback, in the spirit of a social feed:
 *  - every article is a TF-IDF vector of its title and abstract;
 *  - the reader is a vector of term weights learnt from what they open, read to
 *    the end, like, save, post about or dismiss (older signals fade, half-life 30 days);
 *  - the score mixes similarity, domain affinity, freshness and an exploration
 *    bonus, then the list is diversified so one topic cannot take over the feed.
 */

interface DomainStat {
  w: number;
  imp: number;
  pos: number;
}

interface Profile {
  terms: Record<string, number>;
  domains: Record<DomainId, DomainStat>;
  aiInterests: AiInterest[];
  /** Keywords of the interests chosen at first launch: the starting point of the feed. */
  seeds?: string[];
  /** Meaning of what the reader likes (sum of article vectors, fading like terms). */
  semantic?: number[];
  /** Meaning of the chosen interests: the starting point, before any reading. */
  semanticSeed?: number[];
  signals: number;
  signalsSinceAnalysis: number;
  lastDecay: string;
}


const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could
did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is
it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so
some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what
when where which while who whom why will with would you your yours yourself yourselves using use used based study studies results result
show shows shown paper propose proposed approach method methods new two one three however across within among via may might well
findings found data analysis effect effects model models significant significantly associated association role between high low higher
lower present here our first second large small different including including whether research article review et al further`.split(/\s+/),
);

const WEIGHTS: Record<string, number> = {
  open: 1,
  like: 4,
  unlike: -4,
  save: 2,
  unsave: -2,
  dismiss: -4,
  finish: 4,
  posted: 5,
};

function stem(w: string) {
  if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("es") && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    // Letters of any alphabet (articles come in several languages).
    .replace(/[^\p{L}\p{N}\- ]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(stem);
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Which interest an article belongs to, and how much room each interest gets. */
export interface Balance {
  of: (a: Article) => string | undefined;
  weights: Map<string, number>;
}

export class Recommender {
  private doc = new JsonDoc<Profile>("profile.json", Recommender.emptyProfile());
  private tfCache = new Map<string, Map<string, number>>();
  private idf = new Map<string, number>();
  private corpusSize = 0;

  /** A blank profile: the feed starts neutral and learns from what is read. */
  static emptyProfile(): Profile {
    return { terms: {}, domains: {}, aiInterests: [], signals: 0, signalsSinceAnalysis: 0, lastDecay: new Date().toISOString() };
  }

  constructor() {
    // Profiles from before the 26 disciplines used other domain keys ("psy"…).
    const d = this.doc.data.domains;
    for (const k of Object.keys(d)) {
      const field = LEGACY_DOMAINS[k];
      if (!field) continue;
      const cur = (d[field] ??= { w: 0, imp: 0, pos: 0 });
      cur.w += d[k].w;
      cur.imp += d[k].imp;
      cur.pos += d[k].pos;
      delete d[k];
    }
  }

  get profile() {
    return this.doc.data;
  }

  reset() {
    this.doc.data = Recommender.emptyProfile();
    this.doc.flush();
  }

  private tf(a: Article) {
    // The French title and summary act as a shared language between articles
    // written in different languages.
    const key = `${a.id}|${a.titleFr ? 1 : 0}`;
    let m = this.tfCache.get(key);
    if (!m) {
      m = new Map();
      const toks = [
        ...tokenize(a.title),
        ...tokenize(a.title),
        ...tokenize(a.abstract),
        ...a.categories.flatMap(tokenize),
        ...tokenize(a.titleFr ?? ""),
        ...tokenize(a.teaserFr ?? ""),
      ];
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
      this.tfCache.set(key, m);
    }
    return m;
  }

  /** Recompute document frequencies over the whole corpus. */
  index(articles: Article[]) {
    const df = new Map<string, number>();
    for (const a of articles) for (const t of this.tf(a).keys()) df.set(t, (df.get(t) ?? 0) + 1);
    this.corpusSize = articles.length;
    this.idf.clear();
    for (const [t, n] of df) this.idf.set(t, Math.log((1 + articles.length) / (1 + n)) + 1);
  }

  private vector(a: Article): Map<string, number> {
    const tf = this.tf(a);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, n] of tf) {
      const w = (1 + Math.log(n)) * (this.idf.get(t) ?? Math.log(1 + this.corpusSize) + 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  }

  private decay() {
    const p = this.profile;
    const days = (Date.now() - Date.parse(p.lastDecay)) / 86400000;
    if (days < 0.5) return;
    const f = Math.pow(0.5, days / 30);
    for (const k of Object.keys(p.terms)) {
      p.terms[k] *= f;
      if (Math.abs(p.terms[k]) < 0.01) delete p.terms[k];
    }
    for (const d of Object.values(p.domains)) d.w *= f;
    if (p.semantic) p.semantic = p.semantic.map((x) => x * f);
    p.lastDecay = new Date().toISOString();
  }

  /** Learn from one interaction. Returns true when an AI re-analysis of tastes is due. */
  learn(a: Article, i: Interaction, meaning?: Float32Array): boolean {
    const p = this.profile;
    const d = (p.domains[a.domain] ??= { w: 0, imp: 0, pos: 0 });
    if (i.type === "impression") {
      d.imp += 1;
      this.doc.save();
      return false;
    }
    let w = WEIGHTS[i.type] ?? 0;
    if (i.type === "dwell") w = Math.min((i.value ?? 0) / 120, 3);
    if (i.type === "progress") w = (i.value ?? 0) >= 0.5 ? 1 : 0;
    if (!w) return false;
    this.decay();
    const vec = [...this.vector(a).entries()].sort((x, y) => y[1] - x[1]).slice(0, 40);
    for (const [t, v] of vec) p.terms[t] = (p.terms[t] ?? 0) + w * v;
    if (meaning) {
      const s = (p.semantic ??= new Array(DIM).fill(0));
      for (let k = 0; k < DIM; k++) s[k] += w * meaning[k];
    }
    d.w = Math.max(-3, Math.min(10, d.w + w * 0.3));
    if (w > 0) d.pos += 1;
    p.signals += 1;
    p.signalsSinceAnalysis += Math.abs(w) >= 2 ? 1 : 0;
    this.doc.save();
    return p.signalsSinceAnalysis >= 6;
  }

  setAiInterests(list: AiInterest[]) {
    const p = this.profile;
    // Remove the previous AI boost, then apply the new one.
    for (const it of p.aiInterests) for (const k of it.keywords) for (const t of tokenize(k)) p.terms[t] = (p.terms[t] ?? 0) - 0.8;
    p.aiInterests = list;
    for (const it of list) for (const k of it.keywords) for (const t of tokenize(k)) p.terms[t] = (p.terms[t] ?? 0) + 0.8;
    p.signalsSinceAnalysis = 0;
    this.doc.save();
  }

  /**
   * Start from the interests the reader chose: their keywords weigh in the profile and
   * their disciplines get a small head start. Reading then takes over (both fade).
   */
  seedInterests(keywords: string[], fields: DomainId[]) {
    const p = this.profile;
    for (const k of p.seeds ?? []) for (const t of tokenize(k)) p.terms[t] = (p.terms[t] ?? 0) - 1;
    p.seeds = keywords;
    for (const k of keywords) for (const t of tokenize(k)) p.terms[t] = (p.terms[t] ?? 0) + 1;
    for (const f of fields) {
      const d = (p.domains[f] ??= { w: 0, imp: 0, pos: 0 });
      d.w = Math.max(d.w, 1);
    }
    this.doc.save();
  }

  /** The meaning of the chosen interests (one vector per interest), as a starting point. */
  seedSemantic(vectors: Float32Array[]) {
    const sum = new Array(DIM).fill(0);
    for (const v of vectors) for (let k = 0; k < DIM; k++) sum[k] += v[k];
    const norm = Math.hypot(...sum) || 1;
    this.profile.semanticSeed = sum.map((x) => x / norm);
    this.doc.save();
  }

  /**
   * Profiles from before recommendations by meaning: rebuild what the reader likes
   * from their reading history (same weights as live signals, older ones fading).
   */
  replayMeaning(history: { a: Article; meaning: Float32Array }[]) {
    const p = this.profile;
    if (p.semantic) return;
    const s = new Array(DIM).fill(0);
    let any = false;
    for (const { a, meaning } of history) {
      const st = a.state;
      let w = 0;
      if (st.opened) w += WEIGHTS.open;
      if (st.liked) w += WEIGHTS.like;
      if (st.saved) w += WEIGHTS.save;
      if (st.finished) w += WEIGHTS.finish;
      if (st.posted) w += WEIGHTS.posted;
      if (st.dismissed) w += WEIGHTS.dismiss;
      w += Math.min(st.dwellSec / 120, 3);
      if (!w) continue;
      const days = (Date.now() - Date.parse(st.lastOpened ?? a.fetchedAt)) / 86400000;
      w *= Math.pow(0.5, Math.max(0, days) / 30);
      for (let k = 0; k < DIM; k++) s[k] += w * meaning[k];
      any = true;
    }
    if (any) {
      p.semantic = s;
      this.doc.save();
    }
  }

  get hasSemanticSeed() {
    return !!this.profile.semanticSeed;
  }

  /**
   * What the reader likes, by meaning: the interests at first, then more and more
   * what they read (the seed weighs as much as about three strong signals).
   */
  private semanticProfile(): number[] | undefined {
    const p = this.profile;
    if (!p.semanticSeed && !p.semantic) return undefined;
    const v = new Array(DIM).fill(0);
    if (p.semanticSeed) for (let k = 0; k < DIM; k++) v[k] += 3 * p.semanticSeed[k];
    if (p.semantic) for (let k = 0; k < DIM; k++) v[k] += p.semantic[k];
    const norm = Math.hypot(...v);
    return norm ? v.map((x) => x / norm) : undefined;
  }

  /** Disciplines outside the chosen interests that the reader keeps reading. */
  adopted(outside: Set<DomainId>): DomainId[] {
    return Object.entries(this.profile.domains)
      .filter(([id, d]) => outside.has(id) && d.pos >= 3 && d.w > 1)
      .sort((a, b) => b[1].w - a[1].w)
      .map(([id]) => id);
  }

  /**
   * `explore`: disciplines next to the reader's interests. Their articles only come
   * as discoveries (one slot in seven), until the reader shows they like them.
   */
  rank(
    candidates: Article[],
    limit: number,
    enabledDomains: Record<DomainId, boolean>,
    explore: Set<DomainId> = new Set(),
    balance?: Balance,
    meaningOf?: (a: Article) => Float32Array | undefined,
  ): FeedItem[] {
    const p = this.profile;
    const now = Date.now();
    const totalImp = Object.values(p.domains).reduce((s, d) => s + d.imp, 0) + 1;
    const domW = Object.values(p.domains).map((d) => d.w);
    const maxDomW = Math.max(1, ...domW);

    const scored = candidates
      .filter((a) => enabledDomains[a.domain] !== false)
      .map((a) => {
        const vec = this.vector(a);
        let sim = 0;
        const contrib: [string, number][] = [];
        for (const [t, v] of vec) {
          const pw = p.terms[t];
          if (pw) {
            sim += pw * v;
            if (pw > 0) contrib.push([t, pw * v]);
          }
        }
        const ds = p.domains[a.domain] ?? { w: 0, imp: 0, pos: 0 };
        const ageDays = Math.max(0, (now - Date.parse(a.published || a.fetchedAt)) / 86400000);
        const fresh = Math.exp(-ageDays / 7);
        const explore = Math.sqrt(Math.log(totalImp + 1) / (ds.imp + 1)) * 0.15;
        const seenPenalty = Math.min(a.state.impressions, 6) * 0.04;
        return { a, vec, sim, contrib, ds, fresh, explore, seenPenalty };
      });

    const maxSim = Math.max(1e-6, ...scored.map((s) => s.sim));
    // Closeness by meaning, any language. Raw cosines sit in a narrow band (0.7–0.9
    // with this model): they are spread out between the median and the best one.
    const profileMeaning = meaningOf ? this.semanticProfile() : undefined;
    const sem = new Map<string, number>();
    if (profileMeaning) {
      for (const s of scored) {
        const v = meaningOf!(s.a);
        if (v) sem.set(s.a.id, cosine(profileMeaning, v));
      }
    }
    // Two texts in different languages score lower than two in the same language,
    // even on the same subject: each language is compared to its own median.
    const median = (xs: number[]) => {
      const o = [...xs].sort((x, y) => x - y);
      return o[Math.floor(o.length / 2)] ?? 0;
    };
    const byLang = new Map<string, number[]>();
    for (const s of scored) {
      const c = sem.get(s.a.id);
      if (c === undefined) continue;
      const l = s.a.lang ?? "en";
      if (!byLang.has(l)) byLang.set(l, []);
      byLang.get(l)!.push(c);
    }
    const all = [...sem.values()];
    const globalMedian = median(all);
    const foreign = [...byLang].filter(([l]) => l !== "en").flatMap(([, v]) => v);
    const shift = (l: string) => {
      if (l === "en") return 0;
      // Few articles in that language: use all non-English ones together.
      const own = byLang.get(l) ?? [];
      return globalMedian - median(own.length >= 8 ? own : foreign);
    };
    for (const s of scored) {
      const c = sem.get(s.a.id);
      if (c !== undefined) sem.set(s.a.id, c + shift(s.a.lang ?? "en"));
    }
    const sorted = [...sem.values()].sort((x, y) => x - y);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const top = sorted[sorted.length - 1] ?? 1;
    const semN = (id: string) => {
      const c = sem.get(id);
      return c === undefined ? undefined : Math.max(-1, Math.min(1, (c - mid) / Math.max(1e-6, top - mid)));
    };
    const items = scored.map((s) => {
      const words = Math.max(-1, s.sim / maxSim);
      const meaning = semN(s.a.id);
      // Words and meaning count equally; meaning alone when the words cannot be
      // compared (an article in another language than what was read).
      const comparable = (s.a.lang ?? "en") === "en" || !!s.a.titleFr;
      const simN = meaning === undefined ? words : comparable ? 0.5 * words + 0.5 * meaning : meaning;
      const dom = Math.max(-1, s.ds.w / maxDomW);
      const score = 0.55 * simN + 0.15 * dom + 0.2 * s.fresh + s.explore - s.seenPenalty;
      return { ...s, score, meaning };
    });
    items.sort((x, y) => y.score - x.score);
    // Discoveries wait for their slot, unless the reader already likes that discipline.
    const isDiscovery = (x: (typeof items)[number]) => explore.has(x.a.domain) && x.ds.pos < 3;
    const discoveries = items.filter(isDiscovery);
    const main = items.filter((x) => !isDiscovery(x));

    // Diversify (maximal marginal relevance) over the best candidates.
    const pool = main.slice(0, Math.max(limit * 4, 80));
    const chosen: typeof pool = [];
    const cos = (x: Map<string, number>, y: Map<string, number>) => {
      let s = 0;
      for (const [t, v] of x) {
        const w = y.get(t);
        if (w) s += v * w;
      }
      return s;
    };
    // Each interest gets its share of the feed (more for those read more), so an
    // interest with many articles cannot hide the others.
    const shown = new Map<string, number>();
    const totalW = balance ? [...balance.weights.values()].reduce((s, w) => s + w, 0) || 1 : 1;
    // Interest of each article, looked up once.
    const groupOf = new Map(pool.map((c) => [c.a.id, balance?.of(c.a)]));
    const overshare = (a: Article) => {
      const g = groupOf.get(a.id);
      if (!balance || !g) return 0;
      const target = (balance.weights.get(g) ?? 1) / totalW;
      return Math.max(0, ((shown.get(g) ?? 0) + 1) / (chosen.length + 1) - target);
    };
    // Similarity of each candidate to the last 8 chosen articles, computed once per
    // pair as articles are chosen (instead of again at every step).
    const recent = new Map<string, number[]>(pool.map((c) => [c.a.id, []]));
    while (chosen.length < limit && pool.length) {
      let bestI = 0;
      let best = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        const sims = recent.get(c.a.id)!;
        const redundancy = sims.length ? Math.max(...sims) : 0;
        const last2 = chosen.slice(-2);
        const sameSourceRun = last2.length === 2 && last2.every((x) => x.a.source === c.a.source) ? 0.15 : 0;
        const sameDomainRun = last2.length === 2 && last2.every((x) => x.a.domain === c.a.domain) ? 0.12 : 0;
        const mmr = 0.75 * c.score - 0.25 * redundancy - sameSourceRun - sameDomainRun - overshare(c.a);
        if (mmr > best) {
          best = mmr;
          bestI = i;
        }
      }
      const pick = pool.splice(bestI, 1)[0];
      const g = groupOf.get(pick.a.id);
      if (g) shown.set(g, (shown.get(g) ?? 0) + 1);
      chosen.push(pick);
      const pickMeaning = meaningOf?.(pick.a);
      for (const c of pool) {
        const sims = recent.get(c.a.id)!;
        const m = pickMeaning && meaningOf!(c.a);
        // Meaning vectors sit close together: rescaled so "same subject" ≈ 1.
        sims.push(pickMeaning && m ? Math.max(0, (cosine(pickMeaning, m) - 0.75) * 4) : cos(pick.vec, c.vec));
        if (sims.length > 8) sims.shift();
      }
    }

    // One slot in seven goes to discovery: a fresh article from a domain read less often.
    const rest = main.filter((x) => !chosen.includes(x));
    const leastSeen = [...FIELDS]
      .filter((d) => enabledDomains[d.id] !== false)
      .sort((x, y) => (p.domains[x.id]?.pos ?? 0) - (p.domains[y.id]?.pos ?? 0))
      .map((d) => d.id);
    // Articles in other languages rarely share words with what the reader has read so
    // far (learnt mostly in English): one slot in seven goes to the best of them,
    // each enabled language in turn.
    const otherLangs = [...new Set(rest.map((x) => x.a.lang ?? "en").filter((l) => l !== "en"))].sort();
    const result: FeedItem[] = [];
    let di = 0;
    let li = 0;
    for (let i = 0; i < chosen.length; i++) {
      if (i % 7 === 3 && otherLangs.length) {
        for (let tries = 0; tries < otherLangs.length; tries++) {
          const lang = otherLangs[li++ % otherLangs.length];
          // Only an article close to what the reader likes, when its meaning is known.
          const pickIdx = rest.findIndex((x) => x.a.lang === lang && (x.meaning === undefined || x.meaning > 0.2));
          if (pickIdx < 0) continue;
          const pick = rest.splice(pickIdx, 1)[0];
          const langue = languageLabel(lang).toLowerCase();
          const why =
            pick.meaning !== undefined
              ? t("Article en {langue}, proche par le sens de ce que tu aimes", { langue })
              : t("Article en {langue}", { langue });
          result.push({ article: pick.a, score: pick.score, reasons: [why] });
          break;
        }
      }
      if (i > 0 && i % 7 === 0 && discoveries.length) {
        // Nearby disciplines first: the feed widens step by step, like a social feed.
        const pick = discoveries.shift()!;
        result.push({ article: pick.a, score: pick.score, reasons: [t("Découverte : proche de ce que tu aimes")], discovery: true });
      } else if (i > 0 && i % 7 === 0) {
        const dom = leastSeen[di++ % Math.max(1, leastSeen.length)];
        const pickIdx = rest.findIndex((x) => x.a.domain === dom && x.fresh > 0.3);
        if (pickIdx >= 0) {
          const pick = rest.splice(pickIdx, 1)[0];
          result.push({ article: pick.a, score: pick.score, reasons: [t("Découverte : un domaine que tu explores moins")], discovery: true });
        }
      }
      const c = chosen[i];
      result.push({ article: c.a, score: c.score, reasons: this.reasons(c) });
    }
    return result.slice(0, limit);
  }

  private reasons(c: { a: Article; contrib: [string, number][]; ds: DomainStat; fresh: number; meaning?: number }): string[] {
    const r: string[] = [];
    // Close in meaning without shared words (often another language): say so.
    if ((c.meaning ?? 0) > 0.5 && c.contrib.length < 2) {
      r.push(this.profile.signals < 5 ? t("Proche par le sens de tes centres d'intérêt") : t("Proche par le sens de tes lectures"));
    }
    const terms = c.contrib
      .sort((x, y) => y[1] - x[1])
      .map(([t]) => t)
      .filter((t, i, arr) => !arr.some((o, j) => j < i && (o.includes(t) || t.includes(o))))
      .slice(0, 3);
    // Before any reading, the profile only holds the interests chosen at first launch.
    const mots = terms.join(", ");
    if (terms.length && c.contrib.length)
      r.push(this.profile.signals < 5 ? t("Lié à tes centres d'intérêt : {mots}", { mots }) : t("Proche de tes lectures : {mots}", { mots }));
    if (c.ds.pos >= 3) r.push(t("Tu lis souvent en {domaine}", { domaine: fieldLabel(c.a.domain) }));
    if (c.fresh > 0.8) r.push(t("Publié il y a moins de 2 jours"));
    return r;
  }

  view(): Omit<InterestProfileView, "interests" | "explore" | "semantic"> {
    const p = this.profile;
    return {
      topTerms: Object.entries(p.terms)
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([term, weight]) => ({ term, weight })),
      domains: FIELDS.map((d) => ({ id: d.id, weight: p.domains[d.id]?.w ?? 0, impressions: p.domains[d.id]?.imp ?? 0 })),
      aiInterests: p.aiInterests,
      signals: p.signals,
    };
  }
}
