# TVTracker

Application web de suivi de séries, animes et films, pour un petit groupe d'utilisateurs avec inscriptions validées par un administrateur. Voir le [cahier des charges](cahier-des-charges-tvtracker.md) pour le détail fonctionnel.

## Stack

- **Frontend** : React + Vite + Tailwind CSS (mobile-first, thème sombre), buildé en statique.
- **Backend** : Node.js + Express, sert l'API REST et les fichiers statiques du front sur le même port.
- **Base de données** : SQLite (`better-sqlite3`), fichier unique dans `/data`.
- **Auth** : JWT + bcrypt, inscriptions en attente de validation admin.
- **Catalogue** : API TMDB (recherche, tendances, fiches, saisons/épisodes), mise en cache locale.
- **Déploiement** : image Docker unique multi-stage (front + back + SQLite), volume persistant `/data`.

## Lancer en local avec Docker (recommandé)

1. Copier `.env.example` en `.env` et renseigner au minimum `JWT_SECRET` et `TMDB_API_KEY` :
   ```bash
   cp .env.example .env
   ```
   - `JWT_SECRET` : `openssl rand -hex 32`
   - `TMDB_API_KEY` : clé API v3 gratuite sur https://www.themoviedb.org/settings/api
   - `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` : compte admin créé automatiquement au premier démarrage.

2. Lancer :
   ```bash
   docker compose up -d --build
   ```

3. L'application est disponible sur http://localhost:3000 (ou le port défini par `PORT`).

Les données (base SQLite + avatars uploadés) sont conservées dans le volume Docker `tvtracker_data`, jamais touché par une mise à jour d'image.

## Développement sans Docker

Le back utilise `better-sqlite3` (module natif) : installez les dépendances avec une version de Node compatible (Node 20 recommandé, cf. `Dockerfile`).

```bash
# Backend
cd backend
npm install
JWT_SECRET=dev TMDB_API_KEY=xxx ADMIN_EMAIL=admin@test.com ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass npm run dev

# Frontend (autre terminal, proxy vers le backend sur :3000)
cd frontend
npm install
npm run dev
```

## Variables d'environnement

| Variable | Rôle | Requis |
|---|---|---|
| `PORT` | Port HTTP exposé par le conteneur | non (défaut 3000) |
| `JWT_SECRET` | Secret de signature des tokens de session | oui |
| `TMDB_API_KEY` | Clé API TMDB pour le menu Explorer | oui pour Explorer |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte admin initial (créé au premier boot si absent) | oui |
| `DATA_DIR` | Dossier de données (SQLite + uploads) | non (défaut `/data` en conteneur) |

## CI/CD

Le workflow [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) build l'image et la pousse sur GHCR (`ghcr.io/<repo>`) à chaque push sur `main` (tag `latest`) ou `dev` (tag `dev`), plus un tag de version par commit. Si une variable de dépôt `DEPLOY_WEBHOOK_URL` est configurée, un webhook de redéploiement est appelé après le build (Option A du cahier des charges — sinon utiliser Watchtower, Option B).

> Le dépôt distant actuellement configuré (`origin`) est une instance Gitea auto-hébergée, pas GitHub : ce workflow ne se déclenchera que si le code est poussé vers un dépôt GitHub (miroir ou changement de remote). Gitea a son propre système d'Actions (syntaxe très proche) si vous préférez rester dessus.

## Structure

```
backend/    API Express + SQLite + intégration TMDB
frontend/   Application React (Séries, Films, Explorer, Profil, Admin)
Dockerfile  Build multi-stage (frontend -> dépendances backend -> image finale)
```

## Statut par rapport au cahier des charges

Réalisé : Lot 1 (auth + validation admin, menu Séries complet, Explorer TMDB, Docker + CI) et Lot 2 (menu Films, Profil avec édition et statistiques). Non couverts : thème clair, graphiques avancés, import d'historique externe, notifications (Lot 3/4, marqués optionnels ou v2 dans le cahier des charges).
