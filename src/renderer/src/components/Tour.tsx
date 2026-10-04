import type React from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { api } from "../api";
import { type Route, useApp } from "../App";

/**
 * First-run guided tour: a spotlight on the real part of the screen and a short bubble
 * explaining what it is for. Highlighted controls stay usable (e.g. paste a key).
 */
interface Step {
  /** Screen to show first; "article" opens the first article of the feed. */
  view?: Route["view"] | "article";
  /** `data-tour` name of the element to highlight; none = centered bubble. */
  target?: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { view: "feed", title: "Bienvenue", text: "En 1 minute, on fait le tour de l'app. Tu peux quitter à tout moment." },
  { view: "feed", target: "filters", title: "Tes domaines", text: "Filtre ton fil : informatique, robotique, physique, biologie, psychologie…" },
  { view: "feed", target: "first-card", title: "Un article", text: "Clique pour le lire. Au survol : sauvegarder pour plus tard, ou « pas intéressé »." },
  { view: "feed", target: "refresh", title: "Actualiser", text: "Va chercher les derniers articles. L'app le fait aussi toute seule." },
  { view: "article", target: "lang-modes", title: "Langue", text: "Français, côte à côte ou original. Seul ce qui est à l'écran est traduit." },
  { view: "article", target: "side-tabs", title: "Lexique et discussion", text: "Les termes techniques expliqués, et une IA qui répond à tes questions sur l'article." },
  { view: "article", target: "write", title: "Ton article", text: "Rédige ce que tu as compris, puis exporte-le vers ton portfolio." },
  { view: "settings", target: "ai-modes", title: "Ton IA", text: "Choisis comment l'IA travaille. Hybride : gratuit, avec Claude pour les passages techniques." },
  { view: "settings", target: "gemini-key", title: "Clé Google gratuite", text: "Crée-la sur aistudio.google.com/apikey et colle-la ici." },
  { view: "settings", target: "ollama", title: "IA locale", text: "Ta carte graphique est détectée : installe le modèle conseillé avec Ollama." },
  { view: "settings", target: "ai-test", title: "Tester", text: "Vérifie que ton IA répond." },
  { view: "settings", target: "domains", title: "Domaines", text: "Active ou désactive les domaines de ton fil." },
  { view: "settings", target: "sources", title: "Sources", text: "Active ou désactive chaque source scientifique." },
  { view: "feed", target: "nav", title: "Le menu", text: "Ta bibliothèque, tes articles, et ce que l'algorithme a compris de tes goûts." },
  { view: "feed", title: "C'est parti", text: "Bonne lecture ! Tu peux relancer cette visite depuis les Réglages." },
];

const PAD = 8;

export function Tour({ onDone }: { onDone: () => void }) {
  const { go } = useApp();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    void api.getFeed({ limit: 1 }).then((f) => setArticleId(f[0]?.article.id ?? null));
  }, []);

  // Go to the right screen, then wait for the element to appear and bring it into view.
  useEffect(() => {
    let cancelled = false;
    setRect(null);
    if (step.view === "article") {
      if (!articleId) return;
      go({ view: "reader", articleId, from: { view: "feed" } });
    } else if (step.view) go({ view: step.view } as Route);
    if (!step.target) return;
    const started = Date.now();
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => !cancelled && setRect(el.getBoundingClientRect()), 350);
      } else if (Date.now() - started < 4000) setTimeout(find, 150);
    };
    find();
    return () => {
      cancelled = true;
    };
  }, [i, articleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the element when the window is resized or the page scrolls.
  useLayoutEffect(() => {
    if (!step.target) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    document.getElementById("main-scroll")?.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      document.getElementById("main-scroll")?.removeEventListener("scroll", update);
    };
  }, [step.target]);

  const close = () => {
    go({ view: "feed" });
    onDone();
  };
  const next = () => {
    // Without any article yet, the reading steps are skipped.
    let n = i + 1;
    while (n < STEPS.length && STEPS[n].view === "article" && !articleId) n++;
    if (n >= STEPS.length) close();
    else setI(n);
  };
  const prev = () => {
    let n = i - 1;
    while (n > 0 && STEPS[n].view === "article" && !articleId) n--;
    setI(Math.max(0, n));
  };

  // Bubble next to the highlighted zone: below it if there is room, else above.
  const W = 320;
  let bubble: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect && step.target) {
    const below = rect.bottom + 180 < window.innerHeight;
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - W / 2), window.innerWidth - W - 16);
    bubble = below ? { left, top: rect.bottom + PAD + 12 } : { left, top: Math.max(16, rect.top - PAD - 12), transform: "translateY(-100%)" };
  }

  return (
    <div className="tour" aria-live="polite">
      {rect && step.target ? (
        <div
          className="tour-spot"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-bubble card" style={{ ...bubble, width: W }} role="dialog" aria-label={step.title}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{step.title}</strong>
          <button className="btn sm icon ghost" onClick={close} title="Quitter la visite" aria-label="Quitter la visite">
            <X size={15} />
          </button>
        </div>
        <p>{step.text}</p>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small muted">
            {i + 1}/{STEPS.length}
          </span>
          <div className="row" style={{ gap: 6 }}>
            {i > 0 && (
              <button className="btn sm ghost" onClick={prev}>
                <ArrowLeft size={14} />
              </button>
            )}
            <button className="btn sm primary" onClick={next}>
              {i === STEPS.length - 1 ? "Terminer" : "Suivant"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
