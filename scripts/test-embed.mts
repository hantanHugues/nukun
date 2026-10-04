// Cross-lingual check of the local embedding model (meaning, not words).
import { env, pipeline } from "@huggingface/transformers";
env.cacheDir = `${process.env.TEMP}/nukun-models`;
const t0 = Date.now();
const embed = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" });
console.log("modèle chargé en", Date.now() - t0, "ms");
const texts = [
  "query: emotion regulation and anxiety",
  "passage: Emotion regulation strategies predict anxiety symptoms in adolescents.",
  "passage: La régulation émotionnelle prédit les symptômes anxieux chez les adolescents.",
  "passage: 感情調節は青年期の不安症状を予測する。",
  "passage: Deep learning for robot grasping in cluttered scenes.",
  "passage: 韓国語教科書における助詞の用法について",
];
const t1 = Date.now();
const out = await embed(texts, { pooling: "mean", normalize: true });
console.log("6 textes en", Date.now() - t1, "ms, dimension", out.dims);
const v = out.tolist() as number[][];
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
for (let i = 1; i < texts.length; i++) console.log(cos(v[0], v[i]).toFixed(3), texts[i].slice(9, 70));
