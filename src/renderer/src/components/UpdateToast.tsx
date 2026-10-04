import { Download, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";
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
            <strong>Nùkún {u.version} est prête</strong>
            <div className="small muted">Elle s'installe en redémarrant l'app, sinon à la prochaine fermeture.</div>
          </>
        )}
        {u.status === "available" && (
          <>
            <strong>Nouvelle version : Nùkún {u.version}</strong>
            <div className="small muted">Économie de données active : elle n'est téléchargée que si tu le demandes.</div>
          </>
        )}
        {u.status === "downloading" && (
          <>
            <strong>Téléchargement de Nùkún {u.version}…</strong>
            <div className="small muted">{u.percent ?? 0} %</div>
          </>
        )}
      </div>
      {u.status === "ready" && (
        <button className="btn sm primary" onClick={() => void api.installUpdate()}>
          <RefreshCw size={14} /> Mettre à jour
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
          <Download size={14} /> Télécharger
        </button>
      )}
      {u.status !== "downloading" && (
        <button className="btn sm ghost icon" aria-label="Plus tard" title="Plus tard" onClick={() => setHidden(key)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
