import { Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";
import { t } from "@shared/i18n";
import { api } from "../api";

/** A new version: a small window at the bottom of the screen. */
export function UpdateToast() {
  const [u, setU] = useState<UpdateState>({ status: "idle" });
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    void api.updateState().then(setU);
    return api.on("update-state", setU);
  }, []);

  // "Plus tard" hides it until something new happens.
  const key = `${u.status}:${u.version}`;
  if (u.status === "idle" || hidden === key) return null;
  // While downloading on its own, it says nothing; it speaks once ready.
  if (u.status === "downloading" && hidden !== "asked") return null;

  return (
    <div className="update-toast card" role="status">
      <div className="grow">
        {u.status === "ready" && (
          <>
            <strong>{t("Nùkún {v} est prête", { v: u.version ?? "" })}</strong>
            <div className="small muted">{t("L'app redémarre à jour. « Plus tard » : elle te sera reproposée au prochain lancement.")}</div>
          </>
        )}
        {u.status === "available" && (
          <>
            <strong>{t("Nouvelle version : Nùkún {v}", { v: u.version ?? "" })}</strong>
            <div className="small muted">{t("Économie de données active : elle n'est téléchargée que si tu le demandes.")}</div>
          </>
        )}
        {u.status === "downloading" && (
          <>
            <strong>{t("Téléchargement de Nùkún {v}…", { v: u.version ?? "" })}</strong>
            <div className="small muted">{u.percent ?? 0} %</div>
          </>
        )}
      </div>
      {u.status === "ready" && (
        <button className="btn sm primary" onClick={() => void api.installUpdate()}>
          <RefreshCw size={14} /> {t("Mettre à jour")}
        </button>
      )}
      {u.status === "available" && (
        <button
          className="btn sm primary"
          onClick={() => {
            setHidden("asked");
            void api.downloadUpdate();
          }}
        >
          <Download size={14} /> {t("Télécharger")}
        </button>
      )}
      {u.status !== "downloading" && (
        <button className="btn sm ghost icon" aria-label={t("Plus tard")} title={t("Plus tard")} onClick={() => setHidden(key)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
