import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSettings, recordClaudeCodeCall } from "../settings";
import type { JsonRequest } from "./llm";

/**
 * Uses the Claude Code CLI installed on this PC, signed in with the user's own Claude
 * subscription: no API key and no extra cost, but it shares the subscription's usage
 * limits. For the user's personal use only.
 */

function findExecutable(): string | null {
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", exe),
    path.join(home, ".local", "bin", exe),
    path.join(home, ".claude", "local", exe),
    // Any other install that put Claude Code on the PATH.
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, exe)),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function claudeCodeAvailable() {
  return findExecutable() !== null;
}

export async function claudeCodeJson<T>(req: JsonRequest): Promise<T> {
  const exe = findExecutable();
  if (!exe) throw new Error("Claude Code n'est pas installé sur ce PC.");
  // An empty working folder, no tools, no MCP servers, no settings: a plain text request.
  const cwd = path.join(os.tmpdir(), "veille-claude-code");
  fs.mkdirSync(cwd, { recursive: true });
  // A figure is handed over as a file Claude Code may read, and nothing else.
  let prompt = req.user;
  if (req.image) {
    const ext = req.image.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = path.join(cwd, `figure.${ext}`);
    fs.writeFileSync(file, req.image.data);
    prompt = `${req.user}

L'image de la figure est le fichier « ${file} » : ouvre-la avec l'outil Read avant de répondre.`;
  }
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(req.schema),
    "--system-prompt", req.system,
    "--model", getSettings().claudeCodeModel || "opus",
    "--effort", "low",
    "--tools", req.image ? "Read" : "",
    // Print mode cannot ask for permission: reading the figure is allowed up front.
    ...(req.image ? ["--allowedTools", "Read"] : []),
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.trim()) resolve(stdout);
      else reject(new Error(`Claude Code s'est arrêté (code ${code}) : ${stderr.slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
  recordClaudeCodeCall();
  const j = JSON.parse(out);
  if (j.is_error) {
    const msg = String(j.result ?? j.subtype ?? "erreur inconnue");
    if (j.api_error_status === 429) throw new Error(`Limite de ton abonnement Claude atteinte : ${msg}`);
    throw new Error(`Claude Code : ${msg}`);
  }
  if (j.structured_output) return j.structured_output as T;
  return JSON.parse(j.result) as T;
}
