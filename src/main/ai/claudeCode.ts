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
  const candidates = [
    path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    path.join(home, ".local", "bin", "claude.exe"),
    path.join(home, ".claude", "local", "claude.exe"),
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
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(req.schema),
    "--system-prompt", req.system,
    "--model", getSettings().claudeCodeModel || "opus",
    "--effort", "low",
    "--tools", "",
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
    child.stdin.end(req.user);
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
