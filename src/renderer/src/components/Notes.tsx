import { CornerDownLeft, Plus, Quote, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Note } from "@shared/types";
import { api } from "../api";
import { timeAgo } from "../util";

/**
 * Notes on one article: written while reading (an idea, or a passage kept with
 * "Noter"), found again next to the editor when writing about the article.
 */
export function Notes({
  articleId,
  quote,
  onQuoteUsed,
  onInsert,
}: {
  articleId: string;
  /** A passage selected in the article, waiting for an optional comment. */
  quote?: string | null;
  onQuoteUsed?: () => void;
  /** In the editor: put a note into the text being written. */
  onInsert?: (n: Note) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api.getNotes(articleId).then(setNotes);
  }, [articleId]);

  // A passage arrives: ready for a comment.
  useEffect(() => {
    if (quote) input.current?.focus();
  }, [quote]);

  const add = async () => {
    if (!text.trim() && !quote) return;
    const n: Note = { id: crypto.randomUUID(), quote: quote ?? undefined, text: text.trim(), at: new Date().toISOString() };
    setNotes(await api.saveNote(articleId, n));
    setText("");
    onQuoteUsed?.();
  };

  const remove = async (n: Note) => {
    setNotes(await api.deleteNote(articleId, n.id));
  };

  return (
    <div className="notes">
      <div className="note-composer">
        {quote && (
          <div className="note-quote">
            <Quote size={13} />
            <span>{quote}</span>
            <button className="chip-x" aria-label="Retirer la citation" onClick={onQuoteUsed}>
              <X size={12} />
            </button>
          </div>
        )}
        <textarea
          ref={input}
          className="textarea"
          rows={3}
          value={text}
          placeholder={quote ? "Ton commentaire (facultatif)…" : "Une idée, une question, ce qui t'a plu…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter keeps the note, Shift+Enter goes to the next line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <button className="btn sm primary" onClick={() => void add()} disabled={!text.trim() && !quote}>
          <Plus size={14} /> {quote ? "Garder la citation" : "Ajouter la note"}
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="small muted">
          Pas encore de notes. Écris une idée ci-dessus, ou sélectionne un passage de l'article puis « Noter ».
        </p>
      ) : (
        [...notes].reverse().map((n) => (
          <div key={n.id} className="note">
            {n.quote && <blockquote>{n.quote}</blockquote>}
            {n.text && <div className="note-text">{n.text}</div>}
            <div className="row small muted" style={{ gap: 6 }}>
              <span className="grow">{timeAgo(n.at)}</span>
              {onInsert && (
                <button className="btn sm ghost" onClick={() => onInsert(n)} title="Insérer dans ton texte">
                  <CornerDownLeft size={13} /> Insérer
                </button>
              )}
              <button className="btn sm ghost icon" aria-label="Supprimer la note" title="Supprimer la note" onClick={() => void remove(n)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
