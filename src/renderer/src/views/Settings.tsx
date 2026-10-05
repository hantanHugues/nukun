import { CheckCircle2, ExternalLink, FolderOpen, KeyRound, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProvider, AiStatus, Settings, SourceStatus, UsageStats } from "@shared/types";
import { SOURCES } from "@shared/types";
import type { Interest } from "@shared/types";
import { InterestsEditor, MIN_INTERESTS } from "../components/Interests";
import { Select } from "../components/Select";
import { SectionNav } from "../components/SectionNav";
import { lang, t } from "@shared/i18n";

const SECTIONS = [
  { id: "s-lang", label: "Langue" },
  { id: "s-ai", label: "Intelligence artificielle" },
  { id: "s-interests", label: "Centres d'intérêt" },
  { id: "s-data", label: "Données mobiles" },
  { id: "s-sources", label: "Sources" },
  { id: "s-tour", label: "Tutoriel" },
  { id: "s-export", label: "Export" },
];
import { api } from "../api";
import { useApp } from "../App";
import { helpUrl, timeAgo } from "../util";

const MODELS = [
  // Notes are written in French and shown in the app's language.
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Meilleure qualité de traduction (recommandé)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Environ 2 fois moins cher, très bon" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Le plus économique, un peu moins précis" },
];

export function SettingsView() {
  const { settings, reloadSettings, toast } = useApp();
  const [draft, setDraft] = useState<{ interests: Interest[]; languages: Record<string, boolean> } | null>(null);
  const [key, setKey] = useState("");
  const [s2, setS2] = useState("");
  const [gem, setGem] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [hw, setHw] = useState<AiStatus | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [hint, setHint] = useState(settings?.keepTermsHint ?? "");

  useEffect(() => {
    void api.ollamaModels().then(setModels);
    void api.aiStatus().then(setHw);
    void api.getUsage().then(setUsage);
    void api.getSourceStatus().then(setStatus);
  }, []);
  useEffect(() => setHint(settings?.keepTermsHint ?? ""), [settings?.keepTermsHint]);

  if (!settings) return null;

  const save = async (patch: Partial<Settings> & { claudeKey?: string; semanticScholarKey?: string; geminiKey?: string }) => {
    await api.saveSettings(patch);
    await reloadSettings();
  };

  const runTest = async () => {
    setTesting(true);
    setTest(await api.testAi());
    setTesting(false);
    void api.getUsage().then(setUsage);
  };

  const providers: { id: AiProvider; title: string; text: string }[] = [
    {
      id: "hybrid",
      title: t("Hybride (recommandé)"),
      text: t("Gemini (gratuit) traduit le gros du texte. Claude (ton abonnement) prépare le lexique, prend les passages très techniques et corrige les erreurs détectées. L'IA locale sert de relais."),
    },
    { id: "gemini", title: t("Gemini seul"), text: t("Gratuit avec ta clé Google. L'IA locale prend le relais si le quota du jour est atteint.") },
    { id: "ollama", title: t("IA locale seule"), text: t("Gratuit et hors ligne, sur ta carte graphique. Plus lent, moins précis.") },
    {
      id: "claude-code",
      title: t("Mon abonnement Claude"),
      text: t("Passe par Claude Code, déjà connecté sur ce PC. Pas de coût en plus, mais utilise les limites de ton abonnement. Relais sur l'IA locale si la limite est atteinte."),
    },
    { id: "claude", title: t("Clé API Claude"), text: t("Payant à l'usage, sur platform.claude.com.") },
    { id: "auto", title: t("Automatique"), text: t("Claude d'abord (clé API, sinon abonnement), puis l'IA locale.") },
  ];

  return (
    <div className="page">
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">{t("Réglages")}</span>
        <h1 className="display">{t("Configuration")}</h1>
      </div>
      <div className="settings-layout">
      <SectionNav items={SECTIONS} />
      <div className="settings">
        {/* ---------------------------------------------------------------- language */}
        <section className="card section" id="s-lang" data-tour="lang">
          <div className="row">
            <div className="grow">
              <h2 className="h2">{t("Langue")}</h2>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {t("La langue de l'app, et celle dans laquelle les articles sont traduits, expliqués et discutés. Ce qui a déjà été traduit dans l'autre langue reste en mémoire.")}
              </p>
            </div>
            <div className="seg" role="group" aria-label={t("Langue")}>
              {(["fr", "en"] as const).map((l) => (
                <button key={l} className={lang() === l ? "active" : ""} onClick={() => void save({ uiLang: l })}>
                  {l === "fr" ? "Français" : "English"}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- AI */}
        <section className="card section" id="s-ai">
          <h2 className="h2">{t("Intelligence artificielle")}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {t("Elle traduit les articles, prépare les titres en français, explique les passages difficiles et affine tes recommandations.")}
          </p>
          <div className="radio-cards" data-tour="ai-modes">
            {providers.map((p) => (
              <button key={p.id} className={`radio-card ${settings.provider === p.id ? "active" : ""}`} onClick={() => void save({ provider: p.id })}>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </button>
            ))}
          </div>

          <div className="field" data-tour="gemini-key">
            <label>
              {t("Clé API Gemini (gratuite)")} {settings.hasGeminiKey && <span className="tag brand" style={{ marginLeft: 6 }}>{t("enregistrée")}</span>}
            </label>
            <div className="row">
              <input
                className="input grow"
                type="password"
                placeholder={settings.hasGeminiKey ? t("Une clé est enregistrée (chiffrée sur ce PC)") : t("Clé créée sur aistudio.google.com")}
                value={gem}
                onChange={(e) => setGem(e.target.value)}
              />
              <button
                className="btn"
                disabled={!gem.trim()}
                onClick={async () => {
                  await save({ geminiKey: gem });
                  setGem("");
                  toast(t("Clé Gemini enregistrée."));
                }}
              >
                <KeyRound size={15} /> {t("Enregistrer")}
              </button>
              {settings.hasGeminiKey && (
                <button className="btn ghost" onClick={() => void save({ geminiKey: "" })}>
                  {t("Supprimer")}
                </button>
              )}
            </div>
            <span className="small muted">
              {t("Le quota gratuit de Google est compté par modèle et par jour (parfois seulement 20 requêtes). L'app alterne donc entre plusieurs modèles gratuits (Gemini Flash, Gemma 4, Flash-Lite) et passe au suivant quand l'un est épuisé. Tes quotas réels sont visibles sur")}{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://aistudio.google.com/rate-limit"))}>
                aistudio.google.com/rate-limit
              </a>
              .
            </span>
          </div>

          <div className="field">
            <label>
              {t("Clé API Claude, facultative et payante")}{" "}
              {settings.hasClaudeKey && <span className="tag brand" style={{ marginLeft: 6 }}>{t("enregistrée")}</span>}
            </label>
            <div className="row">
              <input
                className="input grow"
                type="password"
                placeholder={settings.hasClaudeKey ? t("Une clé est enregistrée (chiffrée sur ce PC)") : "sk-ant-…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                className="btn"
                disabled={!key.trim()}
                onClick={async () => {
                  await save({ claudeKey: key });
                  setKey("");
                  toast(t("Clé enregistrée."));
                }}
              >
                <KeyRound size={15} /> {t("Enregistrer")}
              </button>
              {settings.hasClaudeKey && (
                <button className="btn ghost" onClick={() => void save({ claudeKey: "" })}>
                  {t("Supprimer")}
                </button>
              )}
            </div>
            <span className="small muted">
              {t("À créer sur")}{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://platform.claude.com/settings/keys"))}>
                platform.claude.com
              </a>
              {t(". Elle est chiffrée par le système (le coffre de Windows, ou le trousseau de clés sous Linux) et ne quitte pas ton ordinateur, sauf pour appeler l'API.")}
            </span>
          </div>

          <div className="field">
            <label>{t("Modèle utilisé avec ton abonnement Claude")}</label>
            <Select
              label={t("Modèle utilisé avec ton abonnement Claude")}
              value={settings.claudeCodeModel}
              onChange={(v) => void save({ claudeCodeModel: v })}
              options={[
                { value: "opus" as Settings["claudeCodeModel"], label: t("Opus : meilleure qualité, consomme plus vite tes limites") },
                { value: "sonnet" as Settings["claudeCodeModel"], label: t("Sonnet : très bon, plus économe") },
                { value: "haiku" as Settings["claudeCodeModel"], label: t("Haiku : le plus économe") },
              ]}
            />
          </div>

          <div className="field">
            <label>{t("Modèle Claude (clé API)")}</label>
            <Select
              label={t("Modèle Claude (clé API)")}
              value={settings.claudeModel}
              onChange={(v) => void save({ claudeModel: v })}
              options={MODELS.map((m) => ({ value: m.id, label: `${m.label} : ${t(m.note)}` }))}
            />
          </div>

          <div className="field" data-tour="ollama">
            <label>{t("IA locale (Ollama)")}</label>
            {hw && (
              <span className="small muted">
                {t("Ton PC : {gpu}", { gpu: hw.gpu })}
                {hw.vramGb ? ` (${t("{n} Go", { n: hw.vramGb })})` : ""}. {t("Modèle conseillé :")} <code>{hw.advice.model}</code>. {hw.advice.why}
              </span>
            )}
            {models.length ? (
              <Select
                label={t("IA locale (Ollama)")}
                value={settings.ollamaModel}
                onChange={(v) => void save({ ollamaModel: v })}
                options={[{ value: "", label: t("Premier modèle disponible") }, ...models.map((m) => ({ value: m, label: m }))]}
              />
            ) : (
              <div className="notice">
                <span>
                  {t("Ollama n'est pas détecté. Pour une IA gratuite sur ton PC : installe Ollama depuis")}{" "}
                  <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://ollama.com/download"))}>
                    ollama.com
                  </a>
                  {t(", puis télécharge le modèle conseillé pour ton PC :")} <code>ollama pull {hw?.advice.model ?? "aya-expanse:8b"}</code>.{" "}
                  {t("Reviens ensuite sur cette page.")}
                </span>
              </div>
            )}
          </div>

          <div className="field">
            <label>{t("Termes à toujours garder en anglais (facultatif)")}</label>
            <textarea
              className="textarea"
              rows={2}
              value={hint}
              placeholder={t("Ex. : garde « dataset », « framework », « edge computing » en anglais ; traduis « deep learning » par « apprentissage profond ».")}
              onChange={(e) => setHint(e.target.value)}
              onBlur={() => hint !== settings.keepTermsHint && void save({ keepTermsHint: hint })}
            />
          </div>

          <div className="setting-row" style={{ marginTop: 8 }}>
            <div className="grow">
              <div>{t("Traduire automatiquement à l'ouverture")}</div>
              <div className="small muted">{t("Sinon, un bouton « Traduire » apparaît dans le lecteur.")}</div>
            </div>
            <button className={`switch ${settings.autoTranslate ? "on" : ""}`} onClick={() => void save({ autoTranslate: !settings.autoTranslate })} aria-label={t("Traduction automatique")} />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void runTest()} disabled={testing} data-tour="ai-test">
              {testing ? <div className="spinner" /> : <RefreshCw size={15} />} {t("Tester l'IA")}
            </button>
            {test && (
              <span className="row small" style={{ color: test.ok ? "var(--success)" : "var(--accent)" }}>
                {test.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {test.message}
              </span>
            )}
          </div>

          {usage && (
            <div className="stats">
              <div className="stat">
                <div className="small muted">{t("Coût Claude ce mois-ci")}</div>
                <div className="v">{usage.monthCostUsd.toFixed(2)} $</div>
              </div>
              <div className="stat">
                <div className="small muted">{t("Coût Claude total")}</div>
                <div className="v">{usage.claudeCostUsd.toFixed(2)} $</div>
              </div>
              <div className="stat">
                <div className="small muted">{t("Appels Gemini / local / abonnement")}</div>
                <div className="v">
                  {usage.geminiCalls ?? 0} / {usage.ollamaCalls} / {usage.claudeCodeCalls ?? 0}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- interests */}
        <section className="card section" id="s-interests" data-tour="domains">
          <h2 className="h2">{t("Centres d'intérêt")}</h2>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t("Les sources ne sont interrogées que pour ces sujets, et les filtres du fil en découlent. L'algorithme part de là et te propose peu à peu des sujets voisins.")}
          </p>
          <InterestsEditor
            interests={draft?.interests ?? settings.interests}
            languages={draft?.languages ?? settings.languages}
            onChange={(interests, languages) => setDraft({ interests, languages })}
          />
          {draft && (
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary"
                disabled={draft.interests.length < MIN_INTERESTS || !Object.values(draft.languages).some(Boolean)}
                onClick={async () => {
                  await api.setInterests(draft.interests, draft.languages);
                  setDraft(null);
                  await reloadSettings();
                  toast(t("Centres d'intérêt enregistrés : le fil se met à jour."));
                }}
              >
                {t("Enregistrer")}
              </button>
              <button className="btn ghost" onClick={() => setDraft(null)}>
                {t("Annuler")}
              </button>
              {draft.interests.length < MIN_INTERESTS && (
                <span className="small muted">{t("Garde au moins {n} sujets.", { n: MIN_INTERESTS })}</span>
              )}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- data */}
        <section className="card section" id="s-data" data-tour="data">
          <div className="setting-row" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="grow">
              <h2 className="h2">{t("Économiser les données")}</h2>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {t("Pour une connexion mobile ou limitée. Un article n'est téléchargé que quand tu l'ouvres : les cartes restent sans image jusque-là, et l'ouverture prend quelques secondes de plus. Le modèle de recommandations par le sens (130 Mo) n'est pas téléchargé ; s'il est déjà là, il continue de servir.")}
              </p>
            </div>
            <button
              className={`switch ${settings.dataSaver ? "on" : ""}`}
              aria-label={t("Économiser les données")}
              onClick={() => void save({ dataSaver: !settings.dataSaver })}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- sources */}
        <section className="card section" id="s-sources" data-tour="sources">
          <div className="row">
            <h2 className="h2 grow">{t("Sources scientifiques")}</h2>
            <Select
              fit
              label={t("Fréquence d'actualisation")}
              value={settings.refreshHours}
              onChange={(v) => void save({ refreshHours: v })}
              options={[1, 3, 6, 12, 24].map((h) => ({ value: h, label: t("Actualiser toutes les {n} h", { n: h }) }))}
            />
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t("Uniquement des éditeurs et archives officiels, et uniquement des articles lisibles gratuitement en entier.")}
          </p>
          {SOURCES.map((src) => {
            const st = status.find((x) => x.source === src.id);
            return (
              <div key={src.id} className="setting-row">
                <div className="grow">
                  <div>{t(src.label)}</div>
                  <div className="small muted">{t(src.description)}</div>
                  {st?.lastRun && (
                    <div className="small" style={{ color: st.error ? "var(--accent)" : "var(--text-weak)", marginTop: 2 }}>
                      {st.error ? t("Indisponible : {raison}", { raison: st.error }) : t("{n} articles", { n: st.lastCount ?? 0 })} · {timeAgo(st.lastRun)}
                      {st.error && src.id === "semanticscholar" && !settings.hasSemanticScholarKey && ` · ${t("une clé gratuite (plus bas) règle ce problème")}`}
                    </div>
                  )}
                </div>
                <button
                  className={`switch ${settings.sources[src.id] ? "on" : ""}`}
                  aria-label={src.label}
                  onClick={() => void save({ sources: { ...settings.sources, [src.id]: !settings.sources[src.id] } })}
                />
              </div>
            );
          })}
          <div className="field">
            <label>
              {t("Clé API Semantic Scholar (facultative, gratuite)")}{" "}
              {settings.hasSemanticScholarKey && <span className="tag brand" style={{ marginLeft: 6 }}>{t("enregistrée")}</span>}
            </label>
            <div className="row">
              <input className="input grow" type="password" value={s2} onChange={(e) => setS2(e.target.value)} placeholder={t("Sans clé, Semantic Scholar limite souvent les requêtes")} />
              <button className="btn" disabled={!s2.trim()} onClick={async () => (await save({ semanticScholarKey: s2 }), setS2(""), toast(t("Clé enregistrée.")))}>
                {t("Enregistrer")}
              </button>
              <button className="btn ghost" onClick={() => void api.openExternal("https://www.semanticscholar.org/product/api#api-key-form")}>
                <ExternalLink size={15} /> {t("Demander une clé")}
              </button>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- tutorial */}
        <section className="card section" id="s-tour" data-tour="tour">
          <div className="row">
            <div className="grow">
              <h2 className="h2">{t("Tutoriel")}</h2>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {t("Refaire la visite guidée de l'app.")}
              </p>
            </div>
            <button className="btn" onClick={() => void save({ onboarded: false })}>
              {t("Relancer la visite")}
            </button>
          </div>
        </section>

        {/* ---------------------------------------------------------------- export */}
        <section className="card section" id="s-export" data-tour="export">
          <h2 className="h2">{t("Export")}</h2>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t("Tes articles sont exportés en .mdx (Markdown avec titre, date, résumé et image), un format que lisent la plupart des sites et portfolios.")}
          </p>
          <div className="row">
            <input className="input grow" readOnly value={settings.exportDir} />
            <button
              className="btn"
              onClick={async () => {
                const dir = await api.chooseDir();
                if (dir) await save({ exportDir: dir });
              }}
            >
              <FolderOpen size={15} /> {t("Choisir")}
            </button>
          </div>
        </section>

        <p className="small muted credit">
          {t("Nùkún, créé par")}{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://hantan-hugues.vercel.app"))}>
            Ashlynx
          </a>
          .{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://github.com/hantanHugues/nukun"))}>
            {t("Code source")}
          </a>
          .{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(helpUrl()))}>
            {t("Aide")}
          </a>
        </p>
      </div>
      </div>
    </div>
  );
}
