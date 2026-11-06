import { useEffect, useRef, useState } from "react";
import type { BuiltinStatus } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";
import { useApp } from "../App";

/**
 * First launch with the built-in translator: the articles show in their own language, and
 * this card, on the left (never over the update window), offers to switch translation on.
 * Two plain choices, each with its own consent: download the translator (once), and let the
 * server help with sentences it gets wrong. Nothing is downloaded or sent before "Activer".
 */
export function TranslatorInvite() {
  const { settings, reloadSettings } = useApp();
  const [bi, setBi] = useState<BuiltinStatus | null>(null);
  const [help, setHelp] = useState(false);
  const [state, setState] = useState<"ask" | "downloading" | "done" | "hidden">("ask");
  // Packs still to download after the one running (the other languages, when the reader chose some).
  const queue = useRef<BuiltinStatus["packs"][number]["id"][]>([]);

  useEffect(() => {
    // A little after the launch, once the first articles are on screen.
    const id = setTimeout(() => void api.builtinStatus().then(setBi), 6000);
    return () => clearTimeout(id);
  }, []);

  // While it downloads, follow the progress.
  useEffect(() => {
    if (state !== "downloading") return;
    const id = setInterval(async () => {
      const s = await api.builtinStatus();
      setBi(s);
      if (s.downloading) return;
      const next = queue.current.shift();
      if (next && !s.error) setBi(await api.builtinDownload(next));
      else setState(s.packs.find((p) => p.id === s.need)?.downloaded ? "done" : "ask");
    }, 700);
    return () => clearInterval(id);
  }, [state]);

  if (!settings || !bi || state === "hidden" || settings.builtinAsked || settings.provider !== "builtin") return null;
  const pack = bi.packs.find((p) => p.id === bi.need);
  if (!pack || (pack.downloaded && state !== "done")) return null;
  // Languages other than English and French need the bigger pack too.
  const other = bi.packs.find((p) => p.id === "other");
  const wantsOther = !!other && !other.downloaded && Object.entries(settings.languages).some(([l, on]) => on && l !== "en" && l !== "fr");

  const finish = async () => {
    await api.saveSettings({ builtinAsked: true });
    await reloadSettings();
    setState("hidden");
  };

  if (state === "done") {
    return (
      <div className="update-toast lexicon-toast card" role="status">
        <div className="grow">
          <strong>{t("La traduction est prête")}</strong>
          <div className="small muted">{t("Les prochains articles s'ouvrent traduits. Tu peux tout régler plus tard dans les réglages.")}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm primary" onClick={() => void finish()}>
              {t("Compris")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busy = state === "downloading";
  return (
    <div className="update-toast lexicon-toast card" role="status">
      <div className="grow">
        <strong>{t("Lire les articles en français")}</strong>
        <div className="small muted">{t("En attendant, ils s'affichent dans leur langue d'origine. Pour les traduire, Nùkún télécharge un petit traducteur ({mb} Mo, une seule fois) qui travaille sur ton ordinateur, sans compte ni clé.", { mb: pack.mb })}</div>
        {wantsOther && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {t("Tu as choisi d'autres langues : un pack de plus ({mb} Mo) sera aussi téléchargé.", { mb: other!.mb })}
          </div>
        )}
        <label className="check-row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={help} disabled={busy} onChange={(e) => setHelp(e.target.checked)} />
          <span>{t("Aider le traducteur avec notre serveur : les phrases qu'il rate sont envoyées (elles seules) à notre serveur, qui les fait corriger par Gemini.")}</span>
        </label>
        {busy && (
          <div className="progress" aria-label={t("Téléchargement")}>
            <div style={{ width: `${Math.round((bi.progress ?? 0) * 100)}%` }} />
          </div>
        )}
        {bi.error && !busy && <div className="small" style={{ color: "var(--accent)", marginTop: 6 }}>{bi.error}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn sm primary"
            disabled={busy}
            onClick={async () => {
              if (help !== settings.assistServer) await api.saveSettings({ assistServer: help });
              await reloadSettings();
              queue.current = wantsOther ? ["other"] : [];
              setState("downloading");
              setBi(await api.builtinDownload(pack.id));
            }}
          >
            {busy ? `${Math.round((bi.progress ?? 0) * 100)} %` : t("Activer")}
          </button>
          {!busy && (
            <>
              <button className="btn sm ghost" onClick={() => setState("hidden")}>
                {t("Plus tard")}
              </button>
              <button className="btn sm ghost" onClick={() => void finish()}>
                {t("Non merci")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
