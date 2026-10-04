import { Bookmark, BookmarkCheck, Compass, EyeOff, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@shared/types";
import { languageLabel } from "@shared/types";
import { lang, t } from "@shared/i18n";
import { api } from "../api";
import { artFor, authorsShort, domainLabel, sourceLabel, timeAgo } from "../util";

const seen = new Set<string>();

export function ArticleCard({
  item,
  hero,
  onOpen,
  onDismiss,
  tour,
}: {
  tour?: string;
  item: FeedItem;
  hero?: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const a = item.article;
  const ref = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(!!a.state.saved);
  const [imgOk, setImgOk] = useState(true);

  // Count an impression once the card has been at least 60 % visible for a second.
  useEffect(() => {
    const el = ref.current;
    if (!el || seen.has(a.id)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          timer = setTimeout(() => {
            seen.add(a.id);
            void api.interact({ id: a.id, type: "impression" });
            io.disconnect();
          }, 1000);
        } else if (timer) clearTimeout(timer);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [a.id]);

  const art = artFor(a.domain);
  const isFigure = !!a.image && !["nasa", "elife"].includes(a.source);
  const title = a.titleFr ?? a.title;

  const toggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    void api.interact({ id: a.id, type: saved ? "unsave" : "save" });
    setSaved(!saved);
  };

  return (
    <div
      ref={ref}
      data-tour={tour}
      data-card-id={a.id}
      role="button"
      tabIndex={0}
      className={`card acard ${hero ? "hero" : ""}`}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <div className={`media ${isFigure ? "fig" : ""}`}>
        {a.image && imgOk ? (
          <img src={a.image} alt="" loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <div className="placeholder" style={{ ["--g1" as string]: art.g1, ["--g2" as string]: art.g2, ["--dot" as string]: art.dot }}>
            <span>{domainLabel(a.domain)}</span>
          </div>
        )}
        <div className="actions">
          <button className="btn sm icon" onClick={toggleSave} title={saved ? t("Retirer des sauvegardes") : t("Lire plus tard")}>
            {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
          </button>
          <button
            className="btn sm icon"
            title={t("Pas intéressé : en montrer moins")}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            <EyeOff size={15} />
          </button>
        </div>
      </div>
      <div className="body">
        <div className="meta">
          {item.discovery ? (
            <span className="tag accent">
              <Compass size={12} /> {t("Découverte")}
            </span>
          ) : (
            <span className="tag brand">{domainLabel(a.domain)}</span>
          )}
          <span>{sourceLabel(a)}</span>
          {a.lang && a.lang !== "en" && (
            <span className="tag" title={t("Article en {langue}", { langue: languageLabel(a.lang).toLowerCase() })}>
              {a.lang.toUpperCase()}
            </span>
          )}
          <span>·</span>
          <span>{timeAgo(a.published)}</span>
        </div>
        <h3 lang={a.titleFr ? lang() : a.lang}>{title}</h3>
        {a.teaserFr ? (
          <p className="teaser">{a.teaserFr}</p>
        ) : (
          <p className="teaser" lang={a.lang}>
            {a.abstract.slice(0, hero ? 520 : 260)}
            {a.abstract.length > (hero ? 520 : 260) ? "…" : ""}
          </p>
        )}
        {hero && authorsShort(a) && <div className="small muted">{authorsShort(a)}</div>}
        {item.reasons[0] && !item.discovery && (
          <div className="why">
            <Sparkles size={12} /> {item.reasons[0]}
          </div>
        )}
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card acard" style={{ cursor: "default" }}>
      <div className="media skeleton" style={{ borderRadius: 0 }} />
      <div className="body">
        <div className="skeleton" style={{ height: 14, width: "40%" }} />
        <div className="skeleton" style={{ height: 22, width: "90%" }} />
        <div className="skeleton" style={{ height: 14, width: "100%" }} />
        <div className="skeleton" style={{ height: 14, width: "70%" }} />
      </div>
    </div>
  );
}
