import type { DomainId } from "@shared/types";
import { UNCLASSIFIED } from "@shared/types";

/** The app's first, hand-made domains, mapped to OpenAlex fields (data migration). */
export const LEGACY_DOMAINS: Record<string, DomainId> = { info: "17", robot: "22", phys: "31", bio: "13", psy: "32", autre: UNCLASSIFIED };

/**
 * Keyword hints, used only as a fallback when OpenAlex cannot classify an article
 * (no DOI, or not indexed yet). Keys are OpenAlex field ids.
 */
const HINTS: Record<string, string[]> = {
  "32": [
    "emotion", "emotional", "affect", "affective", "mood", "anxiety", "depress", "psycholog", "psychiatr",
    "personality", "impulsiv", "cognitive", "cognition", "behavio", "stress", "wellbeing", "well-being",
    "trauma", "ptsd", "bipolar", "borderline", "attachment", "empathy", "motivation", "self-regulation",
    "loneliness", "social anxiety", "rumination", "resilience", "mindfulness", "suicid", "fear", "anger",
  ],
  "17": [
    "machine learning", "deep learning", "neural network", "language model", "llm", "algorithm", "software",
    "computer", "computing", "artificial intelligence", "dataset", "transformer", "cybersecurity", "encryption",
    "internet of things", "iot", "blockchain", "network protocol", "cloud", "database", "programming",
  ],
  "22": [
    "robot", "robotic", "autonomous vehicle", "drone", "uav", "actuator", "manipulator", "exoskeleton",
    "embedded", "microcontroller", "sensor fusion", "control system", "circuit", "electronic", "semiconductor",
    "mems", "lidar", "slam", "locomotion",
  ],
  "31": [
    "quantum", "photon", "laser", "galaxy", "galaxies", "exoplanet", "planet", "star ", "stellar", "cosmolog",
    "black hole", "gravitational", "astrophys", "telescope", "spacecraft", "nasa", "particle", "superconduct",
    "magnetic", "plasma", "optics", "material", "thermodynamic", "climate", "atmospher", "solar", "orbit",
    "asteroid", "moon", "mars", "jupiter", "satellite",
  ],
  "13": [
    "cell", "gene", "genom", "protein", "dna", "rna", "neuron", "brain", "cancer", "tumor", "immune",
    "bacteria", "virus", "microbio", "clinical", "patient", "disease", "mice", "mouse", "enzyme",
    "molecular", "evolution", "species", "metabol", "drug", "tissue",
  ],
};

export function classifyText(text: string, fallback: DomainId = UNCLASSIFIED): DomainId {
  const t = ` ${text.toLowerCase()} `;
  let best: DomainId = fallback;
  let bestScore = 0;
  for (const [domain, words] of Object.entries(HINTS) as [DomainId, string[]][]) {
    let score = 0;
    for (const w of words) if (t.includes(w)) score += w.includes(" ") ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return bestScore >= 1 ? best : fallback;
}

/** Very common words of each Latin-script language the app handles. */
const LANG_WORDS: Record<string, string[]> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "with", "this", "are", "was", "we", "on", "by"],
  fr: ["le", "la", "les", "des", "et", "est", "une", "dans", "pour", "que", "qui", "sur", "du", "au", "nous"],
  es: ["el", "los", "las", "del", "y", "es", "una", "para", "que", "con", "por", "se", "como", "su", "entre"],
  pt: ["o", "os", "as", "do", "da", "dos", "e", "uma", "para", "que", "com", "não", "em", "são", "pelo"],
  de: ["der", "die", "das", "und", "ist", "ein", "eine", "mit", "für", "von", "den", "zu", "auf", "nicht", "sich"],
};

/**
 * Guesses the language of a text from its alphabet, then from its most common
 * words. Returns undefined when unsure, so the source's own value is kept.
 */
export function detectLanguage(text: string): string | undefined {
  const t = text.slice(0, 3000);
  if (/[぀-ヿ]/.test(t)) return "ja"; // kana
  if ((t.match(/[一-鿿]/g)?.length ?? 0) > 20) return "zh";
  if ((t.match(/[Ѐ-ӿ]/g)?.length ?? 0) > 30) return "ru";
  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 15) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  let second = 0;
  for (const [lang, list] of Object.entries(LANG_WORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length / words.length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > second) second = score;
  }
  // Clear winner only.
  return bestScore > 0.08 && bestScore > second * 1.5 ? best : undefined;
}
