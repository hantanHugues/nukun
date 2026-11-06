import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { lang, t } from "@shared/i18n";
import { plan } from "@shared/builtinSplit";
import type { BuiltinPack, BuiltinStatus } from "@shared/types";
import BuiltinWorker from "./builtinWorker?nodeWorker";

/**
 * The built-in translator: small translation models that run on the processor, with no
 * key, no account and no connection once downloaded. Nothing is downloaded or loaded
 * without the user's click; the model leaves memory a few minutes after the last use.
 */

interface PackDef {
  id: BuiltinPack;
  model: string;
  mb: number;
  files: string[];
}

const OPUS_FILES = ["config.json", "generation_config.json", "tokenizer_config.json", "tokenizer.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];

const PACKS: PackDef[] = [
  { id: "en-fr", model: "Xenova/opus-mt-en-fr", mb: 113, files: OPUS_FILES },
  { id: "fr-en", model: "Xenova/opus-mt-fr-en", mb: 113, files: OPUS_FILES },
  { id: "other", model: "Xenova/nllb-200-distilled-600M", mb: 912, files: OPUS_FILES },
];

/** NLLB language codes of the languages the app reads. */
const NLLB: Record<string, string> = {
  en: "eng_Latn",
  fr: "fra_Latn",
  es: "spa_Latn",
  pt: "por_Latn",
  de: "deu_Latn",
  ru: "rus_Cyrl",
  ja: "jpn_Jpan",
  zh: "zho_Hans",
};

const modelsDir = () => path.join(app.getPath("userData"), "models");
const fileOf = (p: PackDef, f: string) => path.join(modelsDir(), ...p.model.split("/"), ...f.split("/"));
const pack = (id: BuiltinPack) => PACKS.find((p) => p.id === id)!;
const isDownloaded = (id: BuiltinPack) => pack(id).files.every((f) => fs.existsSync(fileOf(pack(id), f)));

/** The pack that translates `src` into `tgt`, or null when there is nothing to translate. */
export function packFor(src: string, tgt: string): BuiltinPack | null {
  if (src === tgt) return null;
  if (src === "en" && tgt === "fr") return "en-fr";
  if (src === "fr" && tgt === "en") return "fr-en";
  return "other";
}

export function builtinCovers(src: string, tgt: string) {
  return packFor(src, tgt) !== "other" || (!!NLLB[src] && !!NLLB[tgt]);
}

// ------------------------------------------------------------------ download

let downloading: { id: BuiltinPack; done: number } | undefined;
let lastError: string | undefined;

export function builtinStatus(): BuiltinStatus {
  const reading = lang();
  const need = packFor(reading === "fr" ? "en" : "fr", reading);
  return {
    packs: PACKS.map((p) => ({ id: p.id, mb: p.mb, downloaded: isDownloaded(p.id) })),
    need,
    downloading: downloading?.id,
    progress: downloading ? Math.min(1, downloading.done / (pack(downloading.id).mb * 1e6)) : undefined,
    error: lastError,
  };
}

/** Downloads one file into "<file>.part", resuming where a cut download stopped. */
async function downloadFile(p: PackDef, f: string, onBytes: (n: number) => void) {
  const dest = fileOf(p, f);
  if (fs.existsSync(dest)) {
    onBytes(fs.statSync(dest).size);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`https://huggingface.co/${p.model}/resolve/main/${f}`, {
      headers: have ? { Range: `bytes=${have}-` } : {},
      signal: ctrl.signal,
    });
    if (res.status === 416) {
      fs.renameSync(part, dest);
      return;
    }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const resumed = res.status === 206;
    const out = fs.createWriteStream(part, { flags: resumed ? "a" : "w" });
    onBytes(resumed ? have : 0);
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), 60000);
      onBytes(value.length);
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    fs.renameSync(part, dest);
  } finally {
    clearTimeout(idle);
  }
}

/** Downloads a pack, only when the user asked for it. */
export async function builtinDownload(id: BuiltinPack): Promise<void> {
  if (downloading || isDownloaded(id)) return;
  const p = pack(id);
  downloading = { id, done: 0 };
  lastError = undefined;
  try {
    for (const f of p.files) await downloadFile(p, f, (n) => (downloading!.done += n));
  } catch (e) {
    lastError = e instanceof Error && e.name === "AbortError" ? t("La connexion s'est arrêtée. Réessaie : le téléchargement reprendra là où il s'est arrêté.") : t("Téléchargement impossible : vérifie ta connexion, puis réessaie.");
    throw e;
  } finally {
    downloading = undefined;
  }
}

export function builtinRemove(id: BuiltinPack) {
  const p = pack(id);
  void stopWorker();
  fs.rmSync(path.join(modelsDir(), ...p.model.split("/")), { recursive: true, force: true });
}

// ------------------------------------------------------------------ worker

type Pending = { resolve: (v: string[]) => void; reject: (e: Error) => void };
let worker: ReturnType<typeof BuiltinWorker> | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let idleTimer: NodeJS.Timeout | undefined;
let chain: Promise<unknown> = Promise.resolve();

const IDLE_MS = 3 * 60 * 1000;

async function stopWorker() {
  clearTimeout(idleTimer);
  const w = worker;
  worker = null;
  for (const [, p] of pending) p.reject(new Error(t("Le traducteur intégré s'est arrêté.")));
  pending.clear();
  await w?.terminate();
}

function start() {
  if (worker) return worker;
  const w = BuiltinWorker({ workerData: { dir: modelsDir() } });
  w.on("message", (m: { id: number; out?: string[]; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.out) p.resolve(m.out);
    else p.reject(new Error(m.error ?? "?"));
  });
  const gone = (e?: Error) => {
    if (worker === w) worker = null;
    for (const [, p] of pending) p.reject(e ?? new Error(t("Le traducteur intégré s'est arrêté.")));
    pending.clear();
  };
  w.on("error", gone);
  w.on("exit", () => gone());
  worker = w;
  return w;
}

function run(model: string, texts: string[], opts?: object): Promise<string[]> {
  const job = chain.then(
    () =>
      new Promise<string[]>((resolve, reject) => {
        clearTimeout(idleTimer);
        const id = ++seq;
        pending.set(id, { resolve, reject });
        start().postMessage({ id, model, texts, opts });
      }),
  );
  chain = job.catch(() => undefined).then(() => {
    idleTimer = setTimeout(() => void stopWorker(), IDLE_MS);
    idleTimer.unref?.();
  });
  return job;
}

// ------------------------------------------------------------------ translating

export class BuiltinUnavailableError extends Error {}

/** Translates texts (which may hold ⟦n⟧ markers) from `src` into `tgt`. */
export async function builtinTranslate(texts: string[], src: string, tgt: string): Promise<string[]> {
  const id = packFor(src, tgt);
  if (!id) return texts;
  if (!builtinCovers(src, tgt)) throw new BuiltinUnavailableError(t("Le traducteur intégré ne lit pas encore cette langue. Choisis un autre mode dans les options avancées."));
  if (!isDownloaded(id)) {
    throw new BuiltinUnavailableError(
      id === "other"
        ? t("Cette langue demande le pack « Autres langues ». Télécharge-le dans Réglages, Intelligence artificielle.")
        : t("Le traducteur intégré n'est pas encore téléchargé. Télécharge-le dans Réglages, Intelligence artificielle."),
    );
  }
  const p = pack(id);
  const { jobs, build } = plan(texts);
  if (!jobs.length) return texts;
  const opts = id === "other" ? { src_lang: NLLB[src], tgt_lang: NLLB[tgt] } : undefined;
  return build(await run(p.model, jobs, opts));
}

/** A short sentence through the model: proves the download works on this PC. */
export async function builtinSelfTest(): Promise<string> {
  const reading = lang();
  const src = reading === "fr" ? "en" : "fr";
  const sample = src === "en" ? "The eye keeps watch over the world." : "L'œil veille sur le monde.";
  const [out] = await builtinTranslate([sample], src, reading);
  return out;
}
