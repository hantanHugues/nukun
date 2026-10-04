import { EN } from "./i18n-en";

/**
 * The app's language: French or English. It sets the interface texts and the
 * language articles are translated, explained and discussed in.
 *
 * Texts are written in French in the code and looked up in an English dictionary
 * (`i18n-en.ts`) when the app is in English: `t("Actualiser")`. `{name}` marks a
 * value filled in: `t("{n} articles", { n: 12 })`. `npm run i18n:check` lists the
 * texts missing from the dictionary.
 */
export type UiLang = "fr" | "en";

let current: UiLang = "fr";

export function setLang(l: UiLang) {
  current = l;
}

export function lang(): UiLang {
  return current;
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = current === "en" ? (EN[fr] ?? fr) : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Date and number formats of the current language. */
export const locale = () => (current === "en" ? "en-GB" : "fr-FR");

/** The language names in the reading language, for prompts and labels. */
export const readingLanguageName = () => (current === "en" ? "English" : "French");
