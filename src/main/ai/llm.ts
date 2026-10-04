import Anthropic from "@anthropic-ai/sdk";
import { claudeKey, geminiKey, getSettings, recordClaudeUsage, recordGeminiCall, recordOllamaCall } from "../settings";
import { HttpError } from "../http";
import { claudeCodeAvailable, claudeCodeJson } from "./claudeCode";

export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  /**
   * In hybrid mode, "light" work (bulk translation, card titles) goes to the local model
   * and "heavy" work (glossary, technical passages, repairs, explanations) goes to Claude.
   */
  tier?: "light" | "heavy";
  /** An image to look at (a figure), for models that read images. */
  image?: { data: Buffer; mime: string };
}

export class LlmUnavailableError extends Error {}
export class OutputTooLongError extends Error {}

let client: Anthropic | null = null;
let clientKey = "";
let fallbacksSupported = true;

function claude(): Anthropic {
  const key = claudeKey();
  if (!key) throw new LlmUnavailableError("Aucune clé API Claude n'est enregistrée.");
  if (!client || key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 10 * 60 * 1000 });
    clientKey = key;
  }
  return client;
}

async function claudeJson<T>(req: JsonRequest): Promise<T> {
  const { claudeModel } = getSettings();
  const params = {
    model: claudeModel,
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: [{ role: "user" as const, content: req.user }],
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: req.schema } },
  };
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = fallbacksSupported
      ? // Scientific texts (biology, medicine) can trip safety classifiers by mistake:
        // the server-side fallback re-runs the request on another model instead of failing.
        await claude().beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await claude().beta.messages.create(params);
  } catch (e) {
    if (fallbacksSupported && e instanceof Anthropic.BadRequestError) {
      fallbacksSupported = false;
      res = await claude().beta.messages.create(params);
    } else throw e;
  }
  recordClaudeUsage(
    res.model,
    (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) * 0.1 + (res.usage.cache_creation_input_tokens ?? 0) * 1.25,
    res.usage.output_tokens ?? 0,
  );
  if (res.stop_reason === "refusal") throw new Error("Le modèle a refusé ce passage.");
  if (res.stop_reason === "max_tokens") throw new OutputTooLongError("Réponse trop longue.");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as T;
}

export async function ollamaReachable(): Promise<boolean> {
  const { ollamaUrl } = getSettings();
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function ollamaModels(): Promise<string[]> {
  const { ollamaUrl } = getSettings();
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function ollamaJson<T>(req: JsonRequest): Promise<T> {
  if (req.image) throw new LlmUnavailableError("Le modèle local ne lit pas les images.");
  const { ollamaUrl, ollamaModel } = getSettings();
  const model = ollamaModel || (await ollamaModels())[0];
  if (!model) throw new LlmUnavailableError("Ollama ne tourne pas ou aucun modèle n'est installé (Réglages → IA locale).");
  const r = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: req.schema,
      // Reasoning models think before answering: useless for translation and much slower.
      ...(/qwen3|deepseek-r1|magistral/i.test(model) ? { think: false } : {}),
      // A 6k context keeps an 8B model and its cache inside about 6 GB of video memory.
      options: { temperature: 0.2, num_ctx: 6144, num_predict: req.maxTokens ?? 4000 },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!r.ok) throw new Error(`Ollama a répondu ${r.status} : ${await r.text()}`);
  const j = (await r.json()) as { message?: { content?: string }; done_reason?: string };
  recordOllamaCall();
  if (j.done_reason === "length") throw new OutputTooLongError("Réponse trop longue.");
  return JSON.parse(j.message?.content ?? "{}") as T;
}

/**
 * Free Google models, best first. Each has its own daily free quota, so rotating
 * through them multiplies what can be translated for free each day.
 */
export const GEMINI_ROTATION = [
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
  "gemini-flash-lite-latest",
];

/** Models whose daily quota is used up, with the time it comes back. */
const exhaustedUntil = new Map<string, number>();
let lastGeminiModel = "";

/** Some models add a word or two around the JSON: keep only the JSON object. */
function parseLooseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    let depth = 0;
    let inStr = false;
    for (let i = start; i >= 0 && i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1)) as T;
    }
    throw new Error("Réponse JSON illisible.");
  }
}

async function geminiCall<T>(key: string, model: string, req: JsonRequest): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...(req.image ? [{ inlineData: { mimeType: req.image.mime, data: req.image.data.toString("base64") } }] : []),
              { text: req.user },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: Math.max(req.maxTokens ?? 8000, 8000),
          responseMimeType: "application/json",
          responseJsonSchema: req.schema,
          // Gemma models served by the same API do not take a thinking setting.
          ...(model.startsWith("gemini") ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
        },
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (r.status === 429 || r.status >= 500) {
      lastErr = new HttpError(r.status, "Gemini");
      const body = (await r.json().catch(() => ({}))) as any;
      const asked = (body.error?.details ?? []).find((d: any) => d.retryDelay)?.retryDelay as string | undefined;
      const askedMs = asked ? parseFloat(asked) * 1000 : 0;
      const msg = String(body.error?.message ?? "");
      // Daily quota: "retry in 22h39m…". Put the model aside until then.
      const long = msg.match(/retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/);
      const longMs = long ? ((+long[1] || 0) * 3600 + (+long[2] || 0) * 60 + parseFloat(long[3])) * 1000 : askedMs;
      if (r.status === 429 && longMs > 65000) {
        exhaustedUntil.set(model, Date.now() + longMs);
        throw lastErr;
      }
      if (r.status >= 500 && attempt >= 1) throw lastErr; // busy: let the next model try
      await new Promise((res) => setTimeout(res, Math.max(askedMs, 4000 * (attempt + 1))));
      continue;
    }
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(`Gemini : ${j.error?.message ?? r.status}`);
    recordGeminiCall();
    const cand = j.candidates?.[0];
    if (cand?.finishReason === "MAX_TOKENS") throw new OutputTooLongError("Réponse trop longue.");
    const text = (cand?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
    if (!text) throw new Error(`Gemini n'a rien renvoyé (${cand?.finishReason ?? "raison inconnue"}).`);
    return parseLooseJson<T>(text);
  }
  throw lastErr;
}

/** Free Google models in rotation (or the one chosen in the settings). */
async function geminiJson<T>(req: JsonRequest): Promise<T> {
  const key = geminiKey();
  if (!key) throw new LlmUnavailableError("Aucune clé Gemini enregistrée.");
  const chosen = getSettings().geminiModel;
  const models = !chosen || chosen === "auto" ? GEMINI_ROTATION : [chosen];
  let lastErr: unknown = new LlmUnavailableError("Quotas gratuits Google épuisés pour aujourd'hui.");
  for (const model of models) {
    if ((exhaustedUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      const data = await geminiCall<T>(key, model, req);
      lastGeminiModel = model;
      return data;
    } catch (e) {
      if (e instanceof OutputTooLongError) throw e;
      console.warn(`[IA] ${model} indisponible :`, describeError(e));
      lastErr = e;
    }
  }
  throw lastErr;
}

export function geminiAvailableToday() {
  const chosen = getSettings().geminiModel;
  const models = !chosen || chosen === "auto" ? GEMINI_ROTATION : [chosen];
  return !!geminiKey() && models.some((m) => (exhaustedUntil.get(m) ?? 0) <= Date.now());
}

/** Ask the configured model for a JSON answer that follows `schema`. */
export async function llmJson<T>(req: JsonRequest): Promise<{ data: T; provider: string }> {
  const s = getSettings();
  const ollamaName = `Ollama (${s.ollamaModel || "auto"})`;
  const ccName = `Abonnement Claude (${s.claudeCodeModel || "opus"})`;
  const geminiName = () => `Google (${lastGeminiModel || "gratuit"})`;
  if (s.provider === "ollama") return { data: await ollamaJson<T>(req), provider: ollamaName };

  type Step = { name: () => string; available: () => boolean | Promise<boolean>; run: () => Promise<T> };
  const gemini: Step = { name: geminiName, available: geminiAvailableToday, run: () => geminiJson<T>(req) };
  const local: Step = { name: () => ollamaName, available: ollamaReachable, run: () => ollamaJson<T>(req) };
  const sub: Step = { name: () => ccName, available: claudeCodeAvailable, run: () => claudeCodeJson<T>(req) };

  if (s.provider === "hybrid" || s.provider === "gemini") {
    // Hybrid: free Gemini (or the local model) does the bulk, Claude the technical work.
    // Every step covers for the one before: quota reached, service busy, offline…
    const chain =
      s.provider === "gemini"
        ? [gemini, local]
        : req.tier === "heavy"
          ? [sub, gemini, local]
          : [gemini, local, sub];
    let lastErr: unknown = new LlmUnavailableError("Aucune IA disponible : ajoute une clé Gemini, lance Ollama ou connecte Claude Code.");
    for (const [i, step] of chain.entries()) {
      if (!(await step.available())) continue;
      try {
        const data = await step.run();
        return { data, provider: i === 0 ? step.name() : `${step.name()}, en relais` };
      } catch (e) {
        if (e instanceof OutputTooLongError) throw e;
        console.warn(`[IA] ${step.name()} indisponible, relais :`, describeError(e));
        lastErr = e;
      }
    }
    throw lastErr;
  }
  if (s.provider === "claude") return { data: await claudeJson<T>(req), provider: `Claude API (${s.claudeModel})` };
  if (s.provider === "claude-code") {
    try {
      return { data: await claudeCodeJson<T>(req), provider: ccName };
    } catch (e) {
      // Subscription limit reached or Claude Code unavailable: carry on locally when possible.
      if (await ollamaReachable()) return { data: await ollamaJson<T>(req), provider: `${ollamaName}, en relais` };
      throw e;
    }
  }

  // Auto: Claude (API key, else the subscription), then the local model.
  let claudeErr: unknown;
  if (claudeKey()) {
    try {
      return { data: await claudeJson<T>(req), provider: `Claude API (${s.claudeModel})` };
    } catch (e) {
      if (e instanceof OutputTooLongError) throw e;
      claudeErr = e;
    }
  } else if (claudeCodeAvailable()) {
    try {
      return { data: await claudeCodeJson<T>(req), provider: ccName };
    } catch (e) {
      claudeErr = e;
    }
  }
  if (await ollamaReachable()) return { data: await ollamaJson<T>(req), provider: ollamaName };
  if (claudeErr) throw new LlmUnavailableError(`Claude indisponible (${describeError(claudeErr)}) et Ollama ne tourne pas.`);
  throw new LlmUnavailableError("Aucune IA disponible : installe Ollama, ou choisis ton abonnement Claude dans les réglages.");
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "clé API invalide";
  if (e instanceof Anthropic.PermissionDeniedError) return "accès refusé";
  if (e instanceof Anthropic.RateLimitError) return "trop de requêtes, réessaie dans un moment";
  if (e instanceof Anthropic.BadRequestError) return `requête refusée : ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "pas de connexion à l'API";
  if (e instanceof Anthropic.APIError) return `erreur API ${e.status}`;
  if (e instanceof HttpError) {
    if (e.status === 429) return "le service limite le nombre de requêtes, nouvel essai à la prochaine actualisation";
    if (e.status >= 500) return `le service est momentanément indisponible (erreur ${e.status})`;
    if (e.status === 403 || e.status === 401) return "accès refusé par le service";
    return `le service a répondu avec l'erreur ${e.status}`;
  }
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return "le service n'a pas répondu à temps";
  return e instanceof Error ? e.message : String(e);
}

export async function testAi(): Promise<{ ok: boolean; message: string }> {
  try {
    const { data, provider } = await llmJson<{ reply: string }>({
      system: "Tu réponds en français, en une phrase courte.",
      user: "Dis bonjour et confirme que tu es prêt à traduire des articles scientifiques.",
      schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false },
      maxTokens: 2000,
    });
    return { ok: true, message: `${provider} : ${data.reply}` };
  } catch (e) {
    return { ok: false, message: describeError(e) };
  }
}
