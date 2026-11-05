import { app, clipboard, shell } from "electron";
import type { LexiconProposal, LexiconStatus } from "@shared/types";
import { glossaryEntries } from "./ai/memory";
import { getSettings } from "./settings";
import { JsonDoc } from "./store";

/**
 * Proposing the terms the app has learned to the shared lexicon. Nothing is sent by the
 * app: it opens a GitHub issue already filled in, which the reader reads and submits
 * (or not) from their own GitHub account.
 */

const REPO = "hantanHugues/nukun";
/** Terms waiting before the weekly reminder shows up. */
export const LEXICON_MIN = 20;
/** The most terms in one proposal. */
const BATCH_MAX = 60;
/** GitHub answers with an error beyond about 7000 characters (tested): above this, the clipboard is used. */
const URL_MAX = 6000;
const WEEK = 7 * 24 * 3600_000;

interface Share {
  /** Keys of the terms already proposed. */
  proposed: string[];
  /** When the reminder was last shown: at most one a week. */
  askedAt?: string;
  remind: boolean;
}

let doc: JsonDoc<Share> | null = null;
const share = () => (doc ??= new JsonDoc<Share>("lexicon-share.json", { proposed: [], remind: true }));

export function flushLexicon() {
  doc?.flush();
}

/** Terms learned and not proposed yet, the most used first. */
function pending() {
  const done = new Set(share().data.proposed);
  return glossaryEntries()
    .filter((e) => !done.has(e.key) && e.term.term.trim() && (e.term.fr?.trim() || e.term.keep))
    .sort((a, b) => b.uses - a.uses || a.term.term.localeCompare(b.term.term));
}

type Entry = ReturnType<typeof pending>[number];

/** One line of the proposal: fields apart by "|", so no "|" or line break inside them. */
const one = (s: string | undefined, max: number) =>
  (s ?? "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const line = (e: Entry) =>
  [e.reading, e.src, one(e.term.term, 80), one(e.term.fr, 120), e.term.keep ? "garder" : "traduire", one(e.term.definition, 220)].join(" | ");

const titleOf = (n: number) => `Lexique : ${n} termes proposés`;

function bodyOf(entries: Entry[]) {
  return [
    `Lexique proposé depuis Nùkún ${app.getVersion()}. Une ligne par terme :`,
    "langue de lecture | langue source | terme | traduction | garder ou traduire | définition",
    "",
    "```lexique",
    ...entries.map(line),
    "```",
  ].join("\n");
}

const issueUrl = (title: string, body: string) =>
  `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=lexique`;

export function lexiconStatus(): LexiconStatus {
  const s = getSettings();
  const d = share().data;
  const waiting = pending().length;
  // Not during the first launch (welcome, tour), and at most once a week.
  const due =
    d.remind &&
    !!s.onboarded &&
    !!s.interestsChosen &&
    waiting >= LEXICON_MIN &&
    (!d.askedAt || Date.now() - Date.parse(d.askedAt) >= WEEK);
  return { pending: waiting, proposed: d.proposed.length, remind: d.remind, due, min: LEXICON_MIN };
}

/** What a proposal would contain, shown to the reader before anything opens. */
export function lexiconPrepare(): LexiconProposal {
  const all = pending();
  const batch = all.slice(0, BATCH_MAX);
  const method = issueUrl(titleOf(batch.length), bodyOf(batch)).length <= URL_MAX ? "url" : "clipboard";
  return {
    keys: batch.map((e) => e.key),
    terms: batch.map((e) => ({ term: e.term.term, translation: e.term.fr?.trim() || undefined, keep: e.term.keep, definition: e.term.definition })),
    total: all.length,
    method,
  };
}

/** Opens the GitHub message with these terms, and does not offer them again. */
export function lexiconOpen(keys: string[]) {
  const wanted = new Set(keys);
  const entries = pending()
    .filter((e) => wanted.has(e.key))
    .slice(0, BATCH_MAX);
  if (!entries.length) return;
  const title = titleOf(entries.length);
  const body = bodyOf(entries);
  const url = issueUrl(title, body);
  if (url.length <= URL_MAX) {
    void shell.openExternal(url);
  } else {
    // Too long for an address: the reader pastes it into the message.
    clipboard.writeText(body);
    void shell.openExternal(issueUrl(title, "Colle ici le lexique copié depuis Nùkún (Ctrl+V)."));
  }
  const d = share().data;
  d.proposed.push(...entries.map((e) => e.key));
  d.askedAt = new Date().toISOString();
  share().save();
}

/** The reminder was shown: the next one is a week away. */
export function lexiconShown() {
  share().data.askedAt = new Date().toISOString();
  share().save();
}

export function lexiconRemind(on: boolean) {
  share().data.remind = on;
  share().save();
}
