import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ArticleKind, DomainId, FeedItem } from "@shared/types";
import { FIELD_GROUPS, FIELDS, fieldLabel } from "@shared/types";
import { api } from "../api";
import { useApp } from "../App";
import { ArticleCard, CardSkeleton } from "../components/ArticleCard";

/** Per feed: "all", a field id, "g:<group>" (big domain) or "t:<topic>" (news). */
const lastDomain: Record<ArticleKind, string> = { paper: "all", news: "all" };
/** Where the reader was in each feed, to come back to the same place after reading. */
const savedPos: Record<ArticleKind, { domain: string; count: number; scroll: number } | null> = { paper: null, news: null };

const NEWS_TOPICS = [
  { id: "t:science", label: "Science" },
  { id: "t:tech", label: "Outils de dev" },
];

const PAGE = 30;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Encore debout ? Voici";
  if (h < 12) return "Bonjour, voici";
  if (h < 18) return "Bon après-midi, voici";
  return "Bonsoir, voici";
}

export function Feed({ kind }: { kind: ArticleKind }) {
  const { go, refresh, settings, toast } = useApp();
  const [domain, setDomain] = useState<string>(lastDomain[kind]);
  const [counts, setCounts] = useState<Record<DomainId, number>>({});
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [end, setEnd] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const fetched = useRef(0); // items taken from the ranking so far (dismissed included)
  const hidden = useRef(new Set<string>());
  const sentinel = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  // Followed while scrolling: when the feed closes, the page has already been reset.
  const lastScroll = useRef(0);
  useEffect(() => {
    const main = document.getElementById("main-scroll");
    const onScroll = () => {
      if (main && pendingScroll.current === null) lastScroll.current = main.scrollTop;
    };
    main?.addEventListener("scroll", onScroll, { passive: true });
    return () => main?.removeEventListener("scroll", onScroll);
  }, []);

  // Back from an article: return to the same place once the cards are on screen.
  useLayoutEffect(() => {
    const main = document.getElementById("main-scroll");
    if (pendingScroll.current === null || !items?.length || !main) return;
    main.scrollTop = pendingScroll.current;
    pendingScroll.current = null;
  }, [items]);

  const askTeasers = (page: FeedItem[]) => {
    const missing = page.filter((f) => !f.article.titleFr).map((f) => f.article.id);
    if (missing.length) void api.translateTeasers(missing);
  };
  const visible = (list: FeedItem[]) => list.filter((x) => !hidden.current.has(x.article.id));

  /** First page: a fresh ranking, or the same list as before when coming back. */
  const loadFirst = useCallback(
    async (restore: boolean) => {
      const saved = savedPos[kind];
      const back = restore && saved && saved.domain === domain && saved.count > 0 ? saved : null;
      const limit = back ? back.count : PAGE;
      const [page, c] = await Promise.all([api.getFeed({ domain, offset: 0, limit, fresh: !back, kind }), api.fieldCounts()]);
      fetched.current = page.length;
      setCounts(c);
      setItems(visible(page));
      setEnd(page.length < limit);
      setNewCount(0);
      askTeasers(page.slice(0, PAGE));
      if (back) pendingScroll.current = back.scroll;
    },
    [domain],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || end || items === null) return;
    setLoadingMore(true);
    const page = await api.getFeed({ domain, offset: fetched.current, limit: PAGE, fresh: false, kind });
    fetched.current += page.length;
    setItems((xs) => [...(xs ?? []), ...visible(page)]);
    setEnd(page.length < PAGE);
    setLoadingMore(false);
    askTeasers(page);
  }, [domain, loadingMore, end, items]);

  useEffect(() => {
    lastDomain[kind] = domain;
    void loadFirst(true);
    // Titles translated or articles updated: refresh the cards in place, same order.
    const offUpdate = api.on("feed-updated", async () => {
      if (!fetched.current) return;
      const page = await api.getFeed({ domain, offset: 0, limit: fetched.current, fresh: false, kind });
      setItems(visible(page));
    });
    // A refresh found new articles: offer them without moving the reader.
    const offRefresh = api.on("refresh-progress", (p) => {
      if (!p.running && p.newArticles) setNewCount(p.newArticles);
    });
    return () => {
      offUpdate();
      offRefresh();
      savedPos[kind] = { domain, count: fetched.current, scroll: lastScroll.current };
    };
  }, [loadFirst, domain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Next page as the reader nears the bottom (one screen ahead).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void loadMore(), {
      root: document.getElementById("main-scroll"),
      rootMargin: "0px 0px 100% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const showNew = () => {
    savedPos[kind] = null;
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
    void loadFirst(false);
  };

  const dismiss = (id: string) => {
    void api.interact({ id, type: "dismiss" });
    hidden.current.add(id);
    setItems((xs) => xs?.filter((x) => x.article.id !== id) ?? null);
    toast("Compris : l'algorithme t'en montrera moins comme ça.");
  };

  const open = (id: string) => go({ view: "reader", articleId: id, from: { view: kind === "news" ? "news" : "feed" } });
  const running = refresh?.running;
  // The disciplines with the most articles get a chip; the others are in a list.
  const ranked = FIELDS.filter((f) => settings?.domains[f.id] !== false && counts[f.id]).sort(
    (a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0),
  );
  const topFields = ranked.slice(0, 6);
  const otherFields = ranked.slice(6);
  const groups = FIELD_GROUPS.filter((g) => ranked.some((f) => f.group === g.id));

  return (
    <div className="page">
      <div className="feed-head">
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">{kind === "news" ? "Actus" : "Ton fil scientifique"}</span>
          <h1 className="display">
            {kind === "news"
              ? "Les actualités des organismes scientifiques et des outils de développement."
              : `${greeting()} ce que la recherche a publié pour toi.`}
          </h1>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 8 }}>
          <button className="btn" onClick={() => void api.refresh()} disabled={running} data-tour={kind === "paper" ? "refresh" : undefined}>
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

      {newCount > 0 && (
        <button className="new-banner" onClick={showNew}>
          <RefreshCw size={14} /> {newCount} nouveaux articles : afficher
        </button>
      )}

      <div className="feed-filters" data-tour={kind === "paper" ? "filters" : undefined}>
        <button className={`chip ${domain === "all" ? "active" : ""}`} onClick={() => setDomain("all")}>
          Tout
        </button>
        {kind === "news" &&
          NEWS_TOPICS.map((t) => (
            <button key={t.id} className={`chip ${domain === t.id ? "active" : ""}`} onClick={() => setDomain(t.id)}>
              {t.label}
            </button>
          ))}
        {kind === "paper" && groups.map((g) => (
          <button key={g.id} className={`chip ${domain === `g:${g.id}` ? "active" : ""}`} onClick={() => setDomain(`g:${g.id}`)}>
            {g.label}
          </button>
        ))}
        {kind === "paper" && <span className="filters-sep" />}
        {kind === "paper" && topFields.map((f) => (
          <button key={f.id} className={`chip ${domain === f.id ? "active" : ""}`} onClick={() => setDomain(f.id)}>
            {f.label}
          </button>
        ))}
        {kind === "paper" && otherFields.length > 0 && (
          <select
            className={`chip select-chip ${otherFields.some((f) => f.id === domain) ? "active" : ""}`}
            value={otherFields.some((f) => f.id === domain) ? domain : ""}
            onChange={(e) => e.target.value && setDomain(e.target.value)}
            aria-label="Autres disciplines"
          >
            <option value="">Autres disciplines…</option>
            {otherFields.map((f) => (
              <option key={f.id} value={f.id}>
                {fieldLabel(f.id)} ({counts[f.id]})
              </option>
            ))}
          </select>
        )}
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
              tour={i === 0 && kind === "paper" ? "first-card" : undefined}
              key={it.article.id}
              item={it}
              hero={i === 0}
              onOpen={() => open(it.article.id)}
              onDismiss={() => dismiss(it.article.id)}
            />
          ))}
        </div>
      )}

      {items !== null && items.length > 0 && (
        <div className="feed-end" ref={sentinel}>
          {end ? (
            <>
              <p className="muted">Tu as tout parcouru pour cette sélection.</p>
              <button className="btn" onClick={() => void api.refresh()} disabled={running}>
                {running ? <div className="spinner" /> : <RefreshCw size={15} />} Chercher de nouveaux articles
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <div className="spinner" /> : null} Charger plus
            </button>
          )}
        </div>
      )}
    </div>
  );
}
