import { marked } from "marked";
import { BookOpen, Copy, FileDown, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Article, Draft, Note } from "@shared/types";
import { Notes } from "../components/Notes";
import { api } from "../api";
import { useApp } from "../App";
import { sanitize, timeAgo } from "../util";

const TEMPLATE = `## De quoi parle cet article ?

Explique en 2 ou 3 phrases, avec tes mots, la question que se posent les chercheurs.

## Ce qu'ils ont fait

## Ce qu'ils ont trouvé

## Mon avis

Ce qui m'a surpris, ce que j'en retiens, les limites que je vois.

## Pourquoi c'est important
`;

export function Writing({ articleId }: { articleId?: string }) {
  const { go, toast, settings } = useApp();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [articles, setArticles] = useState<Record<string, Article>>({});
  const [current, setCurrent] = useState<string | undefined>(articleId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [rightPane, setRightPane] = useState<"notes" | "preview">("preview");
  const [noteCount, setNoteCount] = useState(0);
  // The notes come first when the article has some.
  useEffect(() => {
    if (!current) return;
    void api.getNotes(current).then((ns) => {
      setNoteCount(ns.length);
      setRightPane(ns.length ? "notes" : "preview");
    });
  }, [current]);

  /** A note goes where the cursor is: the passage as a quote, then the comment. */
  const insertNote = (n: Note) => {
    if (!draft) return;
    const piece = `${n.quote ? `> ${n.quote.replace(/\n+/g, " ")}\n\n` : ""}${n.text ? `${n.text}\n\n` : ""}`;
    const el = editor.current;
    const at = el ? el.selectionStart : draft.body.length;
    update({ body: draft.body.slice(0, at) + piece + draft.body.slice(at) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + piece.length;
    });
  };

  const loadList = async () => {
    const ds = await api.listDrafts();
    setDrafts(ds);
    const ids = new Set([...ds.map((d) => d.articleId), ...(current ? [current] : [])]);
    const arts: Record<string, Article> = {};
    for (const id of ids) {
      const a = await api.getArticle(id);
      if (a) arts[id] = a;
    }
    setArticles(arts);
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!current) {
      setDraft(null);
      return;
    }
    void (async () => {
      const existing = await api.getDraft(current);
      const a = articles[current] ?? (await api.getArticle(current));
      setDraft(
        existing ?? {
          articleId: current,
          title: a?.titleFr ?? a?.title ?? "",
          summary: "",
          tags: "",
          body: TEMPLATE,
          updatedAt: new Date().toISOString(),
        },
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const update = (patch: Partial<Draft>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.saveDraft(next).then(loadList);
    }, 600);
  };

  const preview = useMemo(() => sanitize(marked.parse(draft?.body ?? "", { async: false }) as string), [draft?.body]);
  const a = current ? articles[current] : undefined;

  const exportMdx = async () => {
    if (!draft) return;
    await api.saveDraft(draft);
    try {
      const file = await api.exportDraft(draft.articleId);
      toast(`Exporté : ${file}`);
      void loadList();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const copyPost = async () => {
    if (!draft || !a) return;
    const text = `${draft.title}\n\n${draft.summary ? `${draft.summary}\n\n` : ""}${draft.body
      .replace(/^#+\s*/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .trim()}\n\nSource : ${a.title} (${a.venue ?? ""}) ${a.url}`;
    await navigator.clipboard.writeText(text);
    toast("Texte copié : prêt à coller sur LinkedIn ou ailleurs.");
  };

  return (
    <div className="page">
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">Mes articles</span>
        <h1 className="display">Ta compréhension, avec tes mots.</h1>
      </div>
      <div className="writer">
        <div className="card" style={{ padding: 8 }}>
          {drafts.length === 0 && !current && (
            <p className="small muted" style={{ padding: 12 }}>
              Ouvre un article et clique sur « Écrire mon article » pour commencer un brouillon.
            </p>
          )}
          <div className="list">
            {current && !drafts.some((d) => d.articleId === current) && (
              <div className="list-item" style={{ background: "var(--surface-hover)" }}>
                <div className="stack grow" style={{ gap: 4 }}>
                  <div className="title small">{draft?.title || "Nouveau brouillon"}</div>
                  <div className="small muted">Nouveau</div>
                </div>
              </div>
            )}
            {drafts.map((d) => (
              <div
                key={d.articleId}
                className="list-item"
                style={d.articleId === current ? { background: "var(--surface-hover)" } : undefined}
                onClick={() => setCurrent(d.articleId)}
              >
                <div className="stack grow" style={{ gap: 4 }}>
                  <div className="title small">{d.title || "Sans titre"}</div>
                  <div className="small muted">
                    {d.exportedPath ? "Exporté · " : ""}modifié {timeAgo(d.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {draft ? (
          <div className="stack" style={{ gap: 16 }}>
            {a && (
              <div className="row small wrap" style={{ gap: 10 }}>
                <span className="muted grow">D'après « {a.titleFr ?? a.title} »</span>
                {/* Back to the article and back again: Escape or "Retour à mon texte". */}
                <button className="btn sm" onClick={() => go({ view: "reader", articleId: a.id, from: { view: "writing", articleId: a.id } })}>
                  <BookOpen size={14} /> Relire l'article
                </button>
              </div>
            )}
            <input className="input" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }} value={draft.title} placeholder="Titre de ton article" onChange={(e) => update({ title: e.target.value })} />
            <div className="row" style={{ gap: 12 }}>
              <input className="input grow" value={draft.summary} placeholder="Résumé en une phrase (affiché sur ton portfolio)" onChange={(e) => update({ summary: e.target.value })} />
              <input className="input" style={{ maxWidth: 240 }} value={draft.tags} placeholder="Tags, séparés par des virgules" onChange={(e) => update({ tags: e.target.value })} />
            </div>
            <div className="editor-grid">
              <textarea ref={editor} className="textarea" style={{ minHeight: 520, fontFamily: "var(--font-mono)", fontSize: 14 }} value={draft.body} onChange={(e) => update({ body: e.target.value })} spellCheck lang="fr" />
              {/* Next to the text: the preview, or the notes taken while reading. */}
              <div className="stack" style={{ gap: 10 }}>
                <div className="seg" style={{ alignSelf: "flex-start" }}>
                  <button className={rightPane === "notes" ? "active" : ""} onClick={() => setRightPane("notes")}>
                    Mes notes{noteCount ? ` (${noteCount})` : ""}
                  </button>
                  <button className={rightPane === "preview" ? "active" : ""} onClick={() => setRightPane("preview")}>
                    Aperçu
                  </button>
                </div>
                {rightPane === "notes" ? (
                  <div className="card writing-notes">
                    <Notes articleId={draft.articleId} onInsert={insertNote} />
                  </div>
                ) : (
                  <div className="card preview" dangerouslySetInnerHTML={{ __html: preview }} />
                )}
              </div>
            </div>
            <div className="row wrap">
              <button className="btn primary" onClick={() => void exportMdx()}>
                <FileDown size={15} /> Exporter pour le portfolio (.mdx)
              </button>
              <button className="btn" onClick={() => void copyPost()}>
                <Copy size={15} /> Copier pour un post
              </button>
              <div className="grow" />
              <span className="small muted row">
                <FolderOpen size={14} /> {settings?.exportDir}
              </span>
            </div>
          </div>
        ) : (
          <div className="card empty">Choisis un brouillon à gauche, ou ouvre un article pour en commencer un.</div>
        )}
      </div>
    </div>
  );
}
