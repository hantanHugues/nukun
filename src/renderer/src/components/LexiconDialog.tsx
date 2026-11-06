import { useEffect, useState } from "react";
import type { LexiconProposal } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";

/** What would be sent, shown in full before the reader agrees to share. */
export function LexiconDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [p, setP] = useState<LexiconProposal | null>(null);

  useEffect(() => {
    void api.lexiconPrepare().then(setP);
    // Escape closes this window only, not the page behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const any = !!p && p.terms.length > 0;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="lexicon-title">
        <h2 className="h2" id="lexicon-title">
          {t("Partager mes termes avec les autres lecteurs")}
        </h2>
        <p>{t("Ces termes techniques (noms, sigles, jargon) aideront les autres lecteurs, après vérification.")}</p>
        <p className="small muted">
          {t("Seuls les termes et leurs définitions sont envoyés : jamais tes articles, tes notes ni ton nom.")}
        </p>
        {p && any && (
          <>
            <p className="small muted">
              {p.total > p.terms.length
                ? t("{total} termes prêts, voici les {n} premiers.", { total: p.total, n: p.terms.length })
                : t("{n} termes prêts à partir :", { n: p.total })}
            </p>
            <ul className="lex-list">
              {p.terms.map((x, i) => (
                <li key={p.keys[i]}>
                  <strong>{x.term}</strong>
                  <span title={x.definition}>{x.definition}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {p && !any && <p className="small muted">{t("Aucun terme n'est prêt pour l'instant : le partage enverra les prochains que Nùkún apprendra.")}</p>}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>
            {t("Annuler")}
          </button>
          <button
            className="btn primary"
            autoFocus
            disabled={!p}
            onClick={async () => {
              await api.lexiconShare();
              onDone();
            }}
          >
            {t("Partager mes termes")}
          </button>
        </div>
      </div>
    </div>
  );
}
