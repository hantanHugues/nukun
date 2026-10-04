import { contextBridge, ipcRenderer } from "electron";

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const methods = [
  "getFeed", "fieldCounts", "getLibrary", "getArticle", "loadContent", "translate", "translateVisible", "chat", "explainFigure", "setInterests", "searchTopics", "suggestion", "dismissSuggestion", "clearChat", "aiStatus", "explain", "interact", "saveScroll", "refresh",
  "prepareCards", "getSettings", "saveSettings", "testAi", "ollamaModels", "getUsage", "getSourceStatus",
  "getProfile", "resetProfile", "analyzeInterests", "getNotes", "saveNote", "deleteNote", "noteCounts", "getDraft", "listDrafts", "saveDraft", "exportDraft", "chooseDir",
  "openExternal", "setTitleBarTheme",
];

const api: Record<string, unknown> = Object.fromEntries(methods.map((m) => [m, invoke(m)]));
api.on = (channel: string, cb: (payload: unknown) => void) => {
  const listener = (_e: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("nukun", api);
