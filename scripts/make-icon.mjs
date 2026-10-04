import fs from "node:fs";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const svg = fs.readFileSync("resources/icon.svg");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()));
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile("resources/icon.png");
fs.mkdirSync("build", { recursive: true });
fs.copyFileSync("resources/icon.png", "build/icon.png");
fs.writeFileSync("build/icon.ico", await pngToIco(pngs));
fs.mkdirSync("src/renderer/src/assets", { recursive: true });
fs.copyFileSync("resources/icon.png", "src/renderer/src/assets/icon.png");
console.log("icons written");
