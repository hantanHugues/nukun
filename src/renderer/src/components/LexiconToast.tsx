import { useEffect, useState } from "react";
import type { LexiconStatus } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";
import { LexiconDialog } from "./LexiconDialog";

/**
 * Once a week, when enough terms are waiting: asks whether to propose them to the shared
 * lexicon. On the left of the screen, so it never covers the update window.
 */
export function LexiconToast() {
  const [st, setSt] = useState<LexiconStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // A little after the launch, once the app is calm, and never while an update is on offer.
    const id = setTimeout(async () => {
      const [s, u] = await Promise.all([api.lexiconStatus(), api.updateState()]);
      if (!s.due || u.status !== "idle") return;
      setSt(s);
      // One reminder a week, even if this one is ignored.
      void api.lexiconShown();
    }, 25000);
    return () => clearTimeout(id);
  }, []);

  const close = () => {
    setOpen(false);
    setHidden(true);
  };
  if (open) return <LexiconDialog onClose={close} onDone={close} />;
  if (!st || hidden) return null;

  return (
    <div className="update-toast lexicon-toast card" role="status">
      <div className="grow">
        <strong>{t("Aide à enrichir le lexique commun")}</strong>
        <div className="small muted">{t("Nùkún a appris {n} termes en traduisant tes articles. Veux-tu les partager avec les autres lecteurs ?", { n: st.pending })}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm primary" onClick={() => setOpen(true)}>
            {t("Voir et partager")}
          </button>
          <button className="btn sm ghost" onClick={() => setHidden(true)}>
            {t("Plus tard")}
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              void api.lexiconRemind(false);
              setHidden(true);
            }}
          >
            {t("Non merci")}
          </button>
        </div>
      </div>
    </div>
  );
}
