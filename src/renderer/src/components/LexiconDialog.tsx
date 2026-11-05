import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { LexiconProposal } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";

/** The terms about to be proposed, shown in full before anything opens. */
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
          {t("Proposer mes termes au lexique commun")}
        </h2>
        {p && !any && <p>{t("Aucun nouveau terme à proposer pour l'instant.")}</p>}
        {p && any && (
          <>
            <p>
              {t("En traduisant tes articles, Nùkún a appris {n} termes techniques. Si tu les proposes, ils seront relus puis pourront servir à tous les lecteurs.", { n: p.total })}
            </p>
            <p className="small muted">
              {t("Un message GitHub s'ouvre avec ces termes déjà écrits. Rien n'est envoyé tant que tu ne cliques pas sur « Submit new issue » sur GitHub. Il faut un compte GitHub gratuit, et le message sera public, avec ton nom d'utilisateur GitHub.")}
            </p>
            {p.method === "clipboard" && (
              <p className="small muted">{t("Il y a beaucoup de termes : ils sont copiés dans ton presse-papiers. Colle-les (Ctrl+V) dans le message GitHub.")}</p>
            )}
            {p.total > p.terms.length && (
              <p className="small muted">{t("{n} termes sur {total} dans ce message, le reste viendra une prochaine fois.", { n: p.terms.length, total: p.total })}</p>
            )}
            <ul className="lex-list">
              {p.terms.map((x, i) => (
                <li key={p.keys[i]}>
                  <strong>{x.term}</strong>
                  <span>{x.translation ?? t("(gardé en anglais)")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>
            {t("Annuler")}
          </button>
          {any && (
            <button
              className="btn primary"
              autoFocus
              onClick={async () => {
                await api.lexiconOpen(p.keys);
                onDone();
              }}
            >
              <ExternalLink size={15} /> {t("Ouvrir GitHub")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
