import { CheckCircle2, Heart, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import type { Article } from "@shared/types";
import { api } from "../api";
import { useApp } from "../App";
import { DOMAIN_ART, domainLabel, sourceLabel, timeAgo } from "../util";

type Tab = "encours" | "sauves" | "aimes" | "termines" | "postes";

const TABS: { id: Tab; label: string; test: (a: Article) => boolean }[] = [
  { id: "encours", label: "En cours", test: (a) => !!a.state.opened && !a.state.finished },
  { id: "sauves", label: "À lire plus tard", test: (a) => !!a.state.saved },
  { id: "aimes", label: "Aimés", test: (a) => !!a.state.liked },
  { id: "termines", label: "Terminés", test: (a) => !!a.state.finished },
  { id: "postes", label: "Publiés", test: (a) => !!a.state.posted },
];

export function Library() {
  const { go } = useApp();
  const [tab, setTab] = useState<Tab>("encours");
  const [items, setItems] = useState<Article[]>([]);

  useEffect(() => {
    void api.getLibrary().then(setItems);
  }, []);

  const shown = items.filter(TABS.find((t) => t.id === tab)!.test);

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">Bibliothèque</span>
        <h1 className="display">Tes lectures</h1>
      </div>
      <div className="feed-filters">
        {TABS.map((t) => (
          <button key={t.id} className={`chip ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label} <span style={{ opacity: 0.6 }}>{items.filter(t.test).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="card empty">Rien ici pour le moment.</div>
      ) : (
        <div className="list">
          {shown.map((a) => {
            const art = DOMAIN_ART[a.domain];
            return (
              <div key={a.id} className="list-item" onClick={() => go({ view: "reader", articleId: a.id, from: { view: "library" } })}>
                <div className="thumb">
                  {a.image ? (
                    <img src={a.image} alt="" loading="lazy" />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${art.g1}, ${art.g2})` }} />
                  )}
                </div>
                <div className="grow stack" style={{ gap: 6 }}>
                  <div className="title">{a.titleFr ?? a.title}</div>
                  <div className="row small muted wrap">
                    <span className="tag brand">{domainLabel(a.domain)}</span>
                    <span>{sourceLabel(a)}</span>
                    <span>· ouvert {timeAgo(a.state.lastOpened ?? a.fetchedAt)}</span>
                    {a.state.liked && <Heart size={13} fill="currentColor" color="var(--accent)" />}
                    {a.state.finished && <CheckCircle2 size={13} color="var(--success)" />}
                  </div>
                  <div className="bar" style={{ maxWidth: 260 }}>
                    <div style={{ width: `${Math.round(a.state.progress * 100)}%` }} />
                  </div>
                </div>
                <button
                  className="btn sm ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    go({ view: "writing", articleId: a.id });
                  }}
                >
                  <PenLine size={14} /> Écrire
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
