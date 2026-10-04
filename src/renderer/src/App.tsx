import type React from "react";
import { BookMarked, Moon, PenLine, Settings2, Sparkles, Sun, UserRound } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { RefreshProgress, Settings } from "@shared/types";
import { api } from "./api";
import iconUrl from "./assets/icon.png";
import { Feed } from "./views/Feed";
import { Library } from "./views/Library";
import { Profile } from "./views/Profile";
import { Reader } from "./views/Reader";
import { SettingsView } from "./views/Settings";
import { Writing } from "./views/Writing";

export type Route =
  | { view: "feed" }
  | { view: "library" }
  | { view: "writing"; articleId?: string }
  | { view: "profile" }
  | { view: "settings" }
  | { view: "reader"; articleId: string; from: Route };

interface Ctx {
  go: (r: Route) => void;
  toast: (msg: string) => void;
  settings: Settings | null;
  reloadSettings: () => Promise<void>;
  refresh: RefreshProgress | null;
}

export const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function App() {
  const [route, setRoute] = useState<Route>({ view: "feed" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshProgress | null>(null);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const now = useClock();

  const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), []);
  useEffect(() => {
    void reloadSettings();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    const off = api.on("refresh-progress", setRefresh);
    return () => {
      mq.removeEventListener("change", onChange);
      off();
    };
  }, [reloadSettings]);

  const theme = settings?.theme ?? "system";
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    void api.setTitleBarTheme(dark);
  }, [dark]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3500);
  }, []);

  const go = useCallback((r: Route) => setRoute(r), []);
  // Each screen starts at the top; the reader restores its own position afterwards.
  useLayoutEffect(() => {
    const el = document.getElementById("main-scroll");
    if (el) el.scrollTop = 0;
  }, [route]);

  const toggleTheme = async () => {
    setSettings(await api.saveSettings({ theme: dark ? "light" : "dark" }));
  };

  const nav: { id: Route["view"]; label: string; icon: React.ReactNode }[] = [
    { id: "feed", label: "Pour toi", icon: <Sparkles size={16} /> },
    { id: "library", label: "Bibliothèque", icon: <BookMarked size={16} /> },
    { id: "writing", label: "Mes articles", icon: <PenLine size={16} /> },
    { id: "profile", label: "Mes goûts", icon: <UserRound size={16} /> },
  ];
  const active = route.view === "reader" ? route.from.view : route.view;

  return (
    <AppCtx.Provider value={{ go, toast, settings, reloadSettings, refresh }}>
      <div className="app">
        <div className="dots" />
        <header className="titlebar">
          <div className="brand">
            <img src={iconUrl} alt="" />
            <strong>Veille</strong>
            <span>· {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
          </div>
          <nav className="nav" aria-label="Navigation principale">
            {nav.map((n) => (
              <button key={n.id} className={`toggle ${active === n.id ? "active" : ""}`} onClick={() => go({ view: n.id } as Route)}>
                {n.icon}
                <span>{n.label}</span>
              </button>
            ))}
            <div className="sep" />
            <button
              className={`toggle icon ${active === "settings" ? "active" : ""}`}
              onClick={() => go({ view: "settings" })}
              title="Réglages"
              aria-label="Réglages"
            >
              <Settings2 size={16} />
            </button>
            <button className="toggle icon" onClick={toggleTheme} title="Changer de thème" aria-label="Changer de thème">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </nav>
          <div className="right">{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
        </header>
        <main className="main" id="main-scroll">
          {route.view === "feed" && <Feed />}
          {route.view === "library" && <Library />}
          {route.view === "writing" && <Writing articleId={route.articleId} />}
          {route.view === "profile" && <Profile />}
          {route.view === "settings" && <SettingsView />}
          {route.view === "reader" && <Reader key={route.articleId} id={route.articleId} back={route.from} />}
        </main>
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
