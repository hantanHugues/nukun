import { Brain, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { InterestProfileView } from "@shared/types";
import { DOMAINS } from "@shared/types";
import { api } from "../api";
import { useApp } from "../App";

export function Profile() {
  const { toast } = useApp();
  const [p, setP] = useState<InterestProfileView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => void api.getProfile().then(setP);
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
  const maxW = Math.max(1, ...p.domains.map((d) => Math.abs(d.weight)));
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
      </div>

      <div className="card section" style={{ marginBottom: 20 }}>
        <div className="row">
          <Brain size={18} color="var(--brand)" />
          <h2 className="h2 grow" style={{ fontSize: 18 }}>
            Tes centres d'intérêt, selon l'IA
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

      <div className="card section" style={{ marginBottom: 20 }}>
        <h2 className="h2" style={{ fontSize: 18 }}>
          Affinité par domaine
        </h2>
        <div className="stack" style={{ gap: 12, marginTop: 16 }}>
          {p.domains
            .filter((d) => d.id !== "autre" || d.impressions > 0)
            .map((d) => (
              <div key={d.id} className="row" style={{ gap: 14 }}>
                <span style={{ width: 200 }}>{DOMAINS.find((x) => x.id === d.id)?.label}</span>
                <div className="bar grow">
                  <div style={{ width: `${Math.max(2, (Math.max(0, d.weight) / maxW) * 100)}%`, background: d.weight < 0 ? "var(--accent)" : undefined }} />
                </div>
                <span className="small muted" style={{ width: 110, textAlign: "right" }}>
                  {d.impressions} vus
                </span>
              </div>
            ))}
        </div>
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
