import type { Article, DomainId, FeedItem, Interaction, InterestProfileView } from "@shared/types";
import { DOMAINS } from "@shared/types";
import { JsonDoc } from "../store";
import type { AiInterest } from "../ai/assist";

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
  signals: number;
  signalsSinceAnalysis: number;
  lastDecay: string;
}

const SEEDS: Record<DomainId, string[]> = {
  psy: [
    "emotion", "emotional", "emotion regulation", "affect", "affective", "mood", "instability", "affective instability",
    "impulsivity", "anxiety", "stress", "amygdala", "personality", "rumination", "self-regulation", "wellbeing",
  ],
  info: ["machine learning", "language model", "neural network", "artificial intelligence", "algorithm", "iot", "security"],
  robot: ["robot", "robotic", "embedded", "control", "sensor", "autonomous", "manipulation"],
  phys: ["quantum", "exoplanet", "galaxy", "black hole", "telescope", "nasa", "space"],
  bio: ["brain", "neuron", "gene", "cell", "protein", "neuroscience"],
  autre: [],
};

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
    .replace(/[^a-z0-9\- ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(stem);
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

export class Recommender {
  private doc = new JsonDoc<Profile>("profile.json", Recommender.emptyProfile());
  private tfCache = new Map<string, Map<string, number>>();
  private idf = new Map<string, number>();
  private corpusSize = 0;

  static emptyProfile(): Profile {
    const domains = Object.fromEntries(DOMAINS.map((d) => [d.id, { w: 0, imp: 0, pos: 0 }])) as Record<DomainId, DomainStat>;
    const terms: Record<string, number> = {};
    for (const [, words] of Object.entries(SEEDS)) for (const w of words) for (const t of tokenize(w)) terms[t] = (terms[t] ?? 0) + 0.5;
    // Psychology was named as a favourite: give it a head start.
    for (const t of SEEDS.psy.flatMap(tokenize)) terms[t] = (terms[t] ?? 0) + 0.5;
    domains.psy.w = 0.5;
    return { terms, domains, aiInterests: [], signals: 0, signalsSinceAnalysis: 0, lastDecay: new Date().toISOString() };
  }

  get profile() {
    return this.doc.data;
  }

  reset() {
    this.doc.data = Recommender.emptyProfile();
    this.doc.flush();
  }

  private tf(a: Article) {
    let m = this.tfCache.get(a.id);
    if (!m) {
      m = new Map();
      const toks = [...tokenize(a.title), ...tokenize(a.title), ...tokenize(a.abstract), ...a.categories.flatMap(tokenize)];
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
      this.tfCache.set(a.id, m);
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
    p.lastDecay = new Date().toISOString();
  }

  /** Learn from one interaction. Returns true when an AI re-analysis of tastes is due. */
  learn(a: Article, i: Interaction): boolean {
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

  rank(candidates: Article[], limit: number, enabledDomains: Record<DomainId, boolean>): FeedItem[] {
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
    const items = scored.map((s) => {
      const simN = Math.max(-1, s.sim / maxSim);
      const dom = Math.max(-1, s.ds.w / maxDomW);
      const score = 0.55 * simN + 0.15 * dom + 0.2 * s.fresh + s.explore - s.seenPenalty;
      return { ...s, score };
    });
    items.sort((x, y) => y.score - x.score);

    // Diversify (maximal marginal relevance) over the best candidates.
    const pool = items.slice(0, Math.max(limit * 4, 80));
    const chosen: typeof pool = [];
    const cos = (x: Map<string, number>, y: Map<string, number>) => {
      let s = 0;
      for (const [t, v] of x) {
        const w = y.get(t);
        if (w) s += v * w;
      }
      return s;
    };
    while (chosen.length < limit && pool.length) {
      let bestI = 0;
      let best = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        const redundancy = chosen.length ? Math.max(...chosen.slice(-8).map((x) => cos(x.vec, c.vec))) : 0;
        const last2 = chosen.slice(-2);
        const sameSourceRun = last2.length === 2 && last2.every((x) => x.a.source === c.a.source) ? 0.15 : 0;
        const sameDomainRun = last2.length === 2 && last2.every((x) => x.a.domain === c.a.domain) ? 0.12 : 0;
        const mmr = 0.75 * c.score - 0.25 * redundancy - sameSourceRun - sameDomainRun;
        if (mmr > best) {
          best = mmr;
          bestI = i;
        }
      }
      chosen.push(pool.splice(bestI, 1)[0]);
    }

    // One slot in seven goes to discovery: a fresh article from a domain read less often.
    const rest = items.filter((x) => !chosen.includes(x));
    const leastSeen = [...DOMAINS]
      .filter((d) => enabledDomains[d.id] !== false)
      .sort((x, y) => (p.domains[x.id]?.pos ?? 0) - (p.domains[y.id]?.pos ?? 0))
      .map((d) => d.id);
    const result: FeedItem[] = [];
    let di = 0;
    for (let i = 0; i < chosen.length; i++) {
      if (i > 0 && i % 7 === 0) {
        const dom = leastSeen[di++ % Math.max(1, leastSeen.length)];
        const pickIdx = rest.findIndex((x) => x.a.domain === dom && x.fresh > 0.3);
        if (pickIdx >= 0) {
          const pick = rest.splice(pickIdx, 1)[0];
          result.push({ article: pick.a, score: pick.score, reasons: ["Découverte : un domaine que tu explores moins"], discovery: true });
        }
      }
      const c = chosen[i];
      result.push({ article: c.a, score: c.score, reasons: this.reasons(c) });
    }
    return result.slice(0, limit);
  }

  private reasons(c: { a: Article; contrib: [string, number][]; ds: DomainStat; fresh: number }): string[] {
    const r: string[] = [];
    const terms = c.contrib
      .sort((x, y) => y[1] - x[1])
      .map(([t]) => t)
      .filter((t, i, arr) => !arr.some((o, j) => j < i && (o.includes(t) || t.includes(o))))
      .slice(0, 3);
    if (terms.length && c.contrib.length) r.push(`Proche de tes lectures : ${terms.join(", ")}`);
    if (c.ds.pos >= 3) r.push(`Tu lis souvent en ${DOMAINS.find((d) => d.id === c.a.domain)?.short ?? c.a.domain}`);
    if (c.fresh > 0.8) r.push("Publié il y a moins de 2 jours");
    return r;
  }

  view(): InterestProfileView {
    const p = this.profile;
    return {
      topTerms: Object.entries(p.terms)
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([term, weight]) => ({ term, weight })),
      domains: DOMAINS.map((d) => ({ id: d.id, weight: p.domains[d.id]?.w ?? 0, impressions: p.domains[d.id]?.imp ?? 0 })),
      aiInterests: p.aiInterests,
      signals: p.signals,
    };
  }
}
