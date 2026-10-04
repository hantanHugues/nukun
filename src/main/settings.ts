import { app, safeStorage } from "electron";
import path from "node:path";
import type { DomainId, Settings, SourceId, UsageStats } from "@shared/types";
import { FIELDS, LANGUAGES, SOURCES } from "@shared/types";
import { setLang } from "@shared/i18n";
import { JsonDoc } from "./store";

interface StoredSettings extends Omit<Settings, "hasClaudeKey" | "hasSemanticScholarKey" | "semanticScholarKey" | "hasGeminiKey"> {
  claudeKeyEnc?: string;
  s2KeyEnc?: string;
  geminiKeyEnc?: string;
}

const defaults = (): StoredSettings => ({
  provider: "hybrid",
  claudeModel: "claude-opus-5-5",
  claudeCodeModel: "opus",
  geminiModel: "auto",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  autoTranslate: true,
  keepTermsHint: "",
  sources: Object.fromEntries(SOURCES.map((s) => [s.id, true])) as Record<SourceId, boolean>,
  // Every discipline and every language at first: the feed learns from what is read.
  domains: Object.fromEntries(FIELDS.map((f) => [f.id, true])) as Record<DomainId, boolean>,
  languages: Object.fromEntries(LANGUAGES.map((l) => [l.id, true])),
  interests: [],
  refreshHours: 3,
  // French for a French-speaking Windows, English otherwise.
  uiLang: app.getLocale().toLowerCase().startsWith("fr") ? "fr" : "en",
  exportDir: path.join(app.getPath("documents"), "Nukun"),
  theme: "system",
  readerSize: 19,
});

let doc: JsonDoc<StoredSettings>;

function stored() {
  if (!doc) {
    doc = new JsonDoc<StoredSettings>("settings.json", defaults());
    const d = defaults();
    // Settings from before the 26 disciplines used other keys ("info", "psy"…): the
    // old choices covered only a few topics, so every discipline is switched on.
    const saved = doc.data.domains ?? {};
    const legacy = Object.keys(saved).some((k) => !/^\d+$/.test(k));
    doc.data = {
      ...d,
      ...doc.data,
      sources: { ...d.sources, ...doc.data.sources },
      domains: legacy ? d.domains : { ...d.domains, ...saved },
      languages: { ...d.languages, ...doc.data.languages },
    };
    setLang(doc.data.uiLang ?? "fr");
  }
  return doc;
}

function enc(v: string) {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString("base64") : `plain:${v}`;
}
function dec(v?: string) {
  if (!v) return undefined;
  if (v.startsWith("plain:")) return v.slice(6);
  try {
    return safeStorage.decryptString(Buffer.from(v, "base64"));
  } catch {
    return undefined;
  }
}

export function getSettings(): Settings {
  const { claudeKeyEnc, s2KeyEnc, geminiKeyEnc, ...rest } = stored().data;
  return { ...rest, hasClaudeKey: !!claudeKeyEnc, hasSemanticScholarKey: !!s2KeyEnc, hasGeminiKey: !!geminiKeyEnc };
}

export function claudeKey() {
  return dec(stored().data.claudeKeyEnc) || process.env.ANTHROPIC_API_KEY || undefined;
}

export function geminiKey() {
  return dec(stored().data.geminiKeyEnc) || process.env.GEMINI_API_KEY || undefined;
}

export function semanticScholarKey() {
  return dec(stored().data.s2KeyEnc);
}

export function saveSettings(
  patch: Partial<Settings> & { claudeKey?: string; semanticScholarKey?: string; geminiKey?: string },
): Settings {
  const d = stored();
  const { claudeKey: key, semanticScholarKey: s2, geminiKey: gk, hasClaudeKey, hasSemanticScholarKey, hasGeminiKey, ...rest } = patch;
  Object.assign(d.data, rest);
  if (rest.uiLang) setLang(rest.uiLang);
  if (key !== undefined) d.data.claudeKeyEnc = key.trim() ? enc(key.trim()) : undefined;
  if (s2 !== undefined) d.data.s2KeyEnc = s2.trim() ? enc(s2.trim()) : undefined;
  if (gk !== undefined) d.data.geminiKeyEnc = gk.trim() ? enc(gk.trim()) : undefined;
  d.flush();
  return getSettings();
}

// ---------------------------------------------------------------- usage / cost tracking
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

let usageDoc: JsonDoc<UsageStats>;
function usage() {
  usageDoc ??= new JsonDoc<UsageStats>("usage.json", {
    claudeInputTokens: 0,
    claudeOutputTokens: 0,
    claudeCostUsd: 0,
    ollamaCalls: 0,
    claudeCodeCalls: 0,
    geminiCalls: 0,
    monthKey: new Date().toISOString().slice(0, 7),
    monthCostUsd: 0,
  });
  return usageDoc;
}

export function getUsage(): UsageStats {
  const u = usage();
  const mk = new Date().toISOString().slice(0, 7);
  if (u.data.monthKey !== mk) {
    u.data.monthKey = mk;
    u.data.monthCostUsd = 0;
    u.save();
  }
  return u.data;
}

export function recordClaudeUsage(model: string, input: number, output: number) {
  const u = usage();
  getUsage();
  const price = PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ""] ?? [4, 20];
  const cost = (input * price[0] + output * price[1]) / 1e6;
  u.data.claudeInputTokens += input;
  u.data.claudeOutputTokens += output;
  u.data.claudeCostUsd += cost;
  u.data.monthCostUsd += cost;
  u.save();
}

export function recordOllamaCall() {
  const u = usage();
  u.data.ollamaCalls += 1;
  u.save();
}

export function recordGeminiCall() {
  const u = usage();
  u.data.geminiCalls = (u.data.geminiCalls ?? 0) + 1;
  u.save();
}

export function recordClaudeCodeCall() {
  const u = usage();
  u.data.claudeCodeCalls = (u.data.claudeCodeCalls ?? 0) + 1;
  u.save();
}
