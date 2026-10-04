import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DomainId, FeedItem } from "@shared/types";
import { DOMAINS } from "@shared/types";
import { api } from "../api";
import { useApp } from "../App";
import { ArticleCard, CardSkeleton } from "../components/ArticleCard";

let lastDomain: DomainId | "all" = "all";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Encore debout ? Voici";
  if (h < 12) return "Bonjour, voici";
  if (h < 18) return "Bon après-midi, voici";
  return "Bonsoir, voici";
}

export function Feed() {
  const { go, refresh, settings, toast } = useApp();
  const [domain, setDomain] = useState<DomainId | "all">(lastDomain);
  const [items, setItems] = useState<FeedItem[] | null>(null);

  const load = useCallback(async () => {
    const feed = await api.getFeed({ domain, limit: 60 });
    setItems(feed);
    const missing = feed.slice(0, 30).filter((f) => !f.article.titleFr).map((f) => f.article.id);
    if (missing.length) void api.translateTeasers(missing);
  }, [domain]);

  useEffect(() => {
    lastDomain = domain;
    void load();
    return api.on("feed-updated", () => void load());
  }, [load, domain]);

  const dismiss = (id: string) => {
    void api.interact({ id, type: "dismiss" });
    setItems((xs) => xs?.filter((x) => x.article.id !== id) ?? null);
    toast("Compris : l'algorithme t'en montrera moins comme ça.");
  };

  const open = (id: string) => go({ view: "reader", articleId: id, from: { view: "feed" } });
  const running = refresh?.running;
  const domains = DOMAINS.filter((d) => settings?.domains[d.id] !== false);

  return (
    <div className="page">
      <div className="feed-head">
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">Ton fil scientifique</span>
          <h1 className="display">{greeting()} ce que la recherche a publié pour toi.</h1>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 8 }}>
          <button className="btn" onClick={() => void api.refresh()} disabled={running}>
            {running ? <div className="spinner" /> : <RefreshCw size={15} />}
            Actualiser
          </button>
          {refresh && (
            <span className="refresh-status">
              {refresh.running ? `${refresh.step}…` : refresh.newArticles ? `${refresh.newArticles} nouveaux articles` : "Fil à jour"}
            </span>
          )}
        </div>
      </div>

      <div className="feed-filters">
        <button className={`chip ${domain === "all" ? "active" : ""}`} onClick={() => setDomain("all")}>
          Tout
        </button>
        {domains.map((d) => (
          <button key={d.id} className={`chip ${domain === d.id ? "active" : ""}`} onClick={() => setDomain(d.id)}>
            {d.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          {running ? (
            <div className="row" style={{ justifyContent: "center" }}>
              <div className="spinner" /> Récupération des premiers articles auprès des sources scientifiques…
            </div>
          ) : (
            <>
              <p>Aucun article à afficher pour l'instant.</p>
              <button className="btn" onClick={() => void api.refresh()}>
                <RefreshCw size={15} /> Chercher de nouveaux articles
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid">
          {items.map((it, i) => (
            <ArticleCard
              key={it.article.id}
              item={it}
              hero={i === 0}
              onOpen={() => open(it.article.id)}
              onDismiss={() => dismiss(it.article.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
