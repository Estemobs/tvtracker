<p align="center">
  <img src="https://raw.githubusercontent.com/Estemobs/tvtracker/main/frontend/src/assets/logo.svg" width="72" height="72" alt="Logo TVTracker" />
</p>

<h1 align="center">TVTracker</h1>

> Application web auto-hébergée de suivi de séries, animes et films — épisode par épisode, avec statistiques de visionnage. Pensée pour un petit groupe (famille/amis) : les inscriptions sont validées par l'administrateur.

**Zéro clé d'API** · **Un seul conteneur Docker** · **Mise à jour automatique à chaque push**

---

## ✨ Fonctionnalités

| Menu | Ce qu'on y fait |
|---|---|
| **📺 Séries** | Suivi épisode par épisode ou saison entière en un clic, barre de progression, filtres (en cours / terminées, séries / animes), note personnelle |
| **🎬 Films** | Liste à voir / vu, bascule en un clic, note personnelle |
| **🔍 Explorer** | Recherche en temps réel (séries, animes, films), tendances, ajout à sa liste, badge « Déjà ajouté » |
| **👤 Profil** | Temps de visionnage total et par type, top contenus, grilles des terminés, édition avatar/e-mail/mot de passe, import de l'historique TV Time |
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

### Import de l'historique TV Time

Page **Profil → Importer depuis TV Time** : charge le fichier `.zip` de l'export RGPD téléchargé sur [gdpr.tvtime.com](https://gdpr.tvtime.com/gdpr/self-service) (compte TV Time requis, tel quel sans décompresser). Les séries sont recroisées via leur identifiant TheTVDB (`/lookup/shows?thetvdb=` sur TVmaze), les films par titre + année sur Wikipédia — sans clé d'API, comme le reste du catalogue. L'import tourne en tâche de fond côté serveur (l'upload répond immédiatement avec un identifiant de job) et l'interface affiche une barre de progression en temps réel (élément traité / total) le temps des quelques minutes que prennent les centaines d'appels externes ; il ne résout que l'affiche des films en priorité pour rester rapide (distribution et note se complètent d'eux-mêmes à la première ouverture de la fiche). Un résumé s'affiche une fois l'import terminé, avec une prévisualisation en jaquettes des séries et films récupérés, et un résumé de ce qui n'a pas pu être retrouvé (une nouvelle tentative plus tard résout souvent ces cas, généralement dus à des limites de débit passagères plutôt qu'à une absence réelle).

## 🚀 Démarrage rapide

```bash
git clone https://github.com/Estemobs/tvtracker.git && cd tvtracker
cp .env.example .env      # puis éditer : JWT_SECRET, ADMIN_*
docker compose up -d --build
```

Ou encore plus simple, sans cloner le dépôt — l'image prête à l'emploi est publiée sur GHCR :

```bash
docker run -d --name tvtracker -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_USERNAME=admin -e ADMIN_EMAIL=admin@exemple.com -e ADMIN_PASSWORD=changez-moi \
  -v tvtracker_data:/data \
  ghcr.io/estemobs/tvtracker:latest
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

Chaque push sur `main` met le site à jour **tout seul** :

```
push sur main ──► GitHub Actions ──► image publiée sur GHCR
                                            │
    serveur à jour ◄── Watchtower (vérifie /5 min) ◄┘
```

1. À chaque push sur `main`, le [workflow GitHub Actions](.github/workflows/docker-publish.yml) build l'image Docker et la publie sur **GHCR** : [`ghcr.io/estemobs/tvtracker`](https://github.com/Estemobs/tvtracker/pkgs/container/tvtracker) avec les tags `latest` + `sha-<commit>` (une branche `dev` publierait `:dev`).
2. Sur le serveur, [`docker-compose.prod.yml`](docker-compose.prod.yml) tire l'image depuis GHCR et lance **Watchtower** à côté, qui redéploie automatiquement le conteneur dès qu'une nouvelle image apparaît :

```bash
docker compose -f docker-compose.prod.yml up -d
```

- **Les données survivent à tout** : le volume `tvtracker_data` (SQLite + avatars) n'est jamais touché par une mise à jour.
- **Rollback** : remplacer `latest` par un tag `sha-<commit>` dans le compose et relancer.
- Le `docker-compose.yml` de base (build local) reste là pour le développement.
- Alternative à Watchtower : définir la variable de dépôt `DEPLOY_WEBHOOK_URL` dans GitHub (Settings → Secrets and variables → Actions → Variables) — le workflow appellera cette URL après chaque build pour déclencher un redéploiement immédiat côté hébergeur.

### Mettre à jour l'instance

**Première installation** (une seule fois, sur le serveur) :

```bash
mkdir -p /opt/tvtracker && cd /opt/tvtracker
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/Estemobs/tvtracker/main/docker-compose.prod.yml
cat > .env <<'EOF'
JWT_SECRET=...        # généré avec: openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
EOF
docker compose -f docker-compose.prod.yml up -d
```

**Après ça, c'est automatique** : chaque push sur `main` republie l'image sur GHCR, et Watchtower (lancé par ce même compose) la détecte et redéploie tout seul, en général dans les 5 minutes. Rien à refaire manuellement.

**Si ça ne se met pas à jour**, vérifier d'abord les logs de Watchtower :

```bash
docker logs tvtracker-watchtower
```

Erreur connue : `client version 1.25 is too old. Minimum supported API version is 1.40` — l'image `containrrr/watchtower` embarque un vieux client Docker par défaut, incompatible avec les versions récentes du moteur Docker. Le `docker-compose.prod.yml` du dépôt fixe déjà `DOCKER_API_VERSION=1.41` pour corriger ça ; si l'erreur apparaît quand même, s'assurer d'avoir bien la dernière version du fichier compose (`curl` la commande ci-dessus à nouveau pour l'écraser) puis `docker compose -f docker-compose.prod.yml up -d` pour recréer Watchtower avec la bonne config.

**Forcer une mise à jour immédiate** sans attendre Watchtower :

```bash
cd /opt/tvtracker   # ou le dossier où se trouve docker-compose.prod.yml
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Vérifier la version déployée** : le commit exact tourne dans l'appli est visible dans la barre latérale, juste à côté de « Se déconnecter » (cliquable vers GitHub), ou directement via `curl http://<serveur>:3000/api/version`. Pour comparer avec le dernier commit sur GitHub : [github.com/Estemobs/tvtracker/commits/main](https://github.com/Estemobs/tvtracker/commits/main). Si les deux hash correspondent, l'instance est à jour.

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
