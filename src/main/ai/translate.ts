import type { Article, ArticleContent, GlossaryTerm } from "@shared/types";
import { languageLabel } from "@shared/types";
import { claudeKey, geminiKey, getSettings } from "../settings";
import { claudeCodeAvailable } from "./claudeCode";
import { recall, recallGlossary, remember, rememberGlossary } from "./memory";
import { llmJson, OutputTooLongError } from "./llm";

const RULES = `Tu es un traducteur scientifique professionnel. Tu traduis vers le français des articles écrits en anglais ou dans une autre langue (indiquée avec l'article).

Règles de traduction :
1. Traduis fidèlement et intégralement, phrase par phrase. Ne résume jamais, n'ajoute rien, ne supprime rien. Le sens, les nuances, les chiffres, les unités, les noms propres et le niveau de certitude des auteurs (« suggère », « démontre », « pourrait ») doivent être conservés exactement.
2. Les termes techniques que les spécialistes francophones emploient couramment en anglais RESTENT EN ANGLAIS. Exemples : dans un article sur MQTT, « topic », « broker », « payload », « publish/subscribe » restent tels quels ; en IA : « machine learning », « deep learning », « transformer », « prompt », « fine-tuning », « embedding », « benchmark » ; en biologie : « western blot », « knockout », « RNA-seq » ; en robotique : « SLAM », « reinforcement learning ». Tout le reste (vocabulaire courant, verbes, tournures) est traduit en français naturel. Si l'article n'est pas en anglais, un terme que les francophones emploient en anglais s'écrit en anglais, pas dans la langue d'origine.
3. Respecte le glossaire fourni : un terme marqué « garder » reste en anglais ; sinon utilise la traduction indiquée, toujours la même dans tout l'article.
4. Ne traduis jamais : noms de gènes, protéines, molécules, espèces en latin, logiciels, jeux de données, modèles, sigles, équations, citations bibliographiques.
5. Les marqueurs ⟦1⟧, ⟦2⟧… représentent des formules ou des références : recopie-les exactement, à la place qui convient dans la phrase française.
6. Conserve les balises HTML <em>, <strong>, <sup>, <sub>, <br> autour des mêmes mots.
7. Le français doit être fluide et correct (accords, typographie française : espaces avant « : ; ? ! », guillemets « »), sans être une reformulation libre.`;

const GLOSSARY_SCHEMA = {
  type: "object",
  properties: {
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          keep: { type: "boolean" },
          fr: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "keep", "fr", "definition"],
        additionalProperties: false,
      },
    },
  },
  required: ["terms"],
  additionalProperties: false,
};

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, fr: { type: "string" } },
        required: ["i", "fr"],
        additionalProperties: false,
      },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function buildGlossary(a: Article, c: ArticleContent): Promise<GlossaryTerm[]> {
  const headings = c.blocks.filter((b) => b.t === "h").map((b) => plain(b.segs[0]));
  let sample = "";
  for (const b of c.blocks) {
    if (b.t !== "p") continue;
    sample += plain(b.segs[0]) + "\n";
    if (sample.length > 6000) break;
  }
  const lang = a.lang ?? "en";
  // Terms already decided in other articles: reused as they are.
  const known = recallGlossary(`${a.title}\n${headings.join("\n")}\n${sample}`, lang).slice(0, 40);
  // Well covered already: no AI call at all.
  if (known.length >= 20) return known;
  const knownList = known.length
    ? `\n\nTermes déjà connus (ne les répète pas, ils sont déjà dans le glossaire) : ${known.map((t) => t.term).join(", ")}.`
    : "";
  const { data } = await llmJson<{ terms: GlossaryTerm[] }>({
    system: `${RULES}\n\nTa tâche ici : préparer le glossaire technique d'un article avant sa traduction.`,
    user: `Article : « ${a.title} »\nLangue de l'article : ${languageLabel(a.lang)}\nDomaine :${a.categories.join(", ") || a.venue || ""}\n\nTitres des sections :\n${headings.join("\n")}\n\nExtrait :\n${sample}${knownList}\n\nListe ${known.length ? "0 à 20 autres" : "10 à 30"} termes techniques importants de cet article. Pour chacun : "term" (tel qu'écrit dans l'article, dans sa langue), "keep" (true si les spécialistes francophones emploient ce terme en anglais), "fr" (la forme à utiliser dans la traduction : la traduction française de référence, ou le terme anglais d'usage si keep=true), "definition" (une explication très simple en français, une phrase, pour quelqu'un qui découvre le domaine).${getSettings().keepTermsHint ? `\n\nPréférences de l'utilisateur : ${getSettings().keepTermsHint}` : ""}`,
    schema: GLOSSARY_SCHEMA,
    maxTokens: 8000,
    tier: "heavy",
  });
  const fresh = data.terms.filter((t) => t.term?.trim() && !known.some((k) => k.term.toLowerCase() === t.term.toLowerCase()));
  rememberGlossary(fresh, lang);
  // Known terms were used again: they count as more common.
  rememberGlossary(known, lang);
  return [...known, ...fresh];
}

interface Segment {
  key: string; // `${block}:${seg}`
  block: number;
  seg: number;
  text: string;
  tokens: string[];
}

/** Replace formulas, code and references by ⟦n⟧ so the model cannot damage them. */
function protect(html: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const text = html.replace(/<math[\s\S]*?<\/math>|<code>[\s\S]*?<\/code>|<span class="ref">[\s\S]*?<\/span>|<a [^>]*>[\s\S]*?<\/a>/g, (m) => {
    tokens.push(m);
    return `⟦${tokens.length}⟧`;
  });
  return { text: text.replace(/<span>|<\/span>/g, ""), tokens };
}

function restore(fr: string, tokens: string[]) {
  let out = fr.replace(/⟦(\d+)⟧/g, (m, n) => tokens[Number(n) - 1] ?? m);
  // Any token the model dropped is appended so no formula or reference is lost.
  tokens.forEach((t, i) => {
    if (!fr.includes(`⟦${i + 1}⟧`)) out += ` ${t}`;
  });
  return out;
}

export function collectSegments(c: ArticleContent): Segment[] {
  const segs: Segment[] = [];
  c.blocks.forEach((b, bi) => {
    (b.segs ?? []).forEach((html, si) => {
      if (!html || c.tr[bi]?.[si]) return;
      const { text, tokens } = protect(html);
      // Nothing to translate in pure formulas or pure numbers.
      if (!/[a-zA-Z]{2,}/.test(text.replace(/⟦\d+⟧/g, ""))) return;
      segs.push({ key: `${bi}:${si}`, block: bi, seg: si, text, tokens });
    });
  });
  return segs;
}

function batches(segs: Segment[], maxChars: number): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segs) {
    if (cur.length && (size + s.text.length > maxChars || cur.length >= 40)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += s.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

function glossaryText(g: GlossaryTerm[]) {
  if (!g.length) return "(aucun)";
  return g
    .map((t) => (t.keep ? `- ${t.term} → « ${t.fr || t.term} » (terme anglais d'usage, à garder)` : `- ${t.term} → « ${t.fr} »`))
    .join("\n");
}

type Tier = "light" | "heavy";

interface BatchResult {
  fr: Map<string, string>;
  /** Translations still holding their ⟦n⟧ markers, for the translation memory. */
  raw: Map<string, string>;
  /** Segments whose translation looks wrong and should be redone by the stronger model. */
  suspicious: Set<string>;
  provider: string;
}

const EN_WORDS = new Set("the of and to in is are was were that this with for which from by be as on these those has have it its their".split(" "));
const FR_WORDS = new Set("le la les de des du un une et est en que qui dans pour par sur au aux ce cette ces se sont il elle ils on pas plus ou avec".split(" "));

/** Cheap checks that catch the usual failures of small models, without any AI call. */
function looksWrong(s: Segment, frRaw: string, glossary: GlossaryTerm[], lang = "en"): boolean {
  const src = s.text.replace(/<[^>]+>/g, " ");
  const out = frRaw.replace(/<[^>]+>/g, " ");
  // A formula or reference marker went missing.
  for (let i = 1; i <= s.tokens.length; i++) if (!frRaw.includes(`⟦${i}⟧`)) return true;
  const words = out.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length >= 8 && lang === "en") {
    // Still mostly English.
    const en = words.filter((w) => EN_WORDS.has(w)).length / words.length;
    if (en > 0.12) return true;
  }
  // Whatever the source language, real French has its small function words.
  if (words.length >= 12 && words.filter((w) => FR_WORDS.has(w)).length / words.length < 0.06) return true;
  // Much shorter or longer than the source: something was dropped or invented.
  // (Chinese and Japanese are much denser than French: no length check for them.)
  const ratio = out.trim().length / Math.max(1, src.trim().length);
  if (src.length > 60 && !["zh", "ja"].includes(lang) && (ratio < 0.6 || ratio > 2.2)) return true;
  // A term that must stay in English was translated anyway.
  for (const g of glossary) {
    if (!g.keep || g.term.length < 3) continue;
    const expected = (g.fr || g.term).toLowerCase();
    if (src.toLowerCase().includes(g.term.toLowerCase()) && !out.toLowerCase().includes(expected)) return true;
  }
  return false;
}

/** How technical a passage is: formulas, references and glossary terms. */
function density(s: Segment, glossary: GlossaryTerm[]) {
  const formulas = s.tokens.filter((t) => t.startsWith("<math") || t.startsWith("<code")).length;
  const lower = s.text.toLowerCase();
  const terms = glossary.filter((g) => lower.includes(g.term.toLowerCase())).length;
  return formulas * 2 + terms;
}

async function translateBatch(a: Article, glossary: GlossaryTerm[], batch: Segment[], tier: Tier): Promise<BatchResult> {
  const hint = getSettings().keepTermsHint;
  try {
    const { data, provider } = await llmJson<{ translations: { i: number; fr: string }[] }>({
      system: `${RULES}${hint ? `\n\nPréférences de l'utilisateur : ${hint}` : ""}\n\nArticle : « ${a.title} »\nLangue de l'article : ${languageLabel(a.lang)}\n\nGlossaire de cet article :\n${glossaryText(glossary)}`,
      user: `Traduis chaque segment en français. Réponds avec un élément par segment, avec le même "i".\n\n${JSON.stringify(
        batch.map((s, i) => ({ i, text: s.text })),
      )}`,
      schema: TRANSLATION_SCHEMA,
      maxTokens: tier === "light" ? 4000 : 32000,
      tier,
    });
    const res: BatchResult = { fr: new Map(), raw: new Map(), suspicious: new Set(), provider };
    for (const t of data.translations) {
      const s = batch[t.i];
      if (!s || !t.fr?.trim()) continue;
      res.fr.set(s.key, restore(t.fr, s.tokens));
      res.raw.set(s.key, t.fr);
      if (tier === "light" && looksWrong(s, t.fr, glossary, a.lang)) res.suspicious.add(s.key);
    }
    for (const s of batch) if (tier === "light" && !res.fr.has(s.key)) res.suspicious.add(s.key);
    return res;
  } catch (e) {
    if (e instanceof OutputTooLongError && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      const x = await translateBatch(a, glossary, batch.slice(0, mid), tier);
      const y = await translateBatch(a, glossary, batch.slice(mid), tier);
      return {
        fr: new Map([...x.fr, ...y.fr]),
        raw: new Map([...x.raw, ...y.raw]),
        suspicious: new Set([...x.suspicious, ...y.suspicious]),
        provider: x.provider,
      };
    }
    throw e;
  }
}

/**
 * Translate the untranslated segments of an article — all of them, or only `only`
 * (the passages on screen) — calling `onBatch` after each finished batch so the
 * reader can show French text as it arrives.
 *
 * Passages already in the shared translation memory cost nothing. In hybrid mode the
 * bulk model and Claude work at the same time: Claude takes the most technical
 * passages (up to a third) and then redoes any translation that fails the checks.
 */
export async function translateContent(
  a: Article,
  c: ArticleContent,
  onBatch: (done: number, total: number) => void,
  only?: Set<string>,
  useMemory = true,
): Promise<void> {
  let segs = collectSegments(c).filter((s) => !only || only.has(s.key));

  // Free first: everything the memory already knows (skipped when redoing a translation).
  const fromMemory = segs.filter((s) => {
    if (!useMemory) return false;
    const raw = recall(s.text);
    if (raw === undefined) return false;
    (c.tr[s.block] ??= [])[s.seg] = restore(raw, s.tokens);
    return true;
  });
  if (fromMemory.length) {
    c.trBy = { ...c.trBy, "Mémoire de traduction": (c.trBy?.["Mémoire de traduction"] ?? 0) + fromMemory.length };
    segs = segs.filter((s) => !fromMemory.includes(s));
  }
  const total = segs.length;
  if (!total) {
    onBatch(0, 0);
    return;
  }

  if (!c.glossary?.length) {
    try {
      // The glossary steers the whole translation: worth the stronger model, once per article.
      c.glossary = await buildGlossary(a, c);
    } catch {
      // Translate anyway; the glossary will be attempted again next time.
    }
  }
  const glossary = c.glossary ?? [];
  const provider = getSettings().provider;
  const hybrid = provider === "hybrid";
  // Without a Gemini key, the bulk of a hybrid translation runs on the local GPU.
  const local =
    provider === "ollama" ||
    (hybrid && !geminiKey()) ||
    (provider === "auto" && !claudeKey() && !claudeCodeAvailable());

  let heavySegs: Segment[] = [];
  let lightSegs = segs;
  if (hybrid) {
    const ranked = segs
      .map((s) => ({ s, d: density(s, glossary) }))
      .filter((x) => x.d >= 3)
      .sort((x, y) => y.d - x.d)
      .slice(0, Math.ceil(segs.length / 3));
    const heavyKeys = new Set(ranked.map((x) => x.s.key));
    heavySegs = segs.filter((s) => heavyKeys.has(s.key));
    lightSegs = segs.filter((s) => !heavyKeys.has(s.key));
  }

  const lightQueue = batches(lightSegs, local ? 2500 : 6000);
  const heavyQueue = batches(heavySegs, 6000);
  const repairs: Segment[] = [];
  const used = new Map<string, number>();
  let done = 0;
  let failure: unknown;

  const apply = (batch: Segment[], r: BatchResult) => {
    used.set(r.provider, (used.get(r.provider) ?? 0) + r.fr.size);
    for (const s of batch) {
      const fr = r.fr.get(s.key);
      if (fr === undefined) continue;
      (c.tr[s.block] ??= [])[s.seg] = fr;
      // Only translations that passed the checks are worth remembering.
      const flagged = hybrid && r.suspicious.has(s.key);
      if (!flagged) remember(s.text, r.raw.get(s.key)!);
    }
    if (hybrid) for (const s of batch) if (r.suspicious.has(s.key)) repairs.push(s);
  };

  const worker = (queue: Segment[][], tier: Tier) => async () => {
    while (queue.length && !failure) {
      const batch = queue.shift()!;
      try {
        apply(batch, await translateBatch(a, glossary, batch, tier));
      } catch (e) {
        failure = e;
      }
      done += batch.length;
      onBatch(Math.min(done, total), total);
    }
  };

  if (hybrid) {
    // GPU and Claude in parallel; Claude then turns to the repairs.
    // One request at a time on the bulk side: the GPU, or Gemini's free per-minute quota.
    const lightWorkers = 1;
    await Promise.all([
      ...Array.from({ length: lightWorkers }, () => worker(lightQueue, "light")()),
      worker(heavyQueue, "heavy")(),
      worker(heavyQueue, "heavy")(),
    ]);
    if (repairs.length && !failure) {
      const repairQueue = batches(repairs, 6000);
      try {
        await Promise.all([worker(repairQueue, "heavy")(), worker(repairQueue, "heavy")()]);
      } catch {
        /* the local translation stays in place */
      }
      failure = undefined; // a failed repair still leaves a usable translation
    }
  } else {
    // Claude Code starts one process per request: two at a time keeps the subscription calm.
    const parallel = local ? 1 : provider === "claude-code" ? 2 : 3;
    await Promise.all(Array.from({ length: parallel }, worker(lightQueue, "light")));
  }

  // Running totals across every partial translation of this article.
  const by = { ...c.trBy };
  for (const [p, n] of used) by[p] = (by[p] ?? 0) + n;
  if (repairs.length) by["Corrections par Claude"] = (by["Corrections par Claude"] ?? 0) + repairs.length;
  c.trBy = by;
  c.translatedBy = Object.entries(by)
    .map(([p, n]) => `${p} : ${n} passages`)
    .join(" · ");
  if (failure) throw failure;
}
