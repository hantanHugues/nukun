// Publishes the installer built by `npm run dist` as a GitHub release, from which
// installed apps update themselves. Usage: change "version" in package.json, then
// `npm run release`. Needs the GitHub CLI (gh), signed in.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const files = [
  `release/Nukun-Setup-${version}.exe`,
  `release/Nukun-Setup-${version}.exe.blockmap`,
  // What installed apps read to learn that a new version exists.
  "release/latest.yml",
];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`Fichier manquant : ${f}. Lance d'abord « npm run dist ».`);
    process.exit(1);
  }
}

const tag = `v${version}`;
try {
  execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
  console.error(`La version ${tag} existe déjà sur GitHub : augmente "version" dans package.json.`);
  process.exit(1);
} catch {
  /* not released yet: go on */
}

execFileSync("gh", ["release", "create", tag, ...files, "--title", `Nùkún ${version}`, "--generate-notes"], { stdio: "inherit" });
console.log(`Version ${version} publiée : les apps installées la proposeront à leur prochaine vérification.`);
