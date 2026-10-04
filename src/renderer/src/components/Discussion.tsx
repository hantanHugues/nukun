import { marked } from "marked";
import { Lightbulb, MessageCircle, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "@shared/i18n";
import { sanitize } from "../util";

/** One entry of the conversation: an explanation of a selected passage, or a question. */
export interface ThreadItem {
  kind: "explain" | "chat";
  q: string;
  a?: string;
  by?: string;
  err?: string;
  at: string;
}

const SUGGESTIONS = [
  "Résume-moi cet article simplement",
  "Quelle est la découverte principale ?",
  "Comment ont-ils fait leur étude ?",
  "Quelles sont les limites de ce travail ?",
  "Pourquoi c'est important ?",
];

const md = (text: string) => sanitize(marked.parse(text, { async: false }) as string);

export function Discussion({
  items,
  onAsk,
  onClear,
}: {
  items: ThreadItem[];
  onAsk: (question: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = items.some((x) => !x.a && !x.err);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  const send = (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    onAsk(text);
    setDraft("");
  };

  return (
    <div className="discussion">
      <div className="thread">
        {!items.length && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="notice">
              <MessageCircle size={18} style={{ flex: "none" }} />
              <span>
                {t("Pose une question sur l'article : l'IA te répond à partir de son texte. Tu peux aussi sélectionner un passage et cliquer sur « Expliquer ».")}
              </span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(t(s))}>
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((x, i) =>
          x.kind === "explain" ? (
            <div key={i} className="card" style={{ padding: 14 }}>
              <div className="row small muted" style={{ gap: 6, marginBottom: 8 }}>
                <Lightbulb size={13} /> {t("Explication du passage")}
              </div>
              <div className="small muted" style={{ fontStyle: "italic", marginBottom: 8 }}>
                « {x.q.length > 220 ? `${x.q.slice(0, 220)}…` : x.q} »
              </div>
              <Answer item={x} />
            </div>
          ) : (
            <div key={i} className="stack" style={{ gap: 8 }}>
              <div className="bubble user">{x.q}</div>
              <div className="bubble ai">
                <Answer item={x} />
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          className="textarea"
          rows={2}
          value={draft}
          placeholder={t("Pose ta question sur l'article…")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="row" style={{ justifyContent: "space-between" }}>
          {items.some((x) => x.kind === "chat") ? (
            <button className="btn sm ghost" onClick={onClear} title={t("Effacer la conversation (les explications restent)")}>
              <Trash2 size={14} /> {t("Effacer")}
            </button>
          ) : (
            <span className="small muted">{t("Entrée pour envoyer")}</span>
          )}
          <button className="btn sm primary" onClick={() => send(draft)} disabled={!draft.trim() || busy}>
            <SendHorizontal size={14} /> {t("Envoyer")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Answer({ item }: { item: ThreadItem }) {
  if (item.err) return <div className="notice warn">{item.err}</div>;
  if (!item.a)
    return (
      <div className="row small muted">
        <div className="spinner" /> {t("Réflexion…")}
      </div>
    );
  return (
    <>
      <div className="explain md" dangerouslySetInnerHTML={{ __html: md(item.a) }} />
      {item.by && (
        <div className="small muted" style={{ marginTop: 8 }}>
          {t("Répondu par : {qui}", { qui: item.by })}
        </div>
      )}
    </>
  );
}
