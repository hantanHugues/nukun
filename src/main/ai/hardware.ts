import { execFile } from "node:child_process";
import os from "node:os";
import { t } from "@shared/i18n";

/**
 * Detects the graphics card and its memory, to suggest the best local model this PC
 * can run fully on the GPU (a model that spills onto the CPU becomes several times slower).
 */
export interface Hardware {
  gpu: string;
  vramGb: number; // 0 when unknown
  ramGb: number;
}

export interface LocalModelAdvice {
  model: string;
  sizeGb: number;
  why: string;
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });

let cached: Hardware | null = null;

export async function detectHardware(): Promise<Hardware> {
  if (cached) return cached;
  const ramGb = Math.round(os.totalmem() / 1024 ** 3);
  // NVIDIA: exact figures from the driver.
  const nv = await run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  const line = nv.trim().split("\n")[0];
  if (line) {
    const [name, mib] = line.split(",").map((s) => s.trim());
    cached = { gpu: name, vramGb: Math.round(Number(mib) / 1024), ramGb };
    return cached;
  }
  // Other cards on Windows: the 64-bit memory size the driver writes in the registry.
  if (process.platform === "win32") {
    const ps = await run("powershell", [
      "-NoProfile",
      "-Command",
      "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { \"$($_.DriverDesc)|$($_.'HardwareInformation.qwMemorySize')\" }",
    ]);
    const best = ps
      .trim()
      .split("\n")
      .map((l) => l.trim().split("|"))
      .filter((p) => p.length === 2)
      .map(([name, bytes]) => ({ name, gb: Math.round(Number(bytes) / 1024 ** 3) }))
      .sort((a, b) => b.gb - a.gb)[0];
    if (best) {
      cached = { gpu: best.name, vramGb: best.gb, ramGb };
      return cached;
    }
  }
  cached = { gpu: "Carte graphique inconnue", vramGb: 0, ramGb };
  return cached;
}

/**
 * The largest translation-capable model that fits in video memory with its working
 * memory (about 1 GB). Only aya-expanse:8b was measured in this app (on a 8 GB card);
 * the others are suggestions by size.
 */
export function adviseLocalModel(hw: Hardware): LocalModelAdvice {
  const v = hw.vramGb;
  if (v >= 24) return { model: "aya-expanse:32b", sizeGb: 20, why: t("Aya Expanse 32B : la version complète du modèle de traduction, bien plus précise.") };
  if (v >= 18) return { model: "gemma3:27b", sizeGb: 17, why: t("Gemma 3 27B (Google) : très bon en français, tient dans ta carte.") };
  if (v >= 10) return { model: "gemma3:12b", sizeGb: 8.1, why: t("Gemma 3 12B (Google) : bon en français, tient dans ta carte.") };
  if (v >= 6) return { model: "aya-expanse:8b", sizeGb: 5.1, why: t("Aya Expanse 8B : spécialisé en traduction, testé dans l'app sur une carte de 8 Go.") };
  return {
    model: "gemma3:4b",
    sizeGb: 3.3,
    why: v
      ? "Gemma 3 4B : petit modèle pour les cartes modestes. Qualité limitée : mieux vaut compter sur Google et Claude."
      : "Mémoire graphique inconnue : Gemma 3 4B est le choix prudent.",
  };
}
