# TVTracker

Application web de suivi de séries, animes et films, pour un petit groupe d'utilisateurs avec inscriptions validées par un administrateur. Voir le [cahier des charges](cahier-des-charges-tvtracker.md) pour le détail fonctionnel.

## Stack

- **Frontend** : React + Vite + Tailwind CSS (mobile-first, thème sombre), buildé en statique.
- **Backend** : Node.js + Express, sert l'API REST et les fichiers statiques du front sur le même port.
- **Base de données** : SQLite (`better-sqlite3`), fichier unique dans `/data`.
- **Auth** : JWT + bcrypt, inscriptions en attente de validation admin.
- **Catalogue** : aucune clé d'API requise — [TVmaze](https://www.tvmaze.com/api) pour les séries/animes (recherche, saisons/épisodes) et [iTunes](https://itunes.apple.com) (charts) + [Wikipédia](https://fr.wikipedia.org) (recherche) pour les films, mise en cache locale.
- **Déploiement** : image Docker unique multi-stage (front + back + SQLite), volume persistant `/data`.

## Lancer en local avec Docker (recommandé)

1. Copier `.env.example` en `.env` et renseigner au minimum `JWT_SECRET` :
   ```bash
   cp .env.example .env
   ```
   - `JWT_SECRET` : `openssl rand -hex 32`
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
JWT_SECRET=dev ADMIN_EMAIL=admin@test.com ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass npm run dev

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
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte admin initial (créé au premier boot si absent) | oui |
| `DATA_DIR` | Dossier de données (SQLite + uploads) | non (défaut `/data` en conteneur) |

## CI/CD et déploiement automatique

Le workflow [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) build l'image et la pousse sur GHCR (`ghcr.io/estemobs/tvtracker`) à chaque push sur `main` (tag `latest`) ou `dev` (tag `dev`), plus un tag de version par commit. Le dépôt de travail est un Gitea auto-hébergé, mirroré vers [github.com/Estemobs/tvtracker](https://github.com/Estemobs/tvtracker) qui exécute le workflow.

**Mise à jour automatique du serveur** : utiliser [`docker-compose.prod.yml`](docker-compose.prod.yml), qui tire l'image GHCR (au lieu de builder localement) et embarque **Watchtower** :

```bash
docker compose -f docker-compose.prod.yml up -d
```

Chaîne complète : push Gitea → miroir GitHub → Actions build + push GHCR → Watchtower détecte la nouvelle image (vérification toutes les 5 min) → redéploie le conteneur. Le volume `/data` n'est jamais touché.

> ⚠️ Après le **premier** run du workflow, le paquet GHCR est privé par défaut : aller sur la page du package (`github.com/Estemobs?tab=packages`) → Package settings → Change visibility → **Public**, sinon le serveur devra faire `docker login ghcr.io`. À faire une seule fois.

Le `docker-compose.yml` de base (build local) reste utile pour le développement. Rollback : `docker compose -f docker-compose.prod.yml up -d` après avoir remplacé `latest` par le tag `sha-<commit>` voulu.

## Structure

```
backend/    API Express + SQLite + intégration catalogue (TVmaze / iTunes / Wikipédia)
frontend/   Application React (Séries, Films, Explorer, Profil, Admin)
Dockerfile  Build multi-stage (frontend -> dépendances backend -> image finale)
```

## Catalogue sans clé d'API

Aucune inscription ni clé d'API n'est nécessaire pour le menu Explorer :

- **Séries/Animes** : [TVmaze](https://www.tvmaze.com/api) — recherche, fiches, saisons/épisodes, notes. Détection anime via le genre `Anime` renvoyé par l'API.
- **Films** : deux sources combinées puisque l'API de recherche films d'iTunes a été désactivée par Apple ces dernières années (seuls le lookup par identifiant et les classements RSS fonctionnent encore) :
  - Recherche libre → Wikipédia (français), filtré aux pages dont la description commence par « film ».
  - Tendances/populaires → classement officiel iTunes (charts).

  Conséquence assumée : les films ont un synopsis et une affiche, mais pas toujours de durée, de genre ou de note publique (ces champs restent vides selon la source d'origine), contrairement à TMDB qui les fournirait tous mais impose une clé d'API.

## Statut par rapport au cahier des charges

Réalisé : Lot 1 (auth + validation admin, menu Séries complet, Explorer sans clé d'API, Docker + CI) et Lot 2 (menu Films, Profil avec édition et statistiques). Non couverts : thème clair, graphiques avancés, import d'historique externe, notifications (Lot 3/4, marqués optionnels ou v2 dans le cahier des charges).
