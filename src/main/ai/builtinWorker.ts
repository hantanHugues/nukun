import { parentPort, workerData } from "node:worker_threads";

/**
 * The built-in translator's own thread: the model lives and works here, so the app's
 * window never waits for it. One processor thread only, so the PC stays comfortable.
 */

interface Job {
  id: number;
  model: string;
  texts: string[];
  opts?: { src_lang?: string; tgt_lang?: string };
}

type Translator = (text: string, o: object) => Promise<{ translation_text: string }[]>;

let current: { model: string; pipe: Translator & { dispose?: () => Promise<void> } } | null = null;

async function load(model: string) {
  if (current?.model === model) return current.pipe;
  if (current) {
    await current.pipe.dispose?.().catch(() => undefined);
    current = null;
  }
  const { env, pipeline } = await import("@huggingface/transformers");
  // Only the files downloaded with the user's consent: the worker never reaches the network.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = workerData.dir as string;
  const pipe = (await pipeline("translation", model, {
    dtype: "q8",
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  })) as unknown as NonNullable<typeof current>["pipe"];
  current = { model, pipe };
  return pipe;
}

parentPort!.on("message", async (job: Job) => {
  try {
    const pipe = await load(job.model);
    const out: string[] = [];
    for (const text of job.texts) {
      const r = await pipe(text, { max_new_tokens: 512, ...(job.opts ?? {}) });
      out.push(r[0]?.translation_text ?? "");
      // Let the processor breathe between two sentences.
      await new Promise((res) => setTimeout(res, 5));
    }
    parentPort!.postMessage({ id: job.id, out });
  } catch (e) {
    parentPort!.postMessage({ id: job.id, error: e instanceof Error ? e.message : String(e) });
  }
});
