// Builds candidate app icons from open-source Lucide glyphs (ISC) on the portfolio's tile style.
import fs from "node:fs";
import sharp from "sharp";
const names = process.argv.slice(2);
const tile = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="112" fill="#0A0A0A"/>
  <rect x="17" y="17" width="478" height="478" rx="111" fill="none" stroke="#FFFFFF" stroke-opacity="0.1" stroke-width="2"/>
  <g transform="translate(106 106) scale(12.5)" fill="none" stroke="#17C0FD" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
</svg>`;
const out = [];
for (const n of names) {
  const svg = fs.readFileSync(`node_modules/lucide-static/icons/${n}.svg`, "utf8");
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const full = tile(inner);
  fs.writeFileSync(`resources/candidates/${n}.svg`, full);
  out.push({ n, buf: await sharp(Buffer.from(full), { density: 300 }).resize(220, 220).png().toBuffer() });
}
const W = 260 * out.length;
const labels = out.map((o, i) => `<text x="${i * 260 + 130}" y="262" font-family="Segoe UI" font-size="18" fill="#ededed" text-anchor="middle">${i + 1}. ${o.n}</text>`).join("");
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="280"><rect width="100%" height="100%" fill="#1b1b1b"/>${labels}</svg>`);
await sharp(bg).composite(out.map((o, i) => ({ input: o.buf, left: i * 260 + 20, top: 10 }))).png().toFile("resources/candidates/sheet.png");
console.log("ok");
