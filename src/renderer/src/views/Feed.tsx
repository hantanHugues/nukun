import { Plus, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ArticleKind, FeedItem, Interest } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";
import { useApp } from "../App";
import { ArticleCard, CardSkeleton } from "../components/ArticleCard";

/** Per feed: "all" or "i:<interest>". */
const lastDomain: Record<ArticleKind, string> = { paper: "all", news: "all" };
/** Where the reader was in each feed, to come back to the same place after reading. */
const savedPos: Record<ArticleKind, { domain: string; count: number; scroll: number } | null> = { paper: null, news: null };

const PAGE = 30;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t("Encore debout ? Voici ce que la recherche a publié pour toi.");
  if (h < 12) return t("Bonjour, voici ce que la recherche a publié pour toi.");
  if (h < 18) return t("Bon après-midi, voici ce que la recherche a publié pour toi.");
  return t("Bonsoir, voici ce que la recherche a publié pour toi.");
}

export function Feed({ kind }: { kind: ArticleKind }) {
  const { go, refresh, settings, toast, reloadSettings } = useApp();
  const [suggested, setSuggested] = useState<Interest | null>(null);
  // Filters from before the interests ("g:physical"…) start again from "all".
  const [domain, setDomain] = useState<string>(/^(all|i:)/.test(lastDomain[kind]) ? lastDomain[kind] : "all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [end, setEnd] = useState(false);
  // The reader clicked "Actualiser": show the result once the refresh is done.
  const manualRefresh = useRef(false);
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

  // Cards that come on screen are prepared (French title, image), a few at a time.
  const seen = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardObserver = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    cardObserver.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.cardId;
          if (!e.isIntersecting || !id || seen.current.has(id)) continue;
          seen.current.add(id);
          pending.current.add(id);
        }
        if (pending.current.size && !flush.current)
          flush.current = setTimeout(() => {
            void api.prepareCards([...pending.current]);
            pending.current.clear();
            flush.current = null;
          }, 300);
      },
      // One screen ahead, so cards are ready when they arrive.
      { root: document.getElementById("main-scroll"), rootMargin: "0px 0px 100% 0px" },
    );
    return () => cardObserver.current?.disconnect();
  }, []);
  useEffect(() => {
    const io = cardObserver.current;
    if (!io) return;
    document.querySelectorAll<HTMLElement>("[data-card-id]").forEach((el) => io.observe(el));
  }, [items]);
  const visible = (list: FeedItem[]) => list.filter((x) => !hidden.current.has(x.article.id));

  /** First page: a fresh ranking, or the same list as before when coming back. */
  const loadFirst = useCallback(
    async (restore: boolean) => {
      const saved = savedPos[kind];
      const back = restore && saved && saved.domain === domain && saved.count > 0 ? saved : null;
      const limit = back ? back.count : PAGE;
      const [page, c] = await Promise.all([api.getFeed({ domain, offset: 0, limit, fresh: !back, kind }), api.fieldCounts(kind)]);
      fetched.current = page.length;
      setCounts(c);
      setItems(visible(page));
      setEnd(page.length < limit);
      if (kind === "paper") setSuggested(await api.suggestion());
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
  }, [domain, loadingMore, end, items]);

  useEffect(() => {
    lastDomain[kind] = domain;
    void loadFirst(true);
    // Titles translated or articles updated: refresh the cards in place, same order.
    const offUpdate = api.on("feed-updated", async () => {
      // Empty feed during the first refresh: show the first articles as they arrive.
      if (!fetched.current) return void loadFirst(false);
      const [page, c] = await Promise.all([
        api.getFeed({ domain, offset: 0, limit: fetched.current, fresh: false, kind }),
        api.fieldCounts(kind),
      ]);
      setItems(visible(page));
      setCounts(c);
    });
    // New articles: shown when the reader asked for them ("Actualiser") or is at the
    // top of the feed. Further down, nothing moves; they come at the next launch.
    const offRefresh = api.on("refresh-progress", (p) => {
      if (p.running) return;
      const main = document.getElementById("main-scroll");
      const asked = manualRefresh.current;
      manualRefresh.current = false;
      if (!asked && (!p.newArticles || (main && main.scrollTop >= 300))) return;
      savedPos[kind] = null;
      main?.scrollTo({ top: 0 });
      void loadFirst(false);
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

  const refreshNow = () => {
    manualRefresh.current = true;
    void api.refresh();
  };

  const dismiss = (id: string) => {
    void api.interact({ id, type: "dismiss" });
    hidden.current.add(id);
    setItems((xs) => xs?.filter((x) => x.article.id !== id) ?? null);
    toast(t("Compris : l'algorithme t'en montrera moins comme ça."));
  };

  const adopt = async (i: Interest) => {
    setSuggested(null);
    await api.setInterests([...(settings?.interests ?? []), i], settings?.languages ?? {});
    await reloadSettings();
    toast(t("« {label} » ajouté à tes centres d'intérêt.", { label: t(i.label) }));
  };
  const decline = (i: Interest) => {
    setSuggested(null);
    void api.dismissSuggestion(i.id);
  };

  const open = (id: string) => go({ view: "reader", articleId: id, from: { view: kind === "news" ? "news" : "feed" } });
  const running = refresh?.running;
  // One chip per interest that has something to read in this feed.
  const chips = (settings?.interests ?? []).filter((i) => counts[i.id] || domain === `i:${i.id}`);

  return (
    <div className="page">
      <div className="feed-head">
        <div className="stack" style={{ gap: 10 }}>
          <span className="label">{kind === "news" ? t("Actus") : t("Ton fil scientifique")}</span>
          <h1 className="display">{kind === "news" ? t("Les actualités officielles liées à ce qui t'intéresse.") : greeting()}</h1>
        </div>
        <div className="stack" style={{ alignItems: "flex-end", gap: 8 }}>
          <button className="btn" onClick={refreshNow} disabled={running} data-tour={kind === "paper" ? "refresh" : undefined}>
            {running ? <div className="spinner" /> : <RefreshCw size={15} />}
            {t("Actualiser")}
          </button>
          {refresh && (
            <span className="refresh-status">
              {refresh.running
                ? `${refresh.step}…`
                : refresh.newArticles
                  ? t("{n} nouveaux articles", { n: refresh.newArticles })
                  : t("Fil à jour")}
            </span>
          )}
        </div>
      </div>

      {suggested && (
        <div className="suggest-banner">
          <span>{t("Tu lis souvent des articles proches de « {label} ». L'ajouter à tes centres d'intérêt ?", { label: t(suggested.label) })}</span>
          <button className="btn sm primary" onClick={() => void adopt(suggested)}>
            <Plus size={14} /> {t("Ajouter")}
          </button>
          <button className="btn sm ghost icon" aria-label={t("Non merci")} title={t("Non merci")} onClick={() => decline(suggested)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="feed-filters" data-tour={kind === "paper" ? "filters" : undefined}>
        <button className={`chip ${domain === "all" ? "active" : ""}`} onClick={() => setDomain("all")}>
          {t("Tout")}
        </button>
        {chips.map((i) => (
          <button key={i.id} className={`chip ${domain === `i:${i.id}` ? "active" : ""}`} onClick={() => setDomain(`i:${i.id}`)}>
            {t(i.label)}
          </button>
        ))}
        <button className="chip ghost-chip" onClick={() => go({ view: "settings" })} title={t("Modifier mes centres d'intérêt")}>
          <SlidersHorizontal size={13} /> {t("Modifier")}
        </button>
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
              <div className="spinner" /> {t("Récupération des premiers articles auprès des sources scientifiques…")}
            </div>
          ) : (
            <>
              <p>
                {kind === "news" && !chips.length
                  ? t("Aucune source d'actualité officielle ne couvre encore tes centres d'intérêt : les articles de recherche sont dans l'onglet Articles.")
                  : t("Aucun article à afficher pour l'instant.")}
              </p>
              <button className="btn" onClick={refreshNow}>
                <RefreshCw size={15} /> {t("Chercher de nouveaux articles")}
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
              <p className="muted">{t("Tu as tout parcouru pour cette sélection.")}</p>
              <button className="btn" onClick={refreshNow} disabled={running}>
                {running ? <div className="spinner" /> : <RefreshCw size={15} />} {t("Chercher de nouveaux articles")}
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <div className="spinner" /> : null} {t("Charger plus")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
