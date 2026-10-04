// Screenshot of the running app at a fixed size, for the website and the README.
// Usage: node scripts/shot.mjs <out.webp> [width] [height] [scale]   (app started with
// --remote-debugging-port, CDP_PORT=… if not 9555)
import fs from "node:fs";
import WebSocket from "ws";

const [, , out, w = "1440", h = "900", scale = "2"] = process.argv;
const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? 9555}/json`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const j = JSON.parse(m);
  if (j.id && pending.has(j.id)) pending.get(j.id)(j);
});
await new Promise((r) => ws.on("open", r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: +scale, mobile: false });
await new Promise((r) => setTimeout(r, 900));
const r = await send("Page.captureScreenshot", { format: out.endsWith(".png") ? "png" : "webp", quality: 88 });
fs.writeFileSync(out, Buffer.from(r.result.data, "base64"));
await send("Emulation.clearDeviceMetricsOverride");
console.log("saved", out);
ws.close();
