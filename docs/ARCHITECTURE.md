# Architecture

Veille Scientifique is an Electron desktop app: a Node.js **main process** does all the network, parsing, AI and storage work, and a React **renderer** displays it. They talk through a typed IPC bridge.

```
src/
├── shared/types.ts        Types shared by both sides (Article, Block, Settings, the IPC API)
├── main/                  Main process (Node.js)
│   ├── index.ts           Window, IPC handlers, veille:// protocol for PDFs, refresh scheduler
│   ├── library.ts         Orchestrator: article database, refresh, content cache, translation jobs, drafts, export
│   ├── settings.ts        Settings and usage counters; API keys encrypted with Electron safeStorage
│   ├── store.ts           Small JSON persistence helpers (atomic writes, debounced saves)
│   ├── http.ts            fetch wrapper: timeouts, retries on 429/5xx, browser or API user agent
│   ├── sources/           One fetcher per scientific source → normalized articles
│   ├── content/           Full-text loaders → reading blocks
│   ├── ai/                Model providers, translation, assistance, translation memory
│   └── reco/              Recommendation engine
├── preload/index.ts       Exposes the IPC API to the page as window.veille
└── renderer/src/          React UI (feed, reader, library, writing, profile, settings)
```

## Data flow

1. **Refresh** (`Library.refresh`, every few hours or on demand)
   - Each enabled source in `sources/index.ts` returns `RawArticle`s through its official API or feed (arXiv, Europe PMC, bioRxiv/medRxiv, PLOS, eLife, NASA, Nature, Science Advances, OpenAlex, Semantic Scholar, PsyArXiv).
   - Articles are merged by id (DOI or arXiv id), so the same paper from two sources appears once.
   - Articles whose free full text is not reachable yet are marked `pending` and checked again later (for example Science Advances through Europe PMC).
   - The top of the feed is prefetched so it opens instantly, and card titles are translated.

2. **Full text** (`content/loader.ts`) turns every format into the same list of `Block`s (heading, paragraph, list, figure, table, equation, references):
   - `jats.ts` for JATS XML (PubMed Central, bioRxiv, PLOS, eLife), with per-publisher figure URL rules;
   - `html.ts` for arXiv HTML (LaTeXML, MathML kept), Nature pages and NASA posts;
   - `pdf.ts` (pdf.js) and mammoth (Word) when only a file exists.
   Parsed content is cached in `userData/content/<id>.json` together with its translations.

3. **Reading** (`renderer/src/views/Reader.tsx`)
   - Blocks are rendered after DOMPurify sanitization (HTML + MathML).
   - Every block with untranslated passages carries `data-tkeys`; an IntersectionObserver sends the ones on screen (plus one screen ahead) to `Library.translateVisible`.
   - Scroll position, reading time and progress are reported back as interactions.

## Translation

`ai/translate.ts`

- **Segments**: each translatable part of a block (`"block:segment"`). Formulas, code, references and links are replaced by `⟦n⟧` markers before translation and put back afterwards, so a model cannot damage them.
- **Glossary**: built once per article by the stronger model; it decides which technical terms stay in English (e.g. MQTT *topic*) and fixes the French term for the others.
- **Translation memory** (`ai/memory.ts`): every validated passage is stored by hash in `translation-memory.json`, shared by all articles. A passage seen before is never sent to a model again.
- **Hybrid routing**: the most technical passages (formulas, many glossary terms) go to Claude; the rest to the bulk model. Cheap automatic checks (`looksWrong`: missing marker, text still in English, abnormal length, kept term translated) send failed passages to Claude for repair.

`ai/llm.ts` provides one entry point, `llmJson(request)`, which returns JSON matching a schema. Each request has a `tier` (`light` for bulk work, `heavy` for glossary, technical passages, repairs and explanations), and the provider is chosen from the settings:

| Provider | Used for | Notes |
|---|---|---|
| Google AI Studio (free) | light | Rotates across free models (`GEMINI_ROTATION`); each has its own daily quota, and an exhausted model is set aside until its reset time |
| Claude Code (`ai/claudeCode.ts`) | heavy | Runs the local `claude` CLI in print mode with the user's own subscription; no tools, no settings, empty working folder |
| Ollama | fallback | Local model (default `aya-expanse:8b`), 6k context to stay within about 6 GB of video memory |
| Claude API | optional | Anthropic SDK, structured outputs, server-side refusal fallback |

Every step of a chain covers for the previous one (quota reached, service busy, offline), so reading never blocks.

## Recommendations

`reco/recommender.ts` is a content-based recommender with implicit feedback:

- articles are TF-IDF vectors (title, abstract, categories; unigrams and bigrams);
- the reader profile is a weighted term vector updated by opens, reading time, scroll progress, finishes, likes, saves, posts and dismissals, with a 30-day half-life;
- score = similarity + domain affinity + freshness + exploration bonus − already-seen penalty;
- the list is diversified (maximal marginal relevance, no long runs of one source or domain), and one card in seven is a "discovery" from a less-read domain;
- every few strong signals, an AI summary of the reader's interests adds keywords to the profile.

## Storage

Everything lives in Electron's `userData` folder (`%APPDATA%\Veille Scientifique`):

| File | Content |
|---|---|
| `articles.json` | Article metadata and per-article reading state |
| `content/*.json` | Parsed full text, translations, glossary |
| `translation-memory.json` | Shared translation memory |
| `profile.json` | Recommendation profile |
| `drafts.json` | The reader's own articles |
| `settings.json` | Settings; API keys encrypted |
| `usage.json`, `sources.json`, `meta.json` | Counters, source status, last refresh |

## Export to the portfolio

`Library.exportDraft` writes an `.mdx` file with the same front matter as the magic-portfolio pages (`title`, `publishedAt`, `summary`, `image`, `tag`) plus the source reference, and ends with a credit line linking to the original article.
