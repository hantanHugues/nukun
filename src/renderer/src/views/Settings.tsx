import { CheckCircle2, ExternalLink, FolderOpen, KeyRound, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProvider, Settings, SourceStatus, UsageStats } from "@shared/types";
import { DOMAINS, SOURCES } from "@shared/types";
import { api } from "../api";
import { useApp } from "../App";
import { timeAgo } from "../util";

const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Meilleure qualité de traduction (recommandé)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Environ 2 fois moins cher, très bon" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "Le plus économique, un peu moins précis" },
];

export function SettingsView() {
  const { settings, reloadSettings, toast } = useApp();
  const [key, setKey] = useState("");
  const [s2, setS2] = useState("");
  const [gem, setGem] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [hint, setHint] = useState(settings?.keepTermsHint ?? "");

  useEffect(() => {
    void api.ollamaModels().then(setModels);
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
      title: "Hybride (recommandé)",
      text: "Gemini (gratuit) traduit le gros du texte. Claude (ton abonnement) prépare le lexique, prend les passages très techniques et corrige les erreurs détectées. L'IA locale sert de relais.",
    },
    { id: "gemini", title: "Gemini seul", text: "Gratuit avec ta clé Google. L'IA locale prend le relais si le quota du jour est atteint." },
    { id: "ollama", title: "IA locale seule", text: "Gratuit et hors ligne, sur ta carte graphique. Plus lent, moins précis." },
    {
      id: "claude-code",
      title: "Mon abonnement Claude",
      text: "Passe par Claude Code, déjà connecté sur ce PC. Pas de coût en plus, mais utilise les limites de ton abonnement. Relais sur l'IA locale si la limite est atteinte.",
    },
    { id: "claude", title: "Clé API Claude", text: "Payant à l'usage, sur platform.claude.com." },
    { id: "auto", title: "Automatique", text: "Claude d'abord (clé API, sinon abonnement), puis l'IA locale." },
  ];

  return (
    <div className="page">
      <div className="stack" style={{ gap: 10, marginBottom: 28 }}>
        <span className="label">Réglages</span>
        <h1 className="display">Configuration</h1>
      </div>
      <div className="settings">
        {/* ---------------------------------------------------------------- AI */}
        <section className="card section">
          <h2 className="h2">Intelligence artificielle</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Elle traduit les articles, prépare les titres en français, explique les passages difficiles et affine tes
            recommandations.
          </p>
          <div className="radio-cards">
            {providers.map((p) => (
              <button key={p.id} className={`radio-card ${settings.provider === p.id ? "active" : ""}`} onClick={() => void save({ provider: p.id })}>
                <strong>{p.title}</strong>
                <span>{p.text}</span>
              </button>
            ))}
          </div>

          <div className="field">
            <label>
              Clé API Gemini (gratuite) {settings.hasGeminiKey && <span className="tag brand" style={{ marginLeft: 6 }}>enregistrée</span>}
            </label>
            <div className="row">
              <input
                className="input grow"
                type="password"
                placeholder={settings.hasGeminiKey ? "Une clé est enregistrée (chiffrée sur ce PC)" : "Clé créée sur aistudio.google.com"}
                value={gem}
                onChange={(e) => setGem(e.target.value)}
              />
              <button
                className="btn"
                disabled={!gem.trim()}
                onClick={async () => {
                  await save({ geminiKey: gem });
                  setGem("");
                  toast("Clé Gemini enregistrée.");
                }}
              >
                <KeyRound size={15} /> Enregistrer
              </button>
              {settings.hasGeminiKey && (
                <button className="btn ghost" onClick={() => void save({ geminiKey: "" })}>
                  Supprimer
                </button>
              )}
            </div>
            <span className="small muted">
              Le quota gratuit de Google est compté par modèle et par jour (parfois seulement 20 requêtes). L'app alterne donc entre
              plusieurs modèles gratuits (Gemini Flash, Gemma 4, Flash-Lite) et passe au suivant quand l'un est épuisé. Tes quotas
              réels sont visibles sur{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://aistudio.google.com/rate-limit"))}>
                aistudio.google.com/rate-limit
              </a>
              .
            </span>
          </div>

          <div className="field">
            <label>Clé API Claude, facultative et payante {settings.hasClaudeKey && <span className="tag brand" style={{ marginLeft: 6 }}>enregistrée</span>}</label>
            <div className="row">
              <input
                className="input grow"
                type="password"
                placeholder={settings.hasClaudeKey ? "Une clé est enregistrée (chiffrée sur ce PC)" : "sk-ant-…"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                className="btn"
                disabled={!key.trim()}
                onClick={async () => {
                  await save({ claudeKey: key });
                  setKey("");
                  toast("Clé enregistrée.");
                }}
              >
                <KeyRound size={15} /> Enregistrer
              </button>
              {settings.hasClaudeKey && (
                <button className="btn ghost" onClick={() => void save({ claudeKey: "" })}>
                  Supprimer
                </button>
              )}
            </div>
            <span className="small muted">
              À créer sur{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://platform.claude.com/settings/keys"))}>
                platform.claude.com
              </a>
              . Elle est chiffrée avec le coffre de Windows et ne quitte pas ton ordinateur, sauf pour appeler l'API.
            </span>
          </div>

          <div className="field">
            <label>Modèle utilisé avec ton abonnement Claude</label>
            <select
              className="select"
              value={settings.claudeCodeModel}
              onChange={(e) => void save({ claudeCodeModel: e.target.value as Settings["claudeCodeModel"] })}
            >
              <option value="opus">Opus : meilleure qualité, consomme plus vite tes limites</option>
              <option value="sonnet">Sonnet : très bon, plus économe</option>
              <option value="haiku">Haiku : le plus économe</option>
            </select>
          </div>

          <div className="field">
            <label>Modèle Claude (clé API)</label>
            <select className="select" value={settings.claudeModel} onChange={(e) => void save({ claudeModel: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} : {m.note}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>IA locale (Ollama)</label>
            {models.length ? (
              <select className="select" value={settings.ollamaModel} onChange={(e) => void save({ ollamaModel: e.target.value })}>
                <option value="">Premier modèle disponible</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <div className="notice">
                <span>
                  Ollama n'est pas détecté. Pour une IA gratuite sur ton PC : installe Ollama depuis{" "}
                  <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal("https://ollama.com/download"))}>
                    ollama.com
                  </a>
                  , puis télécharge un modèle qui parle bien français, par exemple <code>ollama pull qwen2.5:7b</code> (tient dans les
                  8 Go de ta RTX 5050). Reviens ensuite sur cette page.
                </span>
              </div>
            )}
          </div>

          <div className="field">
            <label>Termes à toujours garder en anglais (facultatif)</label>
            <textarea
              className="textarea"
              rows={2}
              value={hint}
              placeholder="Ex. : garde « dataset », « framework », « edge computing » en anglais ; traduis « deep learning » par « apprentissage profond »."
              onChange={(e) => setHint(e.target.value)}
              onBlur={() => hint !== settings.keepTermsHint && void save({ keepTermsHint: hint })}
            />
          </div>

          <div className="setting-row" style={{ marginTop: 8 }}>
            <div className="grow">
              <div>Traduire automatiquement à l'ouverture</div>
              <div className="small muted">Sinon, un bouton « Traduire » apparaît dans le lecteur.</div>
            </div>
            <button className={`switch ${settings.autoTranslate ? "on" : ""}`} onClick={() => void save({ autoTranslate: !settings.autoTranslate })} aria-label="Traduction automatique" />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void runTest()} disabled={testing}>
              {testing ? <div className="spinner" /> : <RefreshCw size={15} />} Tester l'IA
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
                <div className="small muted">Coût Claude ce mois-ci</div>
                <div className="v">{usage.monthCostUsd.toFixed(2)} $</div>
              </div>
              <div className="stat">
                <div className="small muted">Coût Claude total</div>
                <div className="v">{usage.claudeCostUsd.toFixed(2)} $</div>
              </div>
              <div className="stat">
                <div className="small muted">Appels Gemini / local / abonnement</div>
                <div className="v">
                  {usage.geminiCalls ?? 0} / {usage.ollamaCalls} / {usage.claudeCodeCalls ?? 0}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- domains */}
        <section className="card section">
          <h2 className="h2">Domaines suivis</h2>
          {DOMAINS.map((d) => (
            <div key={d.id} className="setting-row">
              <div className="grow">{d.label}</div>
              <button
                className={`switch ${settings.domains[d.id] !== false ? "on" : ""}`}
                aria-label={d.label}
                onClick={() => void save({ domains: { ...settings.domains, [d.id]: settings.domains[d.id] === false } })}
              />
            </div>
          ))}
        </section>

        {/* ---------------------------------------------------------------- sources */}
        <section className="card section">
          <div className="row">
            <h2 className="h2 grow">Sources scientifiques</h2>
            <select className="select" style={{ width: "auto" }} value={settings.refreshHours} onChange={(e) => void save({ refreshHours: Number(e.target.value) })}>
              {[1, 3, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  Actualiser toutes les {h} h
                </option>
              ))}
            </select>
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            Uniquement des éditeurs et archives officiels, et uniquement des articles lisibles gratuitement en entier.
          </p>
          {SOURCES.map((src) => {
            const st = status.find((x) => x.source === src.id);
            return (
              <div key={src.id} className="setting-row">
                <div className="grow">
                  <div>{src.label}</div>
                  <div className="small muted">{src.description}</div>
                  {st?.lastRun && (
                    <div className="small" style={{ color: st.error ? "var(--accent)" : "var(--text-weak)", marginTop: 2 }}>
                      {st.error ? `Indisponible : ${st.error}` : `${st.lastCount ?? 0} articles`} · {timeAgo(st.lastRun)}
                      {st.error && src.id === "semanticscholar" && !settings.hasSemanticScholarKey && " · une clé gratuite (plus bas) règle ce problème"}
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
              Clé API Semantic Scholar (facultative, gratuite){" "}
              {settings.hasSemanticScholarKey && <span className="tag brand" style={{ marginLeft: 6 }}>enregistrée</span>}
            </label>
            <div className="row">
              <input className="input grow" type="password" value={s2} onChange={(e) => setS2(e.target.value)} placeholder="Sans clé, Semantic Scholar limite souvent les requêtes" />
              <button className="btn" disabled={!s2.trim()} onClick={async () => (await save({ semanticScholarKey: s2 }), setS2(""), toast("Clé enregistrée."))}>
                Enregistrer
              </button>
              <button className="btn ghost" onClick={() => void api.openExternal("https://www.semanticscholar.org/product/api#api-key-form")}>
                <ExternalLink size={15} /> Demander une clé
              </button>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- export */}
        <section className="card section">
          <h2 className="h2">Export vers le portfolio</h2>
          <p className="small muted" style={{ marginTop: 6 }}>
            Tes articles sont exportés en .mdx, au même format que les pages de ton portfolio (titre, date, résumé, image).
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
              <FolderOpen size={15} /> Choisir
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
