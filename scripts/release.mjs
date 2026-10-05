// Starts a release: tags the current commit with the version of package.json and
// pushes the tag. GitHub Actions (.github/workflows/release.yml) then builds the
// Windows and Linux versions and publishes them; installed apps offer the update.
// Usage: change "version" in package.json, commit, then `npm run release`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tag = `v${version}`;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain", "--untracked-files=no")) {
  console.error("Des changements ne sont pas commités : commite-les avant de publier.");
  process.exit(1);
}
if (git("tag", "--list", tag)) {
  console.error(`L'étiquette ${tag} existe déjà : augmente "version" dans package.json.`);
  process.exit(1);
}

git("push", "origin", "HEAD");
git("tag", tag);
git("push", "origin", tag);
console.log(`Étiquette ${tag} poussée. GitHub construit Windows et Linux : suis l'avancement avec « gh run watch ».`);
