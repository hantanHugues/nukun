import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Article } from "@shared/types";
import { JsonDoc } from "../store";

/**
 * Meaning of articles, whatever their language: a small multilingual model
 * (multilingual-e5-small, 130 MB, downloaded once from Hugging Face) turns each
 * article into a vector; two articles about the same thing are close even if one
 * is in Japanese and the other in English. It runs on the processor, offline once
 * downloaded, with no key and no cost. Without it (no connection on first launch,
 * model unavailable), recommendations fall back on words alone.
 */

const MODEL = "Xenova/multilingual-e5-small";
export const DIM = 384;

export type SemanticState = "idle" | "loading" | "ready" | "error";

type Embedder = (texts: string[], o: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let embedder: Promise<Embedder> | null = null;
let state: SemanticState = "idle";

function model(): Promise<Embedder> {
  embedder ??= (async () => {
    state = "loading";
    // ESM-only package: loaded on demand.
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = modelsDir();
    removeStaleDownloads(env.cacheDir);
    // Our own download, which resumes where it stopped (slow or cut connections).
    await downloadModel();
    const pipe = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
    state = "ready";
    return pipe as unknown as Embedder;
  })().catch((e) => {
    state = "error";
    embedder = null; // try again later (connection back…)
    throw e;
  });
  return embedder;
}

const modelsDir = () => path.join(app.getPath("userData"), "models");

/** The model's files, as the library expects them in its cache folder. */
const FILES = ["config.json", "tokenizer_config.json", "tokenizer.json", "onnx/model_quantized.onnx"];
const fileOf = (f: string) => path.join(modelsDir(), ...MODEL.split("/"), ...f.split("/"));

export function modelDownloaded() {
  return FILES.every((f) => fs.existsSync(fileOf(f)));
}

/** Bytes of the model downloaded so far, while it downloads (for the "Mes goûts" page). */
let progress: number | undefined;
export function modelProgress() {
  return state === "loading" ? progress : undefined;
}

/**
 * Downloads the model file by file, into "<file>.part", asking the server for the
 * rest only (HTTP Range) when a previous download was cut: nothing is fetched twice.
 * A connection silent for a minute is dropped; the next launch picks up again.
 */
async function downloadModel() {
  for (const f of FILES) {
    const dest = fileOf(f);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const ctrl = new AbortController();
    let idle = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${f}`, {
        headers: have ? { Range: `bytes=${have}-` } : {},
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      // 206: the rest of the file; 200: the server sent it all again.
      const out = fs.createWriteStream(part, { flags: res.status === 206 ? "a" : "w" });
      let done = res.status === 206 ? have : 0;
      const reader = res.body.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), 60000);
        done += value.length;
        if (f.endsWith(".onnx")) progress = done;
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
      fs.renameSync(part, dest);
    } finally {
      clearTimeout(idle);
    }
  }
}

/** Pieces of a download interrupted by closing the app ("model.onnx.tmp.<pid>.xxxx"). */
function removeStaleDownloads(dir: string) {
  try {
    for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const m = /\.tmp\.(\d+)\.[^\/]+$/.exec(f);
      if (m && Number(m[1]) !== process.pid) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    /* no models folder yet */
  }
}

/** Vectors are stored as 8-bit integers: 384 bytes per article. */
const pack = (v: number[]) => Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127)))).buffer).toString("base64");
const unpack = (s: string) => {
  const b = Buffer.from(s, "base64");
  return Float32Array.from(new Int8Array(b.buffer, b.byteOffset, b.length), (x) => x / 127);
};

/** The text that represents an article: title and summary, in its own language. */
const passage = (a: Article) => `passage: ${a.title}. ${a.abstract}`.slice(0, 1500);

export async function embedQueries(texts: string[]): Promise<Float32Array[]> {
  const pipe = await model();
  const out = await pipe(
    texts.map((t) => `query: ${t}`),
    { pooling: "mean", normalize: true },
  );
  return out.tolist().map((v) => Float32Array.from(v));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

export class SemanticIndex {
  private doc = new JsonDoc<Record<string, string>>("embeddings.json", {});
  private cache = new Map<string, Float32Array>();
  private running = false;

  get state() {
    return state;
  }

  get size() {
    return Object.keys(this.doc.data).length;
  }

  get(id: string): Float32Array | undefined {
    let v = this.cache.get(id);
    if (!v && this.doc.data[id]) {
      v = unpack(this.doc.data[id]);
      this.cache.set(id, v);
    }
    return v;
  }

  /** Embed the articles that have no vector yet, newest first, in the background. */
  async indexMissing(articles: Article[]) {
    if (this.running) return;
    this.running = true;
    try {
      const todo = articles
        .filter((a) => !this.doc.data[a.id])
        .sort((x, y) => Date.parse(y.fetchedAt) - Date.parse(x.fetchedAt));
      const pipe = await model();
      for (let i = 0; i < todo.length; i += 16) {
        const batch = todo.slice(i, i + 16);
        const out = await pipe(batch.map(passage), { pooling: "mean", normalize: true });
        out.tolist().forEach((v, k) => (this.doc.data[batch[k].id] = pack(v)));
        this.doc.save();
        // Leave the processor to the rest of the app between batches.
        await new Promise((r) => setTimeout(r, 20));
      }
    } catch {
      /* model unavailable: words-only recommendations until next time */
    } finally {
      this.running = false;
    }
  }

  /** Forget the vectors of articles that left the library. */
  prune(keep: Set<string>) {
    let changed = false;
    for (const id of Object.keys(this.doc.data)) {
      if (keep.has(id)) continue;
      delete this.doc.data[id];
      this.cache.delete(id);
      changed = true;
    }
    if (changed) this.doc.save();
  }

  flush() {
    this.doc.flush();
  }
}
