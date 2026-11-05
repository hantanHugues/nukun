# Serveur du lexique commun de Nùkún

Ce serveur reçoit les termes techniques que les lecteurs proposent (« deep learning » et sa traduction), les fait vérifier par Gemini, et publie ceux que plusieurs lecteurs différents ont confirmés. L'app télécharge ensuite le lexique publié.

Il ne contient aucun secret : tout passe par des variables d'environnement.

## Comment un terme arrive dans le lexique

1. L'app demande un défi (`GET /v1/challenge`), le résout (une fraction de seconde de calcul) et envoie ses termes (`POST /v1/terms`).
2. Le serveur contrôle le format, compte les envois (par adresse, par installation, au total) et range chaque terme comme proposition.
3. Une vérification par Gemini, avec un budget d'appels par jour, accepte ou refuse chaque proposition.
4. Un terme est publié quand **Gemini l'a accepté et que 3 connexions différentes l'ont envoyé** (`MIN_CONFIRMATIONS`).
5. L'app lit le lexique publié (`GET /v1/lexicon`).

### Ce qui protège le serveur

| Menace | Réponse |
|---|---|
| Quelqu'un copie l'app ou écrit un script | Impossible à reconnaître : on limite les dégâts à la place (ci-dessous). |
| Envoi en masse | Limites par adresse, par installation et au total, par jour. |
| Robots | Preuve de travail à usage unique (un CAPTCHA ne marche pas dans une app de bureau). |
| Une seule personne qui se fait passer pour plusieurs | Les confirmations comptent des connexions différentes, pas des identifiants d'installation. |
| Texte piégé pour tromper l'IA | Caractères et longueurs contrôlés, texte transmis comme donnée JSON, réponse forcée à des booléens, et confirmations multiples. |
| Vider ton quota Gemini | Plafond d'appels par jour (`GEMINI_MAX_CALLS_PER_DAY`), 20 termes par appel, 5 modèles gratuits en rotation. |
| Un terme publié par erreur | `POST /admin/block` le retire, et la meilleure autre traduction du même terme prend sa place. |

Le serveur ne peut **pas** vérifier que l'appel vient bien du vrai Nùkún : le code est public.

## Quota Gemini : il reprend tout seul

- Chaque modèle de la rotation a son quota du jour. Quand l'un est épuisé, le suivant prend le relais.
- La date de retour est celle que Google annonce, sinon minuit heure du Pacifique.
- Quand tous sont épuisés, les propositions restent en attente. Le serveur attend, sans insister, puis reprend dès qu'un quota revient.
- Tout est gardé dans la base : un redémarrage, ou une nuit de sommeil du serveur gratuit, ne perd rien.
- Clé refusée : pause d'une heure, avec un message dans les journaux de Render.

## Données gardées

- Les termes proposés (terme, traduction, définition, langues).
- Un haché salé de l'adresse et de l'identifiant d'installation de chaque envoi, pour compter les confirmations. Jamais l'adresse elle-même, ni le contenu des articles.
- Aucun journal d'adresse ni de contenu.

## Variables d'environnement

| Variable | Rôle | Par défaut |
|---|---|---|
| `DATABASE_URL` | Chaîne de connexion Postgres (obligatoire) | |
| `GEMINI_API_KEY` | Clé Google AI Studio. Sans elle, rien n'est publié. | |
| `ADMIN_TOKEN` | Jeton de l'administration (24 caractères au moins) | généré par Render |
| `IP_SALT` | Sel des hachés (16 caractères au moins) | généré par Render |
| `CHALLENGE_SECRET` | Signature des défis (16 caractères au moins) | généré par Render |
| `MIN_CONFIRMATIONS` | Connexions différentes nécessaires | 3 |
| `GEMINI_MAX_CALLS_PER_DAY` | Plafond d'appels Gemini par jour | 200 |
| `VERIFY_BATCH` | Termes par appel Gemini | 20 |
| `POW_BITS` | Difficulté de la preuve de travail | 18 |
| `TRUST_PROXY_HOPS` | Proxys de confiance (Render en ajoute 1) | 1 |
| `LIMIT_*` | Limites d'envoi, voir `src/config.js` | |

**Ne change jamais `IP_SALT`** après le lancement : les confirmations déjà comptées ne correspondraient plus.

## Déployer sur Render

1. **Base de données.** Crée un projet gratuit sur [neon.tech](https://neon.tech) et copie sa chaîne de connexion (elle commence par `postgresql://` et finit par `?sslmode=require`). Le disque de Render est effacé à chaque redémarrage : il faut une base à part. D'après la politique actuelle de Render, sa base gratuite est supprimée au bout de 30 jours : ne l'utilise pas.
2. **Clé Gemini.** Sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey), crée la clé dans **un nouveau projet** : son quota gratuit est alors séparé de celui de ta clé personnelle, que le serveur ne peut donc pas entamer.
3. **Render.** Nouveau → *Blueprint*, choisis le dépôt `hantanHugues/nukun`. Render lit `render.yaml` à la racine. Colle `DATABASE_URL` et `GEMINI_API_KEY` quand il les demande.
4. **Vérifier.** Quand le déploiement est fini, ouvre `https://<ton-service>.onrender.com/health` : tu dois voir `{"ok":true}`.
5. **Garder le service éveillé** (facultatif). Le plan gratuit s'endort après 15 minutes sans visite et met environ une minute à se réveiller, ce qui retarde la vérification des propositions. Un service gratuit de ping (UptimeRobot, cron-job.org) qui appelle `/health` toutes les 10 minutes règle cela, et 24 h sur 24 reste dans les 750 heures gratuites du mois.

Les pushs qui ne touchent pas au dossier `server/` ne redéploient pas le serveur.

## L'administration

Remplace `ADRESSE` et `JETON` (la valeur de `ADMIN_TOKEN`, visible dans les variables de Render) :

```powershell
$h = @{ Authorization = "Bearer JETON" }
Invoke-RestMethod https://ADRESSE/admin/stats -Headers $h
Invoke-RestMethod "https://ADRESSE/admin/candidates?status=published&limit=50" -Headers $h
Invoke-RestMethod "https://ADRESSE/admin/candidates?status=bad" -Headers $h
Invoke-RestMethod https://ADRESSE/admin/block -Method Post -Headers $h -ContentType application/json -Body '{"id":12}'
```

`status` vaut `pending`, `ok`, `bad`, `published` ou `blocked`. `/admin/unblock` annule un blocage. `stats` montre aussi l'état de la vérification (`worked`, `idle`, `paused`, `budget`…) et jusqu'à quand elle attend.

Un terme bloqué disparaît du lexique pour les nouveaux téléchargements. L'app doit donc relire tout le lexique de temps en temps (`since=0`) pour retirer ce qui a été bloqué.

## Pour l'app

`GET /v1/challenge` → `{ "challenge": "v1.…", "bits": 18 }`. Trouver un texte `nonce` (chiffres et lettres minuscules, 16 caractères au plus) tel que le SHA-256 de `challenge + ":" + nonce` commence par `bits` bits à zéro (`solve` dans `src/pow.js`). Un défi sert une fois et expire en 5 minutes.

`POST /v1/terms`, en JSON :

```json
{
  "install": "32 caractères hexadécimaux, tirés au hasard une fois pour toutes",
  "app": "1.0.2",
  "reading": "fr",
  "terms": [{ "src": "en", "term": "deep learning", "translation": "apprentissage profond", "keep": false, "definition": "…" }],
  "pow": { "challenge": "v1.…", "nonce": "3f9a" }
}
```

Réponse `202` : `{ "added", "repeated", "ignored", "rejected": [{ "index", "reason" }] }`. Au plus 60 termes. Erreur `429` : trop d'envois, avec `Retry-After`.

`GET /v1/lexicon?reading=fr&since=0` → `{ "terms": [...], "cursor": 123, "more": false }`. Redonner `cursor` dans `since` pour ne télécharger que les nouveautés.

Le plan gratuit peut mettre une minute à répondre au réveil : l'app doit patienter 90 secondes et réessayer plus tard sans bloquer.

## Essayer en local

```bash
cd server
npm install
npm test
```

Les tests couvrent le contrôle des entrées, la preuve de travail, les limites, les confirmations, la vérification avec les quotas, les pauses et les reprises, et chaque réponse possible de Gemini.

Pour lancer le serveur sans base ni clé, avec une base en mémoire :

```bash
ALLOW_MEMORY_DB=1 IP_SALT=0123456789abcdef CHALLENGE_SECRET=0123456789abcdef ADMIN_TOKEN=0123456789abcdef01234567 node src/server.js
```
