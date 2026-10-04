import { FETCHERS } from "../src/main/sources/index";
import { pdfToBlocks } from "../src/main/content/pdf";
import { getBuffer } from "../src/main/http";
const only = process.argv[2];
if (only === "pdf") {
  const b = await pdfToBlocks(await getBuffer("https://arxiv.org/pdf/2610.02204", { browser: true }));
  console.log(b.length, b.slice(0, 8).map((x: any) => x.t + ": " + x.segs[0].slice(0, 120)).join("\n"));
} else {
  for (const [name, f] of Object.entries(FETCHERS)) {
    if (only && name !== only) continue;
    const t = Date.now();
    try {
      const r = await f({});
      const dom: Record<string, number> = {};
      for (const a of r) dom[a.domain] = (dom[a.domain] ?? 0) + 1;
      console.log(name.padEnd(16), String(r.length).padStart(4), `${Date.now() - t}ms`, JSON.stringify(dom), "|", r[0]?.title.slice(0, 60), "|", r[0]?.published);
    } catch (e: any) {
      console.log(name.padEnd(16), "ERROR", e.message);
    }
  }
}
