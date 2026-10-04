import { Brain, Compass, Plus, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Interest, InterestProfileView } from "@shared/types";
import { fieldLabel } from "@shared/types";
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
    toast(`« ${i.label} » ajouté à tes centres d'intérêt.`);
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
  const maxT = Math.max(1e-6, ...p.topTerms.map((t) => t.weight));

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">Mes goûts</span>
        <h1 className="display">Ce que l'algorithme a compris de toi.</h1>
        <p className="muted" style={{ maxWidth: 640, margin: 0 }}>
          Chaque article ouvert, lu jusqu'au bout, aimé, sauvegardé ou écarté ajuste ton fil. Les signaux anciens s'effacent peu à
          peu, comme sur un réseau social. {p.signals} signaux enregistrés.
        </p>
        <p className="small muted" style={{ maxWidth: 640, margin: 0 }}>
          {p.semantic.state === "loading"
            ? "Recommandations par le sens : préparation du modèle multilingue (130 Mo, téléchargé une seule fois)…"
            : p.semantic.state === "error"
              ? "Recommandations par le sens indisponibles pour l'instant (connexion ?) : le fil se base sur les mots."
              : `Recommandations par le sens, dans toutes les langues : ${p.semantic.analysed} articles analysés sur ton PC.`}
        </p>
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            Tes centres d'intérêt
          </h2>
          <button className="btn sm ghost" onClick={() => go({ view: "settings" })}>
            <SlidersHorizontal size={14} /> Modifier
          </button>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Leur part du fil : égale au départ, elle grandit pour les sujets que tu lis le plus.
        </p>
        <div className="stack" style={{ gap: 14, marginTop: 16 }}>
          {p.interests.map((i) => (
            <div key={i.id} className="stack" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 14 }}>
                <span style={{ width: 240 }}>{i.label}</span>
                <div className="bar grow">
                  <div style={{ width: `${Math.max(2, (i.share / maxShare) * 100)}%` }} />
                </div>
                <span className="small muted" style={{ width: 150, textAlign: "right" }}>
                  {Math.round(i.share * 100)} % du fil · {i.read} lu{i.read > 1 ? "s" : ""}
                </span>
              </div>
              {i.news !== "full" && (
                <span className="small muted coverage-note">
                  {i.news === "none"
                    ? "Pas encore d'actus officielles pour ce sujet : articles de recherche seulement."
                    : "Actus limitées : seulement quand le journal du CNRS en parle."}
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
            En exploration
          </h2>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          Des domaines voisins de tes centres d'intérêt, glissés dans le fil comme « Découverte ». Ils changent à chaque
          actualisation ; si tu en lis souvent, l'app te proposera de les ajouter.
        </p>
        <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
          {p.explore.length ? (
            p.explore.map((f) => (
              <span key={f} className="tag">
                {fieldLabel(f)}
              </span>
            ))
          ) : (
            <span className="small muted">Rien pour l'instant : ils seront choisis à la prochaine actualisation.</span>
          )}
        </div>
        {suggested && (
          <div className="suggest-banner" style={{ marginTop: 14, marginBottom: 0 }}>
            <span>
              Tu lis souvent des articles proches de <strong>{suggested.label}</strong>. L'ajouter à tes centres d'intérêt ?
            </span>
            <button className="btn sm primary" onClick={() => void adopt(suggested)}>
              <Plus size={14} /> Ajouter
            </button>
          </div>
        )}
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <Brain size={18} color="var(--brand)" />
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            Ce que l'IA a remarqué dans tes lectures
          </h2>
          <button className="btn sm" onClick={() => void analyze()} disabled={busy}>
            {busy ? <div className="spinner" /> : <Sparkles size={14} />} Réanalyser
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
            L'IA analysera tes goûts après quelques lectures (articles aimés, sauvegardés ou lus en entier). Tu peux aussi lancer
            l'analyse maintenant.
          </p>
        )}
      </div>

      <div className="card section">
        <div className="row">
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            Mots qui pèsent dans tes recommandations
          </h2>
          <button
            className="btn sm ghost"
            onClick={async () => {
              if (!confirm("Remettre l'algorithme à zéro ? Ton historique de lecture est conservé, seul le profil est effacé.")) return;
              await api.resetProfile();
              load();
              toast("Profil réinitialisé.");
            }}
          >
            <RotateCcw size={14} /> Réinitialiser
          </button>
        </div>
        <div className="term-cloud" style={{ marginTop: 16 }}>
          {p.topTerms.map((t) => (
            <span
              key={t.term}
              className="tag"
              lang="en"
              style={{ fontSize: 12 + (t.weight / maxT) * 6, height: "auto", padding: "4px 10px", opacity: 0.55 + (t.weight / maxT) * 0.45 }}
            >
              {t.term}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
