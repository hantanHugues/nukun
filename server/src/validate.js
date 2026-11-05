import { createHash } from "node:crypto";

/**
 * Strict checks on what arrives. A term is a few words of letters, digits and the usual
 * signs of a scientific name (CD4+, α-synuclein, p53, T-cell): no markup, no address, no
 * line break. The text is untrusted: it is also handed to the AI as data.
 */

const LANG = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/;
const INSTALL = /^[0-9a-f]{32}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'’\-–/+()°%±&:;×µ·²³′″]*$/u;
const BAD_CHARS = /[<>`{}\\|\u0000-\u001f\u007f]/;
const URLISH = /(?:https?:|ftp:|www\.|mailto:|@[\w.-]+|\b[\w-]+\.(?:com|net|org|io|info|biz|xyz|ru|cn)\b)/i;

export const MAX_TERMS = 60;

const tidy = (s) => String(s).normalize("NFC").replace(/\s+/g, " ").trim();

/** One term from a submission: the cleaned term, or why it was turned down. */
export function cleanTerm(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "format" };
  const { src, keep } = raw;
  if (typeof src !== "string" || !LANG.test(src)) return { ok: false, reason: "langue source" };
  if (typeof raw.term !== "string" || typeof raw.definition !== "string") return { ok: false, reason: "format" };
  if (raw.translation !== undefined && raw.translation !== null && typeof raw.translation !== "string") return { ok: false, reason: "format" };
  if (keep !== undefined && typeof keep !== "boolean") return { ok: false, reason: "format" };

  const term = tidy(raw.term);
  if (term.length < 2 || term.length > 80 || !NAME.test(term) || URLISH.test(term)) return { ok: false, reason: "terme" };
  if (term.split(" ").length > 8) return { ok: false, reason: "terme trop long" };

  let translation = tidy(raw.translation ?? "");
  if (!translation && keep) translation = term;
  if (!translation) return { ok: false, reason: "traduction manquante" };
  if (translation.length > 120 || !NAME.test(translation) || URLISH.test(translation)) return { ok: false, reason: "traduction" };

  const definition = tidy(raw.definition);
  if (definition.length < 8 || definition.length > 240 || BAD_CHARS.test(definition) || URLISH.test(definition)) {
    return { ok: false, reason: "définition" };
  }
  return { ok: true, value: { src, term, translation, keep: keep === true, definition } };
}

/** The whole request body: structure errors turn it down, bad terms are only left out. */
export function validateBody(body) {
  if (!body || typeof body !== "object") return { error: "corps JSON attendu" };
  if (typeof body.install !== "string" || !INSTALL.test(body.install)) return { error: "identifiant d'installation invalide" };
  if (body.reading !== "fr" && body.reading !== "en") return { error: "langue de lecture invalide" };
  if (!Array.isArray(body.terms) || body.terms.length < 1) return { error: "aucun terme" };
  if (body.terms.length > MAX_TERMS) return { error: `au plus ${MAX_TERMS} termes par envoi` };
  const pow = body.pow;
  if (!pow || typeof pow.challenge !== "string" || typeof pow.nonce !== "string") return { error: "preuve de travail manquante" };

  const terms = [];
  const rejected = [];
  body.terms.forEach((raw, index) => {
    const r = cleanTerm(raw);
    if (r.ok) terms.push(r.value);
    else rejected.push({ index, reason: r.reason });
  });
  return { install: body.install, reading: body.reading, terms, rejected, pow: { challenge: pow.challenge, nonce: pow.nonce } };
}

/** Two proposals are the same when reading, source, term and translation match, whatever the case. */
export function keyOf(reading, t) {
  return createHash("sha256").update(`${reading}|${t.src}|${t.term.toLowerCase()}|${t.translation.toLowerCase()}`).digest("hex").slice(0, 32);
}
