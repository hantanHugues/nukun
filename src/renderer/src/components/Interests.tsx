import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Interest, TopicHit } from "@shared/types";
import { fieldLabel, LANGUAGES } from "@shared/types";
import { INTEREST_CATALOG, INTEREST_GROUPS } from "@shared/interests";
import { lang, t } from "@shared/i18n";
import { api } from "../api";
import { useApp } from "../App";

/** Minimum number of interests before the feed can start. */
export const MIN_INTERESTS = 3;

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

/**
 * The reader's interests: catalogue bubbles, a free search for anything else
 * ("couture", "football"…) answered by the research topics of OpenAlex, and the
 * languages of the articles. Used at first launch and in the settings.
 */
export function InterestsEditor({
  interests,
  languages,
  onChange,
}: {
  interests: Interest[];
  languages: Record<string, boolean>;
  onChange: (interests: Interest[], languages: Record<string, boolean>) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TopicHit[] | null>(null);
  /** The text the results answer (the field may have changed since). */
  const [hitsFor, setHitsFor] = useState("");
  const latest = useRef("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = new Set(interests.map((i) => i.id));
  const toggle = (i: Interest) =>
    onChange(chosen.has(i.id) ? interests.filter((x) => x.id !== i.id) : [...interests, i], languages);

  const search = async () => {
    const text = q.trim();
    if (!text) return;
    // A catalogue interest with that name: just pick it.
    const known = INTEREST_CATALOG.find((i) => strip(t(i.label)).includes(strip(text)) || strip(i.label).includes(strip(text)));
    latest.current = text;
    setSearching(true);
    setError(null);
    setHits(null);
    try {
      const found = await api.searchTopics(text);
      if (latest.current !== text) return; // a newer search is running
      setHits(found);
      setHitsFor(text);
      // The topic with the most papers is usually the right one.
      setPicked(new Set(found.slice(0, 1).map((h) => h.id)));
      if (known && !chosen.has(known.id)) toggle(known);
    } catch {
      if (latest.current === text) setError(t("Recherche impossible pour l'instant (connexion ?)."));
    } finally {
      if (latest.current === text) setSearching(false);
    }
  };

  const addCustom = () => {
    const topics = hits?.filter((h) => picked.has(h.id)) ?? [];
    if (!topics.length) return;
    const label = hitsFor.charAt(0).toUpperCase() + hitsFor.slice(1);
    const interest: Interest = {
      id: `c:${strip(label).replace(/[^a-z0-9]+/g, "-")}`,
      label,
      fields: [...new Set(topics.map((tp) => tp.field))],
      topics: topics.map((tp) => tp.id),
      keywords: [label, ...topics.map((tp) => tp.name)],
      news: [],
      custom: true,
    };
    onChange([...interests.filter((i) => i.id !== interest.id), interest], languages);
    setQ("");
    setHits(null);
    setHitsFor("");
  };

  const custom = interests.filter((i) => i.custom);

  return (
    <div className="interests">
      {INTEREST_GROUPS.map((g) => (
        <div key={g.id} className="field">
          <label>{t(g.label)}</label>
          <div className="row wrap" style={{ gap: 8 }}>
            {INTEREST_CATALOG.filter((i) => i.group === g.id).map(({ group: _g, ...i }) => {
              const on = chosen.has(i.id);
              return (
                <button key={i.id} className={`chip bubble ${on ? "active" : ""}`} aria-pressed={on} onClick={() => toggle(i)}>
                  {on && <Check size={13} />} {t(i.label)}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="field">
        <label htmlFor="interest-search">{t("Autre chose ?")}</label>
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            id="interest-search"
            className="input grow"
            placeholder={t("Couture, football, cuisine, MQTT… dans n'importe quelle langue")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!q.trim()}>
            {searching ? <div className="spinner" /> : <Search size={15} />} {t("Chercher")}
          </button>
        </form>
        {error && <span className="small muted">{error}</span>}
        {hits && (
          <div className="topic-hits">
            {hits.length === 0 ? (
              <span className="small muted">{t("Aucun sujet de recherche trouvé pour « {q} ».", { q: hitsFor })}</span>
            ) : (
              <>
                <span className="small muted">
                  {t("Sujets de recherche trouvés pour « {q} » : coche ceux qui correspondent à ce que tu cherches.", { q: hitsFor })}
                </span>
                <div className="row wrap" style={{ gap: 6 }}>
                  {hits.map((h) => {
                    const on = picked.has(h.id);
                    return (
                      <button
                        key={h.id}
                        className={`chip ${on ? "active" : ""}`}
                        aria-pressed={on}
                        title={`${h.name} · ${fieldLabel(h.field)} · ${t("{n} articles récents", { n: h.count })}`}
                        onClick={() => {
                          const next = new Set(picked);
                          if (on) next.delete(h.id);
                          else next.add(h.id);
                          setPicked(next);
                        }}
                      >
                        {on && <Check size={13} />} {h.nameFr ?? h.name}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <button className="btn primary sm" onClick={addCustom} disabled={!picked.size}>
                    <Plus size={14} /> {t("Ajouter « {q} »", { q: hitsFor })}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {custom.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {custom.map((i) => (
              <span key={i.id} className="chip active">
                {i.label}
                <button className="chip-x" aria-label={t("Retirer {label}", { label: i.label })} onClick={() => toggle(i)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>{t("Langues des articles")}</label>
        <span className="small muted">
          {t("Les articles écrits dans les langues cochées apparaissent dans ton fil, tous traduits en français. Clique pour cocher ou décocher.")}
        </span>
        <div className="row wrap" style={{ gap: 6 }}>
          {LANGUAGES.map((l) => {
            const on = languages[l.id] !== false;
            return (
              <button
                key={l.id}
                className={`chip ${on ? "active" : ""}`}
                aria-pressed={on}
                onClick={() => onChange(interests, { ...languages, [l.id]: !on })}
              >
                {on && <Check size={13} />} {t(l.label)}
              </button>
            );
          })}
        </div>
        {languages.en === false && (
          <span className="small lang-warning">
            {t("Sans l'anglais, la grande majorité des articles scientifiques disparaît de ton fil.")}
          </span>
        )}
      </div>
    </div>
  );
}

/** First launch: nothing is fetched before the reader has said what they like. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const { reloadSettings } = useApp();
  const [interests, setInterests] = useState<Interest[]>([]);
  // English (most research) and French to start; the other languages are added on demand.
  const [languages, setLanguages] = useState<Record<string, boolean>>(
    Object.fromEntries(LANGUAGES.map((l) => [l.id, l.id === "en" || l.id === "fr"])),
  );
  const [saving, setSaving] = useState(false);
  const missing = MIN_INTERESTS - interests.length;
  const noLanguage = !Object.values(languages).some(Boolean);

  // Someone who used the app before this screen existed: start from what they read.
  useEffect(() => {
    void api.getProfile().then((p) => {
      const liked = new Set(p.domains.filter((d) => d.weight >= 1).map((d) => d.id));
      if (!liked.size) return;
      const terms = new Set(p.topTerms.map((t) => t.term));
      // Whole keywords found among the most read terms, plus the interest's main discipline.
      const score = (i: Interest) =>
        i.keywords.filter((k) => terms.has(k) || terms.has(k.replace(/s$/, ""))).length + (liked.has(i.fields[0]) ? 1 : 0);
      setInterests(INTEREST_CATALOG.filter((i) => score(i) >= 2).map(({ group: _g, ...i }) => i));
    });
  }, []);

  const start = async () => {
    setSaving(true);
    await api.setInterests(interests, languages);
    onDone();
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">{t("Bienvenue sur Nùkún")}</span>
          {/* The app's language, before anything else: it is also the reading language. */}
          <div className="seg" role="group" aria-label={t("Langue de l'app")}>
            {(["fr", "en"] as const).map((l) => (
              <button
                key={l}
                className={lang() === l ? "active" : ""}
                onClick={async () => {
                  await api.saveSettings({ uiLang: l });
                  await reloadSettings();
                }}
              >
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
        </div>
        <h1 className="display">{t("Qu'est-ce qui t'intéresse ?")}</h1>
        <p className="muted">
          {t("Choisis au moins {n} sujets. Ton fil partira de là, puis apprendra de ce que tu lis et te proposera peu à peu des sujets voisins. Tu pourras tout changer dans les réglages.", { n: MIN_INTERESTS })}
        </p>
        <InterestsEditor
          interests={interests}
          languages={languages}
          onChange={(i, l) => {
            setInterests(i);
            setLanguages(l);
          }}
        />
      </div>
      <div className="welcome-bar">
        <span className="muted small">
          {missing > 0
            ? missing > 1
              ? t("Encore {n} sujets à choisir", { n: missing })
              : t("Encore 1 sujet à choisir")
            : noLanguage
              ? t("Coche au moins une langue")
              : t("{n} sujets choisis", { n: interests.length })}
        </span>
        <button className="btn primary" disabled={missing > 0 || noLanguage || saving} onClick={() => void start()}>
          {saving ? <div className="spinner" /> : null} {t("Commencer")}
        </button>
      </div>
    </div>
  );
}
