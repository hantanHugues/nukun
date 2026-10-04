import { Brain, Compass, Plus, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Interest, InterestProfileView } from "@shared/types";
import { fieldLabel } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";
import { useApp } from "../App";

export function Profile() {
  const { toast, go, settings, reloadSettings } = useApp();
  const [p, setP] = useState<InterestProfileView | null>(null);
  const [suggested, setSuggested] = useState<Interest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api.getProfile().then(setP);
    void api.suggestion().then(setSuggested);
  };

  const adopt = async (i: Interest) => {
    setSuggested(null);
    await api.setInterests([...(settings?.interests ?? []), i], settings?.languages ?? {});
    await reloadSettings();
    load();
    toast(t("« {label} » ajouté à tes centres d'intérêt.", { label: t(i.label) }));
  };
  useEffect(() => {
    load();
    return api.on("feed-updated", load);
  }, []);

  const analyze = async () => {
    setBusy(true);
    await api.analyzeInterests();
    setBusy(false);
    load();
  };

  if (!p) return null;
  const maxShare = Math.max(1e-6, ...p.interests.map((i) => i.share));
  const maxT = Math.max(1e-6, ...p.topTerms.map((x) => x.weight));

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">{t("Mes goûts")}</span>
        <h1 className="display">{t("Ce que l'algorithme a compris de toi.")}</h1>
        <p className="muted" style={{ maxWidth: 640, margin: 0 }}>
          {t("Chaque article ouvert, lu jusqu'au bout, aimé, sauvegardé ou écarté ajuste ton fil. Les signaux anciens s'effacent peu à peu, comme sur un réseau social. {n} signaux enregistrés.", { n: p.signals })}
        </p>
        <p className="small muted" style={{ maxWidth: 640, margin: 0 }}>
          {p.semantic.state === "off"
            ? t("Recommandations par le sens en pause : le modèle (130 Mo) n'est pas téléchargé tant que l'économie de données est active.")
            : p.semantic.state === "loading"
              ? p.semantic.downloaded
                ? t("Recommandations par le sens : téléchargement du modèle multilingue, une seule fois ({n} Mo sur 113)… Il reprend là où il s'est arrêté si l'app est fermée.", { n: Math.round(p.semantic.downloaded / 1048576) })
                : t("Recommandations par le sens : téléchargement du modèle multilingue, une seule fois… Il reprend là où il s'est arrêté si l'app est fermée.")
              : p.semantic.state === "error"
                ? t("Recommandations par le sens indisponibles pour l'instant (connexion ?) : le fil se base sur les mots.")
                : t("Recommandations par le sens, dans toutes les langues : {n} articles analysés sur ton PC.", { n: p.semantic.analysed })}
        </p>
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            {t("Tes centres d'intérêt")}
          </h2>
          <button className="btn sm ghost" onClick={() => go({ view: "settings" })}>
            <SlidersHorizontal size={14} /> {t("Modifier")}
          </button>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          {t("Leur part du fil : égale au départ, elle grandit pour les sujets que tu lis le plus.")}
        </p>
        <div className="stack" style={{ gap: 14, marginTop: 16 }}>
          {p.interests.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 14 }}>
                <span style={{ width: 240 }}>{t(i.label)}</span>
                <div className="bar grow">
                  <div style={{ width: `${Math.max(2, (i.share / maxShare) * 100)}%` }} />
                </div>
                <span className="small muted" style={{ width: 150, textAlign: "right" }}>
                  {t("{pct} % du fil", { pct: Math.round(i.share * 100) })} · {i.read > 1 ? t("{n} lus", { n: i.read }) : t("{n} lu", { n: i.read })}
                </span>
              </div>
              {i.news !== "full" && (
                <span className="small muted coverage-note">
                  {i.news === "none"
                    ? t("Pas encore d'actus officielles pour ce sujet : articles de recherche seulement.")
                    : t("Actus limitées : seulement quand le journal du CNRS en parle.")}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <Compass size={18} color="var(--brand)" />
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            {t("En exploration")}
          </h2>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          {t("Des domaines voisins de tes centres d'intérêt, glissés dans le fil comme « Découverte ». Ils changent à chaque actualisation ; si tu en lis souvent, l'app te proposera de les ajouter.")}
        </p>
        <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
          {p.explore.length ? (
            p.explore.map((f) => (
              <span key={f} className="tag">
                {fieldLabel(f)}
              </span>
            ))
          ) : (
            <span className="small muted">{t("Rien pour l'instant : ils seront choisis à la prochaine actualisation.")}</span>
          )}
        </div>
        {suggested && (
          <div className="suggest-banner" style={{ marginTop: 14, marginBottom: 0 }}>
            <span>{t("Tu lis souvent des articles proches de « {label} ». L'ajouter à tes centres d'intérêt ?", { label: t(suggested.label) })}</span>
            <button className="btn sm primary" onClick={() => void adopt(suggested)}>
              <Plus size={14} /> {t("Ajouter")}
            </button>
          </div>
        )}
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <Brain size={18} color="var(--brand)" />
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            {t("Ce que l'IA a remarqué dans tes lectures")}
          </h2>
          <button className="btn sm" onClick={() => void analyze()} disabled={busy}>
            {busy ? <div className="spinner" /> : <Sparkles size={14} />} {t("Réanalyser")}
          </button>
        </div>
        {p.aiInterests.length ? (
          <div className="stack" style={{ gap: 12, marginTop: 16 }}>
            {p.aiInterests.map((it) => (
              <div key={it.label}>
                <div style={{ fontWeight: 560 }}>{it.label}</div>
                <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                  {it.keywords.map((k) => (
                    <span key={k} className="tag" lang="en">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {t("L'IA analysera tes goûts après quelques lectures (articles aimés, sauvegardés ou lus en entier). Tu peux aussi lancer l'analyse maintenant.")}
          </p>
        )}
      </div>

      <div className="card section">
        <div className="row">
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            {t("Mots qui pèsent dans tes recommandations")}
          </h2>
          <button
            className="btn sm ghost"
            onClick={async () => {
              if (!confirm(t("Remettre l'algorithme à zéro ? Ton historique de lecture est conservé, seul le profil est effacé."))) return;
              await api.resetProfile();
              load();
              toast(t("Profil réinitialisé."));
            }}
          >
            <RotateCcw size={14} /> {t("Réinitialiser")}
          </button>
        </div>
        <div className="term-cloud" style={{ marginTop: 16 }}>
          {p.topTerms.map((x) => (
            <span
              key={x.term}
              className="tag"
              lang="en"
              style={{ fontSize: 12 + (x.weight / maxT) * 6, height: "auto", padding: "4px 10px", opacity: 0.55 + (x.weight / maxT) * 0.45 }}
            >
              {x.term}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
