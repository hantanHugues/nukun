// Which interests each news post of a profile goes to (read-only).
import fs from "node:fs";
import { matchesInterest } from "../src/shared/interests";
const dir = `${process.env.APPDATA}/Nukun-${process.argv[2]}`;
const s = JSON.parse(fs.readFileSync(`${dir}/settings.json`, "utf8"));
const arts = Object.values(JSON.parse(fs.readFileSync(`${dir}/articles.json`, "utf8"))) as any[];
for (const a of arts.filter((a) => a.kind === "news"))
  console.log(s.interests.filter((i: any) => matchesInterest(i, a)).map((i: any) => i.id).join(",") || "-", "|", a.venue, "|", a.title.slice(0, 70));
