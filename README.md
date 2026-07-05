# 📺 TVTracker

> Application web auto-hébergée de suivi de séries, animes et films — épisode par épisode, avec statistiques de visionnage. Pensée pour un petit groupe (famille/amis) : les inscriptions sont validées par l'administrateur.

**Zéro clé d'API** · **Un seul conteneur Docker** · **Mise à jour automatique à chaque push**

---

## ✨ Fonctionnalités

| Menu | Ce qu'on y fait |
|---|---|
| **📺 Séries** | Suivi épisode par épisode ou saison entière en un clic, barre de progression, filtres (en cours / terminées, séries / animes), note personnelle |
| **🎬 Films** | Liste à voir / vu, bascule en un clic, note personnelle |
| **🔍 Explorer** | Recherche en temps réel (séries, animes, films), tendances, ajout à sa liste, badge « Déjà ajouté » |
| **👤 Profil** | Temps de visionnage total et par type, top contenus, grilles des terminés, édition avatar/e-mail/mot de passe |
| **🛠️ Admin** | Validation/refus des inscriptions, désactivation/suppression de comptes |

Interface **mobile-first** (navigation en bas d'écran sur téléphone, sidebar sur desktop), thème sombre, chargement paresseux des affiches.

## 🏗️ Comment ça marche

```
┌─────────────────────────────────────────────────┐
│               Conteneur Docker unique           │
│                                                 │
│  React (statique) ──► Express (API + fichiers)  │
│                          │                      │
│                          ├──► SQLite  ──┐       │
│                          │              ▼       │
│                          │        volume /data  │
│                          │      (BDD + avatars) │
│                          ▼                      │
│              TVmaze · iTunes · Wikipédia        │
│               (catalogue, sans clé d'API)       │
└─────────────────────────────────────────────────┘
```

- **Frontend** : React + Vite + Tailwind CSS, buildé en fichiers statiques dans l'image.
- **Backend** : Node.js + Express — sert l'API REST **et** le front sur le même port.
- **Base de données** : SQLite (`better-sqlite3`), un simple fichier dans le volume `/data`. Migrations automatiques au démarrage.
- **Auth** : JWT + bcrypt, verrouillage anti brute-force, statuts de compte (en attente / actif / refusé / désactivé).
- **Catalogue** : métadonnées mises en cache localement — les listes restent consultables même si une source externe tombe.

### Catalogue sans clé d'API

| Contenu | Source | Détail |
|---|---|---|
| Séries & animes | [TVmaze](https://www.tvmaze.com/api) | Recherche, fiches, saisons/épisodes, notes. Les animes sont détectés via le genre `Anime` |
| Films — recherche | [Wikipédia FR](https://fr.wikipedia.org) | Pages dont la description commence par « film » |
| Films — tendances | [iTunes](https://itunes.apple.com) | Classement officiel des films (l'API de *recherche* films d'iTunes a été désactivée par Apple, seuls lookup et charts fonctionnent) |

Compromis assumé : certains films n'ont pas de durée, genre ou note publique selon la source — c'est le prix de l'absence totale de clé d'API.

## 🚀 Démarrage rapide

```bash
git clone http://<votre-gitea>/estemobs/tvtracker.git && cd tvtracker
cp .env.example .env      # puis éditer : JWT_SECRET, ADMIN_*
docker compose up -d --build
```

L'application est sur **http://localhost:3000**. Le compte admin défini dans `.env` est créé automatiquement au premier démarrage ; les amis s'inscrivent ensuite via la page Register et apparaissent dans l'onglet Admin pour validation.

### Variables d'environnement

| Variable | Rôle | Requis |
|---|---|---|
| `JWT_SECRET` | Signature des sessions — générer avec `openssl rand -hex 32` | ✅ |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Compte admin initial (créé au premier boot s'il n'existe pas) | ✅ |
| `PORT` | Port HTTP exposé | non (3000) |
| `DATA_DIR` | Dossier de données | non (`/data`) |

Aucun secret en dur, aucune clé d'API à obtenir.

## 🔄 Déploiement continu

Chaque push met le site à jour **tout seul** :

```
push Gitea ──► miroir GitHub ──► GitHub Actions ──► image sur GHCR
                                                        │
        serveur à jour ◄── Watchtower (vérifie /5 min) ◄┘
```

1. Le dépôt Gitea est mirroré vers [github.com/Estemobs/tvtracker](https://github.com/Estemobs/tvtracker).
2. À chaque push sur `main`, le [workflow](.github/workflows/docker-publish.yml) build l'image et la publie sur **GHCR** : `ghcr.io/estemobs/tvtracker` (tags `latest` + `sha-<commit>` ; la branche `dev` publie `:dev`).
3. Sur le serveur, [`docker-compose.prod.yml`](docker-compose.prod.yml) tire l'image GHCR et lance **Watchtower**, qui redéploie automatiquement dès qu'une nouvelle image apparaît :

```bash
docker compose -f docker-compose.prod.yml up -d
```

- **Les données survivent à tout** : le volume `tvtracker_data` (SQLite + avatars) n'est jamais touché par une mise à jour.
- **Rollback** : remplacer `latest` par un tag `sha-<commit>` dans le compose et relancer.
- Le `docker-compose.yml` de base (build local) reste là pour le développement.

## 🧑‍💻 Développement

```bash
# Backend (Node 20 recommandé — better-sqlite3 est un module natif compilé)
cd backend && npm install
JWT_SECRET=dev ADMIN_EMAIL=admin@test.com ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass npm run dev

# Frontend (autre terminal — proxy /api vers :3000)
cd frontend && npm install
npm run dev
```

### Structure du dépôt

```
backend/
  src/
    db/            connexion SQLite + migrations SQL (jouées au boot)
    middleware/    auth JWT, garde admin
    routes/        auth, admin, shows, movies, explore, profile
    services/      tvmaze.js, itunes.js, wikipedia.js, catalog.js (cache)
frontend/
  src/
    pages/         Series, Movies, Explore, Profile, Admin, Login, Register
    components/    NavBar, PosterCard, ProgressBar, Skeleton
    context/       AuthContext (session)
    api/           client fetch + gestion du token
Dockerfile             build multi-stage → image finale ~250 Mo
docker-compose.yml     développement (build local)
docker-compose.prod.yml  production (GHCR + Watchtower)
```

## 📋 Statut

Réalisé : **Lot 1** (auth + validation admin, Séries complet, Explorer, Docker + CI/CD) et **Lot 2** (Films, Profil + statistiques) du [cahier des charges](cahier-des-charges-tvtracker.md). Reste en option (Lot 3/4) : thème clair, graphiques avancés, import d'historique, notifications.
