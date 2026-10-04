import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from "electron";
import path from "node:path";
import type { DomainId, Draft, Interaction, Settings } from "@shared/types";
import { claudeCodeAvailable } from "./ai/claudeCode";
import { adviseLocalModel, detectHardware } from "./ai/hardware";
import { ollamaModels, ollamaReachable, testAi } from "./ai/llm";
import { flushExplanations, flushMemory } from "./ai/memory";
import { BROWSER_UA, get } from "./http";
import { Library } from "./library";
import { geminiKey, getSettings, getUsage, saveSettings } from "./settings";

app.setAppUserModelId("com.hantan.veille");
app.userAgentFallback = BROWSER_UA;

protocol.registerSchemesAsPrivileged([
  { scheme: "veille", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

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
    title: "Veille Scientifique",
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
    const hours = getSettings().refreshHours || 3;
    const last = lib.lastRefresh ? Date.parse(lib.lastRefresh) : 0;
    if (Date.now() - last > hours * 3600000) void lib.refresh();
  };
  setTimeout(check, 2500);
  setInterval(check, 15 * 60 * 1000);
}

function registerIpc() {
  ipcMain.handle("getFeed", (_e, o: { domain?: string; limit?: number; offset?: number; fresh?: boolean }) =>
    lib.feed(o?.domain ?? "all", o?.limit ?? 30, o?.offset ?? 0, o?.fresh ?? (o?.offset ?? 0) === 0),
  );
  ipcMain.handle("fieldCounts", () => lib.fieldCounts());
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
  ipcMain.handle("translateTeasers", (_e, ids: string[]) => {
    void lib.queueTeasers(ids);
  });
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
  ipcMain.handle("getProfile", () => lib.reco.view());
  ipcMain.handle("resetProfile", () => {
    lib.reco.reset();
    send("feed-updated");
  });
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

/** veille://pdf/<url> streams a remote PDF inline so the built-in viewer can show it. */
function registerProtocol() {
  protocol.handle("veille", async (req) => {
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
