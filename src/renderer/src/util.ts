import DOMPurify from "dompurify";
import type { Article, DomainId } from "@shared/types";
import { fieldGroup, fieldLabel, SOURCES } from "@shared/types";
import { lang, locale, t } from "@shared/i18n";

export const domainLabel = (d: DomainId) => fieldLabel(d);
export const sourceLabel = (a: Article) => a.venue || SOURCES.find((s) => s.id === a.source)?.label || a.source;

/** Card colours for articles without an image: one per big domain. */
const GROUP_ART = {
  physical: { g1: "#094074", g2: "#049ee2", dot: "rgba(255,255,255,.22)" },
  life: { g1: "#06291f", g2: "#0d8a5a", dot: "rgba(255,255,255,.2)" },
  health: { g1: "#130507", g2: "#830711", dot: "rgba(255,150,137,.3)" },
  social: { g1: "#1a0b2e", g2: "#6d3bbf", dot: "rgba(220,200,255,.25)" },
  none: { g1: "#151515", g2: "#595959", dot: "rgba(255,255,255,.2)" },
};
export const artFor = (d: DomainId) => GROUP_ART[fieldGroup(d) ?? "none"];

export function timeAgo(iso: string) {
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(d)) return "";
  if (d < 60) return t("à l'instant");
  if (d < 3600) return t("il y a {n} min", { n: Math.round(d / 60) });
  if (d < 86400) return t("il y a {n} h", { n: Math.round(d / 3600) });
  if (d < 86400 * 30) return t("il y a {n} j", { n: Math.round(d / 86400) });
  return new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
}

export function readingMinutes(a: Article, words?: number) {
  return Math.max(3, Math.round((words ?? 4000) / 200));
}

export function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "iframe"],
  });
}

export function plain(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function authorsShort(a: Article) {
  if (!a.authors.length) return "";
  if (a.authors.length === 1) return a.authors[0];
  return a.authors.length - 1 > 1
    ? t("{first} et {n} autres", { first: a.authors[0], n: a.authors.length - 1 })
    : t("{first} et {second}", { first: a.authors[0], second: a.authors[1] });
}

/** The help page of the website, in the app's language (anchors are the same in both). */
export function helpUrl(anchor = ""): string {
  const page = lang() === "en" ? "en/help.html" : "aide.html";
  return `https://hantanhugues.github.io/nukun/${page}${anchor}`;
}
