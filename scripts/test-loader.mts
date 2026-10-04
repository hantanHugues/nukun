import { loadFullText } from "../src/main/content/loader";
const cases: any[] = [
  { name: "arxiv", fullText: { kind: "arxiv", arxivId: "2610.02204" } },
  { name: "pmc", fullText: { kind: "pmc", pmcid: "PMC13583138" } },
  { name: "biorxiv", url: "https://www.biorxiv.org/content/10.64898/2026.09.24.754142v1", fullText: { kind: "jats", url: "https://www.biorxiv.org/content/early/2026/09/28/2026.09.24.754142.source.xml", imageBase: "https://www.biorxiv.org/content/biorxiv/early/2026/09/28/2026.09.24.754142", imageMode: "biorxiv" } },
  { name: "plos", url: "x", fullText: { kind: "jats", url: "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0296944&type=manuscript", imageBase: "https://journals.plos.org/plosone/article/figure/image?size=large&id=", imageMode: "plos" } },
  { name: "elife", url: "x", fullText: { kind: "jats", url: "", imageMode: "elife", articleId: "110887" } },
  { name: "nature", fullText: { kind: "html", url: "https://www.nature.com/articles/s41598-026-71346-z", mode: "nature" } },
];
const only = process.argv[2];
for (const c of cases) {
  if (only && c.name !== only) continue;
  const t = Date.now();
  try {
    const r = await loadFullText({ abstract: "", url: c.url ?? "", ...c } as any);
    const count: Record<string, number> = {};
    for (const b of r.blocks) count[b.t] = (count[b.t] ?? 0) + 1;
    const figs = r.blocks.filter((b: any) => b.t === "fig");
    console.log(c.name, Date.now() - t, "ms", JSON.stringify(count), "| fig0:", (figs[0] as any)?.src?.[0], "| cap:", (figs[0] as any)?.segs?.[0]?.slice(0, 80));
    const p = r.blocks.find((b: any) => b.t === "p" && b.segs[0].length > 200) as any;
    console.log("   p:", p?.segs[0].slice(0, 220));
    console.log("   h:", r.blocks.filter((b: any) => b.t === "h").slice(0, 6).map((b: any) => b.segs[0].replace(/<[^>]+>/g, "")).join(" | "));
  } catch (e: any) {
    console.log(c.name, "ERROR", e.message);
  }
}
