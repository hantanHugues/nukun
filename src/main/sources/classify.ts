import type { DomainId } from "@shared/types";

/** Keyword hints used to place an article from a multidisciplinary source into a domain. */
const HINTS: Record<Exclude<DomainId, "autre">, string[]> = {
  psy: [
    "emotion", "emotional", "affect", "affective", "mood", "anxiety", "depress", "psycholog", "psychiatr",
    "personality", "impulsiv", "cognitive", "cognition", "behavio", "stress", "wellbeing", "well-being",
    "trauma", "ptsd", "bipolar", "borderline", "attachment", "empathy", "motivation", "self-regulation",
    "loneliness", "social anxiety", "rumination", "resilience", "mindfulness", "suicid", "fear", "anger",
  ],
  info: [
    "machine learning", "deep learning", "neural network", "language model", "llm", "algorithm", "software",
    "computer", "computing", "artificial intelligence", "dataset", "transformer", "cybersecurity", "encryption",
    "internet of things", "iot", "blockchain", "network protocol", "cloud", "database", "programming",
  ],
  robot: [
    "robot", "robotic", "autonomous vehicle", "drone", "uav", "actuator", "manipulator", "exoskeleton",
    "embedded", "microcontroller", "sensor fusion", "control system", "circuit", "electronic", "semiconductor",
    "mems", "lidar", "slam", "locomotion",
  ],
  phys: [
    "quantum", "photon", "laser", "galaxy", "galaxies", "exoplanet", "planet", "star ", "stellar", "cosmolog",
    "black hole", "gravitational", "astrophys", "telescope", "spacecraft", "nasa", "particle", "superconduct",
    "magnetic", "plasma", "optics", "material", "thermodynamic", "climate", "atmospher", "solar", "orbit",
    "asteroid", "moon", "mars", "jupiter", "satellite",
  ],
  bio: [
    "cell", "gene", "genom", "protein", "dna", "rna", "neuron", "brain", "cancer", "tumor", "immune",
    "bacteria", "virus", "microbio", "clinical", "patient", "disease", "mice", "mouse", "enzyme",
    "molecular", "evolution", "species", "metabol", "drug", "tissue",
  ],
};

export function classifyText(text: string, fallback: DomainId = "autre"): DomainId {
  const t = ` ${text.toLowerCase()} `;
  let best: DomainId = fallback;
  let bestScore = 0;
  for (const [domain, words] of Object.entries(HINTS) as [DomainId, string[]][]) {
    let score = 0;
    for (const w of words) if (t.includes(w)) score += w.includes(" ") ? 2 : 1;
    // Psychology gets a small boost: it is a declared interest and often co-occurs with bio words.
    if (domain === "psy") score *= 1.3;
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return bestScore >= 1 ? best : fallback;
}
