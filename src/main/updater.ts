import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "@shared/types";
import { getSettings } from "./settings";

/**
 * Updates without reinstalling: the app looks for a newer version among the
 * releases of its GitHub repository (at launch, then every 6 hours), downloads only
 * what changed in the background, and offers to restart once it is ready. Nothing
 * is installed without the reader's click: until then the offer comes back at each
 * launch.
 * With data saving on, nothing is downloaded until the reader asks for it.
 */

let state: UpdateState = { status: "idle" };
let send: (s: UpdateState) => void = () => {};

const set = (s: UpdateState) => {
  state = s;
  send(s);
};

export function startUpdates(notify: (s: UpdateState) => void) {
  send = notify;
  // A local server can stand in for GitHub, to test updates.
  const testUrl = process.env.NUKUN_UPDATE_URL;
  if (testUrl) autoUpdater.setFeedURL({ provider: "generic", url: testUrl });
  // Only the installed app updates itself (not the development version).
  else if (!app.isPackaged || process.env.NUKUN_PROFILE) return;

  // What happened, in "updates.log" next to the app's data (kept short).
  const logFile = path.join(app.getPath("userData"), "updates.log");
  const log = (level: string) => (...m: unknown[]) => {
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200_000) fs.rmSync(logFile);
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${m.map(String).join(" ")}
`);
    } catch {
      /* logging must never break updates */
    }
  };
  autoUpdater.logger = { info: log("info"), warn: log("warn"), error: log("error"), debug: () => {} };

  autoUpdater.autoDownload = false; // decided below, depending on data saving
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("update-available", (info) => {
    if (getSettings().dataSaver) set({ status: "available", version: info.version });
    else download(info.version);
  });
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", version: state.version, percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
  // No connection, GitHub unreachable…: try again at the next check, quietly.
  autoUpdater.on("error", () => {
    if (state.status === "downloading") set({ status: "available", version: state.version });
  });

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 6 * 3600000);
}

function download(version?: string) {
  set({ status: "downloading", version, percent: 0 });
  autoUpdater.downloadUpdate().catch((e) => {
    autoUpdater.logger?.error(`téléchargement impossible : ${e instanceof Error ? e.message : e}`);
    set({ status: "available", version });
  });
}

export const updateState = () => state;

/** The reader asked for it (data saving on). */
export function downloadUpdate() {
  if (state.status === "available") download(state.version);
}

/** Restart on the new version, without the installer's pages. */
export function installUpdate() {
  if (state.status === "ready") autoUpdater.quitAndInstall(true, true);
}
