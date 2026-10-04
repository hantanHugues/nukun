import {
  AArrowDown,
  AArrowUp,
  ArrowLeft,
  BookmarkCheck,
  Bookmark,
  ExternalLink,
  Heart,
  Languages,
  Lightbulb,
  PanelRight,
  PenLine,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, ArticleContent, Block, TranslationProgress } from "@shared/types";
import { api } from "../api";
import { type Route, useApp } from "../App";
import { Discussion, type ThreadItem } from "../components/Discussion";
import { authorsShort, domainLabel, plain, sanitize, sourceLabel, timeAgo } from "../util";

type Mode = "fr" | "en" | "bi" | "pdf";
type SideTab = "lexique" | "discussion" | "infos";

const Html = ({ html, as: Tag = "div", lang, className }: { html: string; as?: any; lang?: string; className?: string }) => (
  <Tag className={className} lang={lang} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
);

export function Reader({ id, back }: { id: string; back: Route }) {
  const { go, settings, reloadSettings, toast } = useApp();
  const [article, setArticle] = useState<Article | null>(null);
  const [content, setContent] = useState<ArticleContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("fr");
  const [tr, setTr] = useState<TranslationProgress | null>(null);
  const [side, setSide] = useState<SideTab | null>("lexique");
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [pop, setPop] = useState<{ x: number; y: number; text: string } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [openOrig, setOpenOrig] = useState<Set<string>>(new Set());
  const [activeH, setActiveH] = useState<number | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const size = settings?.readerSize ?? 19;

  // ---------------------------------------------------------------- loading
  const reloadContent = useCallback(async () => {
    try {
      setContent(await api.loadContent(id));
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  }, [id]);

  useEffect(() => {
    void (async () => {
      const a = await api.getArticle(id);
      setArticle(a ?? null);
      void api.interact({ id, type: "open" });
      await reloadContent();
    })();
    const off = api.on("translation-progress", (p) => {
      if (p.id !== id) return;
      setTr(p);
      void reloadContent();
      if (p.error) toast(`Traduction interrompue : ${p.error}`);
    });
    return off;
  }, [id, reloadContent, toast]);

  const pendingSegs = useMemo(() => {
    if (!content) return 0;
    let n = 0;
    content.blocks.forEach((b, bi) => (b.segs ?? []).forEach((s, si) => s && /[a-zA-Z]{3}/.test(plain(s)) && !content.tr[bi]?.[si] && n++));
    return n;
  }, [content]);

  // Browser-style translation: blocks entering the screen (or one screen below it) ask
  // for their untranslated passages. Translated passages carry no key, so they are
  // never requested again.
  useEffect(() => {
    if (!content || !settings?.autoTranslate || mode === "en" || mode === "pdf" || article?.lang === "fr") return;
    const root = document.getElementById("main-scroll");
    const wanted = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!wanted.size) return;
      const keys = [...wanted];
      wanted.clear();
      setTr((t) => (t && !t.finished ? t : { id, done: 0, total: keys.length }));
      void api.translateVisible(id, keys);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          for (const k of ((e.target as HTMLElement).dataset.tkeys ?? "").split(",")) if (k) wanted.add(k);
          io.unobserve(e.target);
        }
        if (wanted.size && !timer) timer = setTimeout(flush, 350);
      },
      { root, rootMargin: "0px 0px 100% 0px" },
    );
    articleRef.current?.querySelectorAll<HTMLElement>("[data-tkeys]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [content, settings?.autoTranslate, mode, id, article?.lang]);

  const translating = tr && !tr.finished;

  // ---------------------------------------------------------------- scroll, progress, dwell
  useEffect(() => {
    const el = document.getElementById("main-scroll");
    if (!el) return;
    let last = 0;
    const onScroll = () => {
      if (!restored.current) return;
      const max = el.scrollHeight - el.clientHeight;
      const r = max > 0 ? el.scrollTop / max : 0;
      setProgress(r);
      const now = Date.now();
      if (now - last > 1500) {
        last = now;
        void api.saveScroll(id, r);
        void api.interact({ id, type: "progress", value: r });
      }
      // Current section for the table of contents.
      const hs = articleRef.current?.querySelectorAll<HTMLElement>("[data-h]");
      let cur: number | null = null;
      hs?.forEach((h) => {
        if (h.getBoundingClientRect().top < 140) cur = Number(h.dataset.h);
      });
      setActiveH(cur);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [id]);

  useEffect(() => {
    if (!content || !article || restored.current) return;
    restored.current = true;
    const el = document.getElementById("main-scroll");
    const pos = article.state.scrollPos ?? 0;
    requestAnimationFrame(() => {
      if (el) el.scrollTop = pos > 0.02 ? pos * (el.scrollHeight - el.clientHeight) : 0;
    });
  }, [content, article]);

  useEffect(() => {
    // Reading time counts only while the window is focused and visible.
    let acc = 0;
    const t = setInterval(() => {
      if (document.hasFocus() && document.visibilityState === "visible") acc += 5;
      if (acc >= 30) {
        void api.interact({ id, type: "dwell", value: acc });
        acc = 0;
      }
    }, 5000);
    return () => {
      clearInterval(t);
      if (acc) void api.interact({ id, type: "dwell", value: acc });
    };
  }, [id]);

  // ---------------------------------------------------------------- selection → explain
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || text.length < 3 || !articleRef.current?.contains(sel.anchorNode)) {
        setPop(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPop({ x: rect.left + rect.width / 2, y: rect.top, text });
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  // Explanations and conversation from earlier visits come back with the article.
  const threadLoaded = useRef(false);
  useEffect(() => {
    if (!content || threadLoaded.current) return;
    threadLoaded.current = true;
    const items: ThreadItem[] = (content.explanations ?? []).map((e) => ({ kind: "explain", q: e.q, a: e.a, by: e.by, at: e.at }));
    const chat = content.chat ?? [];
    for (let i = 0; i < chat.length; i++) {
      if (chat[i].role !== "user") continue;
      const answer = chat[i + 1]?.role === "assistant" ? chat[i + 1] : undefined;
      items.push({ kind: "chat", q: chat[i].text, a: answer?.text, by: answer?.by, at: chat[i].at, err: answer ? undefined : "Pas de réponse." });
    }
    setThread(items.sort((a, b) => a.at.localeCompare(b.at)));
  }, [content]);

  const cleanError = (e: unknown) =>
    e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);

  /** Adds an entry to the thread, then fills in the answer when it arrives. */
  const runThread = async (item: ThreadItem, call: () => Promise<{ a: string; by?: string }>) => {
    setPop(null);
    setSide("discussion");
    setThread((xs) => [...xs, item]);
    const same = (x: ThreadItem) => x.at === item.at && x.q === item.q;
    try {
      const r = await call();
      setThread((xs) => xs.map((x) => (same(x) ? { ...x, a: r.a, by: r.by } : x)));
    } catch (e) {
      setThread((xs) => xs.map((x) => (same(x) ? { ...x, err: cleanError(e) } : x)));
    }
  };

  const explain = (text: string) =>
    runThread({ kind: "explain", q: text, at: new Date().toISOString() }, async () => {
      const e = await api.explain(id, text);
      return { a: e.a, by: e.by };
    });

  const explainFig = (bi: number, label: string) =>
    runThread({ kind: "explain", q: label, at: new Date().toISOString() }, async () => {
      const e = await api.explainFigure(id, bi);
      return { a: e.a, by: e.by };
    });

  const ask = (question: string) =>
    runThread({ kind: "chat", q: question, at: new Date().toISOString() }, async () => {
      const m = await api.chat(id, question);
      return { a: m.text, by: m.by };
    });

  // ---------------------------------------------------------------- actions
  const toggle = async (key: "liked" | "saved") => {
    if (!article) return;
    const on = !article.state[key];
    const type = key === "liked" ? (on ? "like" : "unlike") : on ? "save" : "unsave";
    await api.interact({ id, type });
    setArticle({ ...article, state: { ...article.state, [key]: on } });
    if (key === "liked" && on) toast("Noté : tu verras plus d'articles de ce genre.");
  };

  const setSize = async (d: number) => {
    await api.saveSettings({ readerSize: Math.min(26, Math.max(15, size + d)) });
    await reloadSettings();
  };

  const headings = useMemo(
    () =>
      (content?.blocks ?? [])
        .map((b, i) => ({ b, i }))
        .filter((x): x is { b: Extract<Block, { t: "h" }>; i: number } => x.b.t === "h" && x.b.level <= 3),
    [content],
  );

  if (error && !content) {
    return (
      <div className="page" style={{ maxWidth: 720 }}>
        <button className="btn ghost" onClick={() => go(back)}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="card section" style={{ marginTop: 24 }}>
          <h2 className="h2">{article?.titleFr ?? article?.title}</h2>
          <div className="notice warn" style={{ marginTop: 16 }}>
            {error}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => void reloadContent().then(() => setError(null))}>
              <RotateCcw size={15} /> Réessayer
            </button>
            {article && (
              <button className="btn ghost" onClick={() => void api.openExternal(article.url)}>
                <ExternalLink size={15} /> Ouvrir sur le site
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const tTitle = article?.titleFr ?? article?.title ?? "";

  const segFr = (bi: number, si: number, orig: string) => {
    const fr = content?.tr[bi]?.[si];
    return { html: fr || orig, done: !!fr };
  };

  const renderSeg = (bi: number, si: number, orig: string, Tag: any, extra?: string) => {
    const key = `${bi}:${si}`;
    if (mode === "en") return <Html as={Tag} html={orig} lang="en" className={extra} />;
    const { html, done } = segFr(bi, si, orig);
    if (mode === "bi")
      return (
        <div className="bi-row">
          <Html as={Tag} html={html} lang={done ? "fr" : "en"} className={extra} />
          <Html as={Tag} html={orig} lang="en" className={extra} />
        </div>
      );
    return (
      <>
        <Html as={Tag} html={html} lang={done ? "fr" : "en"} className={extra} />
        {done && openOrig.has(key) && <Html className="orig" html={orig} lang="en" />}
      </>
    );
  };

  const origToggle = (bi: number, si = 0) => {
    const key = `${bi}:${si}`;
    if (mode !== "fr" || !content?.tr[bi]?.[si]) return null;
    return (
      <button
        className="btn sm icon ghost orig-toggle"
        title="Voir le texte original"
        onClick={() =>
          setOpenOrig((s) => {
            const n = new Set(s);
            n.has(key) ? n.delete(key) : n.add(key);
            return n;
          })
        }
      >
        <Languages size={14} />
      </button>
    );
  };

  const pendingCls = (bi: number, si = 0) => {
    const b = content?.blocks[bi];
    const s = b?.segs?.[si];
    return mode !== "en" && translating && s && !content?.tr[bi]?.[si] ? "pending" : "";
  };

  /** Passages of a block still waiting for their translation, for the on-screen observer. */
  const tkeys = (bi: number) => {
    const b = content?.blocks[bi];
    const keys = (b?.segs ?? []).flatMap((seg, si) => (seg && /[a-zA-Z]{2}/.test(plain(seg)) && !content?.tr[bi]?.[si] ? [`${bi}:${si}`] : []));
    return keys.length ? keys.join(",") : undefined;
  };

  const renderBlock = (b: Block, bi: number) => {
    switch (b.t) {
      case "h": {
        const Tag = `h${Math.min(Math.max(b.level, 2), 6)}`;
        return (
          <div key={bi} id={`h-${bi}`} data-h={bi} data-tkeys={tkeys(bi)} className={`blk h h${Math.min(Math.max(b.level, 2), 6)} ${pendingCls(bi)}`}>
            {renderSeg(bi, 0, b.segs[0], Tag)}
          </div>
        );
      }
      case "p":
        return (
          <div key={bi} data-tkeys={tkeys(bi)} className={`blk ${pendingCls(bi)}`}>
            {renderSeg(bi, 0, b.segs[0], "p")}
            {origToggle(bi)}
          </div>
        );
      case "quote":
        return (
          <div key={bi} data-tkeys={tkeys(bi)} className={`blk ${pendingCls(bi)}`}>
            {renderSeg(bi, 0, b.segs[0], "blockquote")}
          </div>
        );
      case "li": {
        const L = b.ordered ? "ol" : "ul";
        return (
          <div key={bi} data-tkeys={tkeys(bi)} className={`blk ${pendingCls(bi)}`}>
            <L>
              {b.segs.map((s, si) => (
                <li key={si}>{renderSeg(bi, si, s, "span")}</li>
              ))}
            </L>
          </div>
        );
      }
      case "fig":
        return (
          <figure key={bi} data-tkeys={tkeys(bi)} className="blk">
            <div className="imgs">
              {b.src.map((s) => (
                <img key={s} src={s} alt={plain(b.segs[0]).slice(0, 140)} loading="lazy" onClick={() => setLightbox(s)} />
              ))}
            </div>
            {b.segs[0] && <figcaption className={pendingCls(bi)}>{renderSeg(bi, 0, b.segs[0], "span")}</figcaption>}
            <button
              className="btn sm ghost fig-explain"
              onClick={() => {
                const num = b.label?.replace(/^(fig(ure)?\.?\s*)/i, "") || String(content!.blocks.slice(0, bi + 1).filter((x) => x.t === "fig").length);
                const cap = plain(content?.tr[bi]?.[0] || b.segs[0]).slice(0, 120);
                void explainFig(bi, cap ? `Figure ${num} : ${cap}` : `Figure ${num}`);
              }}
            >
              <Lightbulb size={14} /> Expliquer cette figure
            </button>
          </figure>
        );
      case "table":
        return (
          <figure key={bi} data-tkeys={tkeys(bi)} className="blk">
            {b.segs[0] && <figcaption style={{ marginBottom: "0.8em", marginTop: 0 }}>{renderSeg(bi, 0, b.segs[0], "span")}</figcaption>}
            <Html className="table-wrap" html={b.html} lang="en" />
          </figure>
        );
      case "eq":
        return <Html key={bi} className="blk eq" html={b.html} />;
      case "code":
        return (
          <div key={bi} className="blk">
            <pre>{b.text}</pre>
          </div>
        );
      case "refs":
        return (
          <div key={bi} className="blk refs">
            <h3 style={{ fontSize: "1.3em", color: "var(--text)" }}>Références</h3>
            <ol>
              {b.items.map((r, i) => (
                <li key={i} lang="en">
                  {r}
                </li>
              ))}
            </ol>
          </div>
        );
    }
  };

  const pdfMode = mode === "pdf" && content?.pdfUrl;

  return (
    <>
      <div className="reader-bar">
        <button className="btn ghost sm" onClick={() => go(back)}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div className="grow" />
        {translating && (
          <span className="refresh-status">
            <div className="spinner" />
            Traduction {tr && tr.total ? `${Math.round((tr.done / tr.total) * 100)} %` : "…"}
          </span>
        )}
        <div className="seg" role="tablist" aria-label="Langue d'affichage" data-tour="lang-modes">
          <button className={mode === "fr" ? "active" : ""} onClick={() => setMode("fr")}>
            Français
          </button>
          {article?.lang !== "fr" && (
            <>
              <button className={mode === "bi" ? "active" : ""} onClick={() => setMode("bi")}>
                Côte à côte
              </button>
              <button className={mode === "en" ? "active" : ""} onClick={() => setMode("en")}>
                Original{article?.lang && article.lang !== "en" ? ` (${article.lang.toUpperCase()})` : ""}
              </button>
            </>
          )}
          {content?.pdfUrl && (
            <button className={mode === "pdf" ? "active" : ""} onClick={() => setMode("pdf")}>
              PDF
            </button>
          )}
        </div>
        {!translating && pendingSegs > 0 && content && article?.lang !== "fr" && (
          <button
            className="btn sm brand"
            title="Traduit tout l'article d'un coup, pour le lire plus tard. Sinon, seul ce qui s'affiche est traduit."
            onClick={() => {
              setTr({ id, done: 0, total: pendingSegs });
              void api.translate(id);
            }}
          >
            <Languages size={14} /> Tout traduire
          </button>
        )}
        <button className="btn sm icon ghost" onClick={() => void setSize(-1)} title="Texte plus petit">
          <AArrowDown size={16} />
        </button>
        <button className="btn sm icon ghost" onClick={() => void setSize(1)} title="Texte plus grand">
          <AArrowUp size={16} />
        </button>
        <button className={`btn sm icon ghost ${article?.state.liked ? "on" : ""}`} onClick={() => void toggle("liked")} title="J'aime">
          <Heart size={16} fill={article?.state.liked ? "currentColor" : "none"} />
        </button>
        <button className="btn sm icon ghost" onClick={() => void toggle("saved")} title="Lire plus tard">
          {article?.state.saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
        </button>
        <button className="btn sm" onClick={() => go({ view: "writing", articleId: id })} data-tour="write">
          <PenLine size={14} /> Écrire mon article
        </button>
        <button className={`btn sm icon ghost`} onClick={() => setSide(side ? null : "lexique")} title="Panneau latéral">
          <PanelRight size={16} />
        </button>
        <div className="progress" style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={`reader ${side ? "" : "no-side"}`}>
        <nav className="toc" aria-label="Sommaire">
          <div className="label" style={{ padding: "0 8px 8px" }}>
            Sommaire
          </div>
          {headings.map(({ b, i }) => (
            <a
              key={i}
              href={`#h-${i}`}
              className={`${b.level >= 3 ? "l3" : ""} ${activeH === i ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`h-${i}`)?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {plain(mode === "en" ? b.segs[0] : (content?.tr[i]?.[0] ?? b.segs[0]))}
            </a>
          ))}
        </nav>

        <div className={`article ${mode === "bi" ? "bi" : ""}`} ref={articleRef}>
          <div className="article-inner" style={{ ["--reader-size" as string]: `${size}px` }}>
            {article && (
              <header className="article-head">
                <div className="row wrap small">
                  <span className="tag brand">{domainLabel(article.domain)}</span>
                  <span className="muted">{sourceLabel(article)}</span>
                  <span className="muted">· {timeAgo(article.published)}</span>
                </div>
                <h1 lang={mode === "en" ? "en" : "fr"}>{mode === "en" ? article.title : tTitle}</h1>
                {mode !== "en" && article.titleFr && <p className="orig-title" lang="en">{article.title}</p>}
                <div className="authors">{article.authors.slice(0, 12).join(", ")}{article.authors.length > 12 ? "…" : ""}</div>
              </header>
            )}
            {content?.note && (
              <div className="notice" style={{ marginBottom: 28, fontSize: 14 }}>
                {content.note}
              </div>
            )}
            {!content ? (
              <div className="stack" style={{ gap: 14 }}>
                <div className="row muted small">
                  <div className="spinner" /> Récupération du texte intégral…
                </div>
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="skeleton" style={{ height: 18, width: `${70 + ((i * 37) % 30)}%` }} />
                ))}
              </div>
            ) : pdfMode ? (
              <iframe className="pdf-frame" src={`nukun://pdf/${encodeURIComponent(content.pdfUrl!)}`} title="PDF original" />
            ) : (
              content.blocks.map(renderBlock)
            )}
          </div>
        </div>

        {side && (
          <aside className="side">
            <div className="seg" style={{ width: "100%", marginBottom: 16 }} data-tour="side-tabs">
              {(["lexique", "discussion", "infos"] as SideTab[]).map((t) => (
                <button key={t} className={side === t ? "active" : ""} style={{ flex: 1 }} onClick={() => setSide(t)}>
                  {t === "lexique" ? "Lexique" : t === "discussion" ? "Discussion" : "Infos"}
                </button>
              ))}
            </div>
            {side === "lexique" && (
              <div>
                {!content?.glossary?.length ? (
                  <p className="small muted">
                    {translating ? "Le lexique arrive avec la traduction…" : "Le lexique est créé au moment de la traduction."}
                  </p>
                ) : (
                  <>
                    <p className="small muted" style={{ marginTop: 0 }}>
                      Les termes techniques de l'article. Ceux marqués « gardé » restent en anglais, comme les utilisent les spécialistes.
                    </p>
                    {content.glossary.map((g) => (
                      <div key={g.term} className="gloss">
                        <div className="row wrap" style={{ gap: 6 }}>
                          <strong lang="en">{g.term}</strong>
                          {g.keep ? <span className="tag brand">gardé</span> : <span className="muted">→ {g.fr}</span>}
                        </div>
                        <div className="muted">{g.definition}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            {side === "discussion" && (
              <Discussion
                items={thread}
                onAsk={(q) => void ask(q)}
                onClear={async () => {
                  await api.clearChat(id);
                  setThread((xs) => xs.filter((x) => x.kind === "explain"));
                }}
              />
            )}
            {side === "infos" && article && (
              <div className="stack small" style={{ gap: 12 }}>
                <div>
                  <div className="label">Publication</div>
                  <div>{article.venue ?? sourceLabel(article)}</div>
                  <div className="muted">{new Date(article.published).toLocaleDateString("fr-FR", { dateStyle: "long" })}</div>
                </div>
                <div>
                  <div className="label">Auteurs</div>
                  <div>{authorsShort(article) || "Non précisé"}</div>
                </div>
                {article.doi && (
                  <div>
                    <div className="label">DOI</div>
                    <a href={`https://doi.org/${article.doi}`} onClick={(e) => (e.preventDefault(), void api.openExternal(`https://doi.org/${article.doi}`))}>
                      {article.doi}
                    </a>
                  </div>
                )}
                {article.license && (
                  <div>
                    <div className="label">Licence</div>
                    <div>{article.license}</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Pour tes posts, cite toujours la source. Ne réutilise les figures que si la licence est de type CC BY.
                    </div>
                  </div>
                )}
                {content?.translatedBy && (
                  <div>
                    <div className="label">Traduction</div>
                    <div>{content.translatedBy}</div>
                  </div>
                )}
                <button className="btn" onClick={() => void api.openExternal(content?.originalUrl ?? article.url)}>
                  <ExternalLink size={15} /> Ouvrir sur le site officiel
                </button>
                {!translating && content && Object.keys(content.tr).length > 0 && (
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setTr({ id, done: 0, total: 1 });
                      void api.translate(id, true);
                    }}
                  >
                    <RotateCcw size={15} /> Refaire la traduction
                  </button>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {pop && (
        <div className="pop" style={{ left: pop.x, top: pop.y }} onMouseDown={(e) => e.preventDefault()}>
          <button className="btn sm brand" onClick={() => void explain(pop.text)}>
            <Lightbulb size={14} /> Expliquer
          </button>
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  );
}
