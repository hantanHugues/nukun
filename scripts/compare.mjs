// Translates one article with several AI providers through the running app (DevTools port 9333)
// and saves each result, so translations can be compared side by side.
// Usage: node scripts/compare.mjs <articleId> <outDir> <provider:model> [...]
//   e.g. node scripts/compare.mjs "doi:10.1371/..." out ollama:mistral-nemo claude-code:opus
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const [, , articleId, outDir, ...runs] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const j = JSON.parse(m);
  if (j.id && pending.has(j.id)) pending.get(j.id)(j);
});
await new Promise((r) => ws.on("open", r));
const evaluate = (expression) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, (j) => r(j.result?.result?.value ?? j.result));
    ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });

for (const run of runs) {
  const cut = run.indexOf(":");
  const provider = cut < 0 ? run : run.slice(0, cut);
  const model = cut < 0 ? "" : run.slice(cut + 1);
  const patch =
    provider === "ollama" || provider === "hybrid"
      ? { provider, ollamaModel: model, claudeCodeModel: "opus" }
      : provider === "claude-code"
        ? { provider, claudeCodeModel: model }
        : { provider };
  const started = Date.now();
  const result = await evaluate(`(async () => {
    await veille.saveSettings(${JSON.stringify(patch)});
    const id = ${JSON.stringify(articleId)};
    const done = new Promise((resolve) => {
      const off = veille.on("translation-progress", (p) => {
        if (p.id === id && p.finished) { off(); resolve(p); }
      });
    });
    await veille.translate(id, true);
    const p = await done;
    const c = await veille.loadContent(id);
    return { error: p.error ?? null, content: c };
  })()`);
  const seconds = Math.round((Date.now() - started) / 1000);
  const file = path.join(outDir, `${run.replace(/[:/]/g, "_")}.json`);
  fs.writeFileSync(file, JSON.stringify({ run, seconds, ...result }, null, 1));
  const segs = Object.values(result.content?.tr ?? {}).flat().filter(Boolean).length;
  console.log(`${run}: ${seconds}s, ${segs} segments traduits, glossaire ${result.content?.glossary?.length ?? 0}, par ${result.content?.translatedBy}, erreur: ${result.error}`);
}
ws.close();
