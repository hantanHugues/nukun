import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DomainId, Draft, Interaction, Interest, Settings } from "@shared/types";
import { claudeCodeAvailable } from "./ai/claudeCode";
import { adviseLocalModel, detectHardware } from "./ai/hardware";
import { ollamaModels, ollamaReachable, testAi } from "./ai/llm";
import { flushExplanations, flushMemory } from "./ai/memory";
import { BROWSER_UA, get } from "./http";
import { Library } from "./library";
import { geminiKey, getSettings, getUsage, saveSettings } from "./settings";

app.setAppUserModelId("com.hantan.nukun");
app.userAgentFallback = BROWSER_UA;

protocol.registerSchemesAsPrivileged([
  { scheme: "nukun", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Test profiles: NUKUN_PROFILE=<name> keeps a separate data folder, to try the app
// with other interests without touching the real one.
if (process.env.NUKUN_PROFILE) {
  app.setPath("userData", path.join(app.getPath("appData"), `Nukun-${process.env.NUKUN_PROFILE}`));
}

/**
 * The app was called "Veille Scientifique": bring its data along on first launch.
 * Runs before Chromium starts, so that its "Local State" (which holds the key that
 * encrypts the saved API keys) is used instead of a new one.
 */
function migrateOldData() {
  // Test profiles start empty, unless NUKUN_MIGRATE=1 (to test this migration).
  if (process.env.NUKUN_PROFILE && process.env.NUKUN_MIGRATE !== "1") return;
  const oldDir = path.join(app.getPath("appData"), "Veille Scientifique");
  const newDir = app.getPath("userData");
  if (fs.existsSync(path.join(newDir, "articles.json")) || !fs.existsSync(path.join(oldDir, "articles.json"))) return;
  fs.mkdirSync(newDir, { recursive: true });
  for (const f of fs.readdirSync(oldDir)) {
    // Our own files only (JSON documents and parsed articles), not Chromium's caches.
    if (f.endsWith(".json") || f === "Local State") fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
  }
  const content = path.join(oldDir, "content");
  if (fs.existsSync(content)) fs.cpSync(content, path.join(newDir, "content"), { recursive: true });
}
migrateOldData();

let win: BrowserWindow | null = null;
let lib: Library;

const send = (channel: string, payload?: unknown) => win?.webContents.send(channel, payload);

function overlayColors(dark: boolean) {
  return dark ? { color: "#0a0a0a", symbolColor: "#ededed", height: 48 } : { color: "#f9f9f9", symbolColor: "#151515", height: 48 };
}

function createWindow() {
  const s = getSettings();
  const dark = s.theme === "dark" || (s.theme === "system" && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Nùkún",
    backgroundColor: dark ? "#0a0a0a" : "#f9f9f9",
    titleBarStyle: "hidden",
    titleBarOverlay: overlayColors(dark),
    icon: path.join(__dirname, "../../resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      plugins: true, // built-in PDF viewer for "original" mode
    },
  });
  win.once("ready-to-show", () => win?.show());
  // Links in articles open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file:")) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function scheduleRefresh() {
  const check = () => {
    // Nothing is fetched before the reader has chosen their interests.
    if (!getSettings().interestsChosen) return;
    const hours = getSettings().refreshHours || 3;
    const last = lib.lastRefresh ? Date.parse(lib.lastRefresh) : 0;
    if (Date.now() - last > hours * 3600000) void lib.refresh();
  };
  setTimeout(check, 2500);
  setInterval(check, 15 * 60 * 1000);
}

function registerIpc() {
  ipcMain.handle(
    "getFeed",
    (_e, o: { domain?: string; limit?: number; offset?: number; fresh?: boolean; kind?: "paper" | "news" }) =>
      lib.feed(o?.domain ?? "all", o?.limit ?? 30, o?.offset ?? 0, o?.fresh ?? (o?.offset ?? 0) === 0, o?.kind ?? "paper"),
  );
  ipcMain.handle("fieldCounts", (_e, kind?: "paper" | "news") => lib.interestCounts(kind));
  ipcMain.handle("setInterests", (_e, interests: Interest[], languages: Record<string, boolean>) =>
    lib.setInterests(interests, languages),
  );
  ipcMain.handle("searchTopics", (_e, q: string) => lib.searchTopics(q));
  ipcMain.handle("suggestion", () => lib.suggestion());
  ipcMain.handle("dismissSuggestion", (_e, id: string) => lib.dismissSuggestion(id));
  ipcMain.handle("getLibrary", () => lib.libraryList());
  ipcMain.handle("getArticle", (_e, id: string) => lib.get(id));
  ipcMain.handle("loadContent", (_e, id: string) => lib.loadContent(id));
  ipcMain.handle("translate", (_e, id: string, force?: boolean) => {
    void lib.translate(id, force);
  });
  ipcMain.handle("translateVisible", (_e, id: string, keys: string[]) => {
    lib.translateVisible(id, keys);
  });
  ipcMain.handle("chat", (_e, id: string, q: string) => lib.chat(id, q));
  ipcMain.handle("explainFigure", (_e, id: string, block: number) => lib.explainFigure(id, block));
  ipcMain.handle("clearChat", (_e, id: string) => lib.clearChat(id));
  ipcMain.handle("aiStatus", async () => {
    const hw = await detectHardware();
    return {
      gemini: !!geminiKey(),
      claudeCode: claudeCodeAvailable(),
      ollama: await ollamaReachable(),
      ollamaModels: await ollamaModels(),
      gpu: hw.gpu,
      vramGb: hw.vramGb,
      advice: adviseLocalModel(hw),
    };
  });
  ipcMain.handle("explain", (_e, id: string, text: string) => lib.explain(id, text));
  ipcMain.handle("interact", (_e, i: Interaction) => lib.interact(i));
  ipcMain.handle("saveScroll", (_e, id: string, r: number) => lib.saveScroll(id, r));
  ipcMain.handle("refresh", () => {
    void lib.refresh();
  });
  ipcMain.handle("prepareCards", (_e, ids: string[]) => lib.prepareCards(ids));
  ipcMain.handle("getSettings", () => getSettings());
  ipcMain.handle("saveSettings", (_e, s: Partial<Settings> & { claudeKey?: string }) => {
    const res = saveSettings(s);
    send("feed-updated");
    return res;
  });
  ipcMain.handle("testAi", () => testAi());
  ipcMain.handle("ollamaModels", () => ollamaModels());
  ipcMain.handle("getUsage", () => getUsage());
  ipcMain.handle("getSourceStatus", () => lib.sourceStatus());
  ipcMain.handle("getProfile", () => lib.profileView());
  ipcMain.handle("resetProfile", () => lib.resetProfile());
  ipcMain.handle("analyzeInterests", () => lib.analyzeInterests());
  ipcMain.handle("getDraft", (_e, id: string) => lib.getDraft(id));
  ipcMain.handle("listDrafts", () => lib.listDrafts());
  ipcMain.handle("saveDraft", (_e, d: Draft) => lib.saveDraft(d));
  ipcMain.handle("exportDraft", (_e, id: string) => lib.exportDraft(id));
  ipcMain.handle("chooseDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? undefined : r.filePaths[0];
  });
  ipcMain.handle("openExternal", (_e, url: string) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle("setTitleBarTheme", (_e, dark: boolean) => {
    win?.setTitleBarOverlay(overlayColors(dark));
    win?.setBackgroundColor(dark ? "#0a0a0a" : "#f9f9f9");
  });
}

/** nukun://pdf/<url> streams a remote PDF inline so the built-in viewer can show it. */
function registerProtocol() {
  protocol.handle("nukun", async (req) => {
    const u = new URL(req.url);
    if (u.hostname === "pdf") {
      const target = decodeURIComponent(u.pathname.slice(1));
      if (!/^https:\/\//.test(target)) return new Response("bad url", { status: 400 });
      try {
        const res = await get(target, { browser: true, timeoutMs: 60000 });
        return new Response(res.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" } });
      } catch (e) {
        return new Response(`PDF indisponible : ${e instanceof Error ? e.message : e}`, { status: 502 });
      }
    }
    return new Response("not found", { status: 404 });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    lib = new Library({
      refresh: (p) => send("refresh-progress", p),
      translation: (p) => send("translation-progress", p),
      feedUpdated: () => send("feed-updated"),
    });
    registerProtocol();
    registerIpc();
    createWindow();
    scheduleRefresh();
    // Meaning of the articles not analysed yet (first launch: downloads the model once).
    setTimeout(() => lib.indexMeaning(), 5000);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    lib?.flush();
    flushMemory();
    flushExplanations();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
