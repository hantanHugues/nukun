import type React from "react";
import { BookMarked, Moon, Newspaper, PenLine, Settings2, Sparkles, Sun, UserRound } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { RefreshProgress, Settings } from "@shared/types";
import { locale, setLang, t } from "@shared/i18n";
import { api } from "./api";
import iconUrl from "./assets/icon.png";
import { Welcome } from "./components/Interests";
import { Tour } from "./components/Tour";
import { UpdateToast } from "./components/UpdateToast";
import { Feed } from "./views/Feed";
import { Library } from "./views/Library";
import { Profile } from "./views/Profile";
import { Reader } from "./views/Reader";
import { SettingsView } from "./views/Settings";
import { Writing } from "./views/Writing";

export type Route =
  | { view: "feed" }
  | { view: "news" }
  | { view: "library" }
  | { view: "writing"; articleId?: string }
  | { view: "profile" }
  | { view: "settings" }
  | { view: "reader"; articleId: string; from: Route };

interface Ctx {
  go: (r: Route) => void;
  /** The screen currently shown. */
  view: Route["view"];
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
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
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

  // The app's language, set before anything is drawn (texts are read while drawing).
  const uiLang = settings?.uiLang ?? "fr";
  setLang(uiLang);
  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

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

  // Escape goes back: from an article to where it was opened, from any other page
  // to the feed. Not while typing, nor during the tour (Escape closes it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !settings?.onboarded) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      // A selection in the article (explain bubble): Escape only clears it.
      if (window.getSelection()?.toString()) return;
      // Something open on top (an enlarged figure): Escape closes it instead.
      if (document.querySelector("[data-escape-closes]")) return;
      if (route.view === "reader") go(route.from);
      else if (route.view !== "feed") go({ view: "feed" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, go, settings?.onboarded]);

  const toggleTheme = async () => {
    setSettings(await api.saveSettings({ theme: dark ? "light" : "dark" }));
  };

  const nav: { id: Route["view"]; label: string; icon: React.ReactNode }[] = [
    { id: "feed", label: t("Articles"), icon: <Sparkles size={16} /> },
    { id: "news", label: t("Actus"), icon: <Newspaper size={16} /> },
    { id: "library", label: t("Bibliothèque"), icon: <BookMarked size={16} /> },
    { id: "writing", label: t("Mes articles"), icon: <PenLine size={16} /> },
    { id: "profile", label: t("Mes goûts"), icon: <UserRound size={16} /> },
  ];
  const active = route.view === "reader" ? route.from.view : route.view;

  // First launch: the interests come first, before any feed is fetched.
  if (settings && !settings.interestsChosen) {
    return (
      <AppCtx.Provider value={{ go, view: route.view, toast, settings, reloadSettings, refresh }}>
        <div className="app" key={uiLang}>
          <div className="dots" />
          <header className="titlebar">
            <div className="brand">
              <img src={iconUrl} alt="" />
              <strong>Nùkún</strong>
            </div>
          </header>
          <main className="main">
            <Welcome onDone={() => void reloadSettings()} />
          </main>
        </div>
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={{ go, view: route.view, toast, settings, reloadSettings, refresh }}>
      {/* A change of language draws every screen again, in the new language. */}
      <div className="app" key={uiLang}>
        <div className="dots" />
        <header className="titlebar">
          <div className="brand">
            <img src={iconUrl} alt="" />
            <strong>Nùkún</strong>
            <span>· {now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}</span>
          </div>
          <nav className="nav" aria-label={t("Navigation principale")} data-tour="nav">
            {nav.map((n) => (
              <button
                key={n.id}
                data-tour={`nav-${n.id}`}
                className={`toggle ${active === n.id ? "active" : ""}`}
                onClick={() => go({ view: n.id } as Route)}
              >
                {n.icon}
                <span>{n.label}</span>
              </button>
            ))}
            <div className="sep" />
            <button
              data-tour="nav-settings"
              className={`toggle icon ${active === "settings" ? "active" : ""}`}
              onClick={() => go({ view: "settings" })}
              title={t("Réglages")}
              aria-label={t("Réglages")}
            >
              <Settings2 size={16} />
            </button>
            <button className="toggle icon" onClick={toggleTheme} title={t("Changer de thème")} aria-label={t("Changer de thème")}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </nav>
          <div className="right">{now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</div>
        </header>
        <main className="main" id="main-scroll">
          {route.view === "feed" && <Feed key="paper" kind="paper" />}
          {route.view === "news" && <Feed key="news" kind="news" />}
          {route.view === "library" && <Library />}
          {route.view === "writing" && <Writing articleId={route.articleId} />}
          {route.view === "profile" && <Profile />}
          {route.view === "settings" && <SettingsView />}
          {route.view === "reader" && <Reader key={route.articleId} id={route.articleId} back={route.from} />}
        </main>
        {settings && !settings.onboarded && (
          <Tour
            onDone={async () => {
              await api.saveSettings({ onboarded: true });
              await reloadSettings();
            }}
          />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
        <UpdateToast />
      </div>
    </AppCtx.Provider>
  );
}
