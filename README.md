# Veille Scientifique

Application de bureau (Windows) pour lire des articles scientifiques en libre accès, traduits en français, avec un fil de recommandations qui apprend de tes lectures.

## Installer

Lance `release/Veille-Scientifique-Setup-1.0.0.exe`. L'installateur crée un raccourci sur le Bureau et dans le menu Démarrer.

## Sources

arXiv, Europe PMC (PubMed Central), bioRxiv, medRxiv, PLOS, eLife, NASA Science, Nature Communications et Scientific Reports, Science Advances, OpenAlex, Semantic Scholar et PsyArXiv. Toutes passent par leurs API ou flux officiels. Seuls les articles dont le texte intégral est gratuit apparaissent dans le fil.

## IA

Mode par défaut : **Hybride**, sans aucun coût.

- **Google (gratuit)** traduit le gros du texte. Colle ta clé AI Studio dans les Réglages. L'app alterne entre plusieurs modèles gratuits (Gemini Flash, Gemma 4, Flash-Lite), car chacun a son propre quota journalier.
- **Ton abonnement Claude** (via Claude Code, déjà connecté sur le PC) prépare le lexique de chaque article, prend les passages très techniques et corrige les traductions qui échouent aux contrôles automatiques.
- **L'IA locale** (Ollama) sert de relais hors ligne ou quand les quotas sont atteints. L'app détecte la carte graphique et conseille le modèle adapté à sa mémoire (`aya-expanse:8b` pour 8 Go, des modèles plus gros sur les PC plus puissants).
- Sans Claude Code installé, l'app le détecte et fonctionne avec Google et l'IA locale.

Traduction « comme un navigateur » : seuls les passages affichés à l'écran (plus un écran d'avance) sont traduits. Chaque traduction est gardée dans une mémoire partagée entre tous les articles : rien n'est jamais payé ni demandé deux fois. Le bouton « Tout traduire » prépare un article entier pour plus tard.

## Utilisation

Au premier lancement, une **visite guidée** met en lumière chaque zone de l'app (fil, lecteur, réglages de l'IA, domaines, sources). Elle se relance depuis les Réglages.

- **Pour toi** : le fil recommandé. Ouvrir, lire jusqu'au bout, aimer, sauvegarder ou écarter un article ajuste les recommandations.
- **Lecteur** : affichage en français, côte à côte ou en version originale (et PDF quand il existe). L'icône de langue sur un paragraphe affiche l'original. Le lexique liste les termes techniques gardés en anglais. L'onglet **Discussion** permet de poser des questions sur l'article : l'IA répond à partir de son texte. Sélectionne un passage puis « Expliquer » pour une explication simple. Explications et conversations sont gardées avec l'article.
- **Mes articles** : rédige ton article à partir de ta lecture, puis exporte-le en `.mdx` (même format que le portfolio) ou copie-le pour un post.

## Développement

Prérequis : Node.js 22+. Optionnel : Ollama et Claude Code installés sur le PC.

```bash
npm install
npm run dev        # lancer en mode développement
npm run typecheck  # vérifier les types
npm run dist       # construire l'installateur Windows dans release/
npm run icon       # régénérer les icônes depuis resources/icon.svg
```

L'architecture (sources, formats de texte intégral, traduction hybride, mémoire de traduction, recommandations, stockage) est décrite dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Scripts de test

- `scripts/test-sources.mts` : interroge chaque source et affiche le nombre d'articles par domaine (`npx tsx scripts/test-sources.mts [source]`).
- `scripts/test-loader.mts` : charge le texte intégral d'articles de référence pour chaque format.
- `scripts/compare.mjs` : traduit un même article avec plusieurs IA via l'app lancée avec `--remote-debugging-port=9333`, pour les comparer.
- `scripts/cdp.mjs` : capture d'écran ou évaluation dans l'app lancée en débogage.
- `scripts/fake-ollama.mjs` : fausse IA locale pour tester la chaîne de traduction sans modèle.

## Licences

Code : MIT. L'icône reprend le pictogramme « scan-eye » de [Lucide](https://lucide.dev) (licence ISC), voir `resources/THIRD_PARTY_LICENSES.md`. Les articles affichés restent la propriété de leurs auteurs et éditeurs, sous leurs licences respectives.
