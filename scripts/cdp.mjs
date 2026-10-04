// Tiny Chrome DevTools Protocol client used to inspect the running app during development.
import fs from "node:fs";
import WebSocket from "ws";
const [, , cmd, arg, out] = process.argv;
const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
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
if (cmd === "shot") {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  console.log("saved", arg);
} else if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1)?.slice(0, 6000));
}
ws.close();
