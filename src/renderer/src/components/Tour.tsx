import type React from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  { view: "feed", target: "filters", title: "Filtres", text: "Un filtre par centre d'intérêt ; « Modifier » pour en ajouter ou en retirer." },
  { view: "feed", target: "first-card", title: "Un article", text: "Clique pour le lire. Au survol : sauvegarder pour plus tard, ou « pas intéressé »." },
  { view: "feed", target: "refresh", title: "Actualiser", text: "Va chercher les derniers articles. L'app le fait aussi toute seule." },
  { view: "article", target: "lang-modes", title: "Langue", text: "Français, côte à côte ou original. Seul ce qui est à l'écran est traduit." },
  { view: "article", target: "side-tabs", title: "Lexique et discussion", text: "Les termes techniques expliqués, et une IA qui répond à tes questions sur l'article." },
  { view: "article", target: "write", title: "Ton article", text: "Rédige ce que tu as compris, puis exporte-le vers ton portfolio." },
  { view: "settings", target: "ai-modes", title: "Ton IA", text: "Choisis comment l'IA travaille. Hybride : gratuit, avec Claude pour les passages techniques." },
  { view: "settings", target: "gemini-key", title: "Clé Google gratuite", text: "Crée-la sur aistudio.google.com/apikey et colle-la ici." },
  { view: "settings", target: "ollama", title: "IA locale", text: "Ta carte graphique est détectée : installe le modèle conseillé avec Ollama." },
  { view: "settings", target: "ai-test", title: "Tester", text: "Vérifie que ton IA répond." },
  { view: "settings", target: "domains", title: "Centres d'intérêt", text: "Ajoute ou retire des sujets (même « couture » ou « football » via la recherche) et choisis les langues des articles." },
  { view: "settings", target: "sources", title: "Sources", text: "Active ou désactive chaque source scientifique." },
  { view: "feed", target: "nav", title: "Le menu", text: "Les articles de chercheurs, les Actus (science et outils de dev), ta bibliothèque, tes écrits et tes goûts." },
  { view: "feed", title: "C'est parti", text: "Bonne lecture ! Tu peux relancer cette visite depuis les Réglages." },
];

const PAD = 8;
const GAP = 12;
const W = 320;
const BUBBLE_H = 160; // estimate before the first measure

/**
 * Animated scroll done by hand: Chromium ignores smooth scrolling on an
 * `overflow: hidden` container, which is how the page is frozen during the tour.
 */
function glide(el: HTMLElement, to: number, ms = 400) {
  const from = el.scrollTop;
  const start = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.scrollTop = from + (to - from) * ease(t);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function Tour({ onDone }: { onDone: () => void }) {
  const { go, view } = useApp();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [bubbleH, setBubbleH] = useState(0);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  // Real bubble height, for exact placement.
  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight ?? 0;
    if (h && h !== bubbleH) setBubbleH(h);
  });

  useEffect(() => {
    void api.getFeed({ limit: 1 }).then((f) => setArticleId(f[0]?.article.id ?? null));
  }, []);

  // Go to the right screen, then wait for the element to appear and bring it into view.
  useEffect(() => {
    let cancelled = false;
    setRect(null);
    // Navigate only when the screen changes: navigating resets the page to the top.
    if (step.view === "article") {
      if (!articleId) return;
      if (view !== "reader") go({ view: "reader", articleId, from: { view: "feed" } });
    } else if (step.view && step.view !== view) go({ view: step.view } as Route);
    if (!step.target) return;
    const started = Date.now();
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        // The page is frozen (overflow hidden), so the tour scrolls it itself.
        const main = document.getElementById("main-scroll");
        if (main && main.contains(el)) {
          const r = el.getBoundingClientRect();
          const m = main.getBoundingClientRect();
          // Centre the zone and its bubble together; a zone taller than the screen
          // is framed from its top instead.
          const block = r.height + BUBBLE_H + GAP;
          const offset = block < main.clientHeight - 32 ? (main.clientHeight - block) / 2 : 24;
          const top = main.scrollTop + r.top - m.top - offset;
          glide(main, Math.min(Math.max(0, top), main.scrollHeight - main.clientHeight));
        }
        setTimeout(() => !cancelled && setRect(el.getBoundingClientRect()), 480);
      } else if (Date.now() - started < 4000) setTimeout(find, 150);
    };
    // Let the new screen render before looking for the element.
    setTimeout(find, 80);
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

  // The page is frozen during the tour: only the tour moves it (wheel, keys and the
  // scrollbar are blocked). Escape leaves the tour at any time.
  useEffect(() => {
    const main = document.getElementById("main-scroll");
    main?.classList.add("tour-frozen");
    const block = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".tour-bubble")) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (!typing && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.preventDefault();
    };
    window.addEventListener("wheel", block, { passive: false, capture: true });
    window.addEventListener("touchmove", block, { passive: false, capture: true });
    window.addEventListener("keydown", keys, { capture: true });
    return () => {
      main?.classList.remove("tour-frozen");
      window.removeEventListener("wheel", block, { capture: true });
      window.removeEventListener("touchmove", block, { capture: true });
      window.removeEventListener("keydown", keys, { capture: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the visible part of the zone is lit (a tall section may overflow the screen).
  // Below the title bar for page content; the title bar itself (menu) can be lit too.
  const inPage = !!document.getElementById("main-scroll")?.contains(document.querySelector(`[data-tour="${step.target}"]`));
  const TOP = inPage ? 56 : 0;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spot =
    rect && step.target
      ? { left: rect.left, right: rect.right, top: Math.max(rect.top, TOP), bottom: Math.min(rect.bottom, vh - 16) }
      : null;

  // Bubble: below the zone, else above, else beside it, else inside its lower part;
  // always kept fully on screen.
  const bh = bubbleH || BUBBLE_H;
  let pos = { left: (vw - W) / 2, top: (vh - bh) / 2 };
  if (spot && spot.bottom > spot.top) {
    const cx = Math.min(Math.max(16, (spot.left + spot.right) / 2 - W / 2), vw - W - 16);
    const cy = Math.min(Math.max(TOP, (spot.top + spot.bottom) / 2 - bh / 2), vh - bh - 16);
    if (spot.bottom + PAD + GAP + bh <= vh - 16) pos = { left: cx, top: spot.bottom + PAD + GAP };
    else if (spot.top - PAD - GAP - bh >= TOP) pos = { left: cx, top: spot.top - PAD - GAP - bh };
    else if (spot.right + PAD + GAP + W <= vw - 16) pos = { left: spot.right + PAD + GAP, top: cy };
    else if (spot.left - PAD - GAP - W >= 16) pos = { left: spot.left - PAD - GAP - W, top: cy };
    else pos = { left: Math.min(spot.right - W - 24, vw - W - 16), top: spot.bottom - bh - 24 };
    pos.left = Math.min(Math.max(16, pos.left), vw - W - 16);
    pos.top = Math.min(Math.max(TOP, pos.top), vh - bh - 16);
  }

  return (
    <div className="tour" aria-live="polite">
      <button className="btn tour-skip" onClick={close}>
        <X size={15} /> Passer la visite <kbd>Échap</kbd>
      </button>
      {spot ? (
        <div
          key="spot"
          className="tour-spot"
          style={{
            left: spot.left - PAD,
            top: spot.top - PAD,
            width: spot.right - spot.left + PAD * 2,
            height: Math.max(0, spot.bottom - spot.top) + PAD * 2,
          }}
        />
      ) : (
        <div key="dim" className="tour-dim" />
      )}
      <div ref={bubbleRef} className="tour-bubble card" style={{ left: pos.left, top: pos.top, width: W }} role="dialog" aria-label={step.title}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{step.title}</strong>
          <button className="btn sm icon ghost" onClick={close} title="Quitter la visite" aria-label="Quitter la visite">
            <X size={15} />
          </button>
        </div>
        <p>{step.text}</p>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 4 }}>
            <span className="small muted">
              {i + 1}/{STEPS.length}
            </span>
            {i < STEPS.length - 1 && (
              <button className="btn sm ghost" onClick={close}>
                Passer la visite
              </button>
            )}
          </div>
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
