# Cahier des charges — Application web de suivi de séries, animes et films
*(Projet de remplacement de TV Time — nom de code provisoire : « TVTracker »)*

---

## 1. Contexte et objectifs

TV Time arrive en fin de vie. L'objectif est de recréer une application équivalente, en version web responsive (utilisable confortablement sur téléphone, tablette et PC), permettant à un petit groupe d'utilisateurs de suivre leur progression sur des séries, animes et films.

**Objectifs principaux :**
- Suivre épisode par épisode la progression de chaque utilisateur sur ses séries et animes.
- Marquer les films comme vus.
- Consulter des statistiques personnelles (temps de visionnage, contenus terminés).
- Découvrir et ajouter de nouveaux contenus via un explorateur.
- Contrôler l'accès : les inscriptions sont soumises à la validation d'un administrateur (le créateur du projet).

---

## 2. Périmètre

### Inclus
- Interface web responsive (mobile-first).
- Authentification (login / register avec validation admin).
- Gestion des séries, animes et films par utilisateur.
- Suivi de progression par épisode / saison.
- Statistiques personnelles.
- Page profil modifiable.
- Panneau d'administration minimal (validation des comptes).

### Exclu (v1)
- Application mobile native (iOS/Android).
- Fonctions sociales (commentaires entre utilisateurs, suivis d'amis, feed).
- Notifications push / e-mails de rappel de diffusion.
- Streaming ou lecture de contenu (l'app ne diffuse rien, elle ne fait que du suivi).

---

## 3. Utilisateurs et rôles

| Rôle | Droits |
|---|---|
| **Visiteur** | Accès uniquement aux pages Login et Register. |
| **Utilisateur en attente** | Compte créé mais non validé : ne peut pas se connecter, message « compte en attente de validation ». |
| **Utilisateur validé** | Accès complet aux 4 menus (Séries, Films, Explorer, Profil). Ses données sont privées. |
| **Administrateur** (toi) | Tout ce que fait un utilisateur + validation/refus des inscriptions + suppression/désactivation de comptes. |

---

## 4. Authentification

### 4.1 Page d'inscription (Register)
- Champs : nom d'utilisateur, e-mail, mot de passe, confirmation du mot de passe.
- À la soumission : le compte est créé avec le statut **« en attente »**.
- L'utilisateur voit un message clair : *« Votre compte doit être approuvé par un administrateur avant de pouvoir vous connecter. »*
- (Optionnel) L'admin reçoit une notification (badge dans son interface).

### 4.2 Page de connexion (Login)
- Champs : e-mail (ou nom d'utilisateur) + mot de passe.
- Cas gérés :
  - Identifiants invalides → message d'erreur générique.
  - Compte en attente → message « en attente de validation ».
  - Compte refusé/désactivé → message adapté.
- Session persistante (« rester connecté ») via token (JWT ou session serveur).

### 4.3 Sécurité
- Mots de passe hachés (bcrypt ou argon2), jamais stockés en clair.
- Protection contre le brute force (limitation de tentatives).
- HTTPS obligatoire en production.

---

## 5. Structure de l'application — les 4 menus

Navigation principale :
- **Mobile** : barre de navigation fixe en bas (4 icônes).
- **Desktop** : barre latérale ou header horizontal.

Les 4 menus : **Séries** · **Films** · **Explorer** · **Profil**

### 5.1 Menu « Séries »

C'est l'écran principal. Il regroupe les **séries et animes** que l'utilisateur suit.

**Liste :**
- Chaque entrée affiche : l'affiche (poster) de la série, le titre, et une **barre de progression** (épisodes vus / épisodes totaux, ex. « 34/62 — 55 % »).
- (Optionnel) Indication du prochain épisode à voir (ex. « À suivre : S03E05 »).
- Filtres / onglets possibles : *En cours* / *Terminées* / *Toutes*, et séparation ou filtre *Séries* / *Animes*.
- Tri : dernière activité, alphabétique, progression.

**Fiche série (au clic sur une série) :**
- Bannière / affiche, titre, note globale, genres, statut de diffusion.
- **Synopsis** de la série.
- **Avis et note** : la note publique (issue de l'API de données) et possibilité pour l'utilisateur de mettre **sa propre note** (ex. sur 10) et éventuellement un avis texte personnel.
- **Liste des épisodes groupés par saison** :
  - Accordéon par saison (Saison 1, Saison 2, ...).
  - Chaque épisode : numéro, titre, durée, case à cocher « vu ».
  - Bouton **« Marquer toute la saison comme vue »** par saison.
- Actions globales sur la série :
  - **« Marquer comme complètement vue »** (coche tous les épisodes, passe la série en « Terminée »).
  - **« Supprimer de ma liste »** (avec confirmation), ce qui supprime aussi la progression associée.

**Règles de progression :**
- La barre de progression = épisodes cochés / épisodes existants.
- Cocher un épisode enregistre la date de visionnage (utile pour les stats).
- Décocher un épisode retire le temps correspondant des stats.
- Une série est « terminée » quand 100 % des épisodes diffusés sont cochés (ou quand l'utilisateur la valide manuellement comme vue).

### 5.2 Menu « Films »

- Liste des films de l'utilisateur, avec affiche + titre.
- Deux états : **À voir** / **Vu** (bouton de bascule).
- Fiche film au clic : affiche, synopsis, durée, note publique + note personnelle, bouton « Marquer comme vu », bouton « Supprimer de ma liste ».
- Filtres : À voir / Vus / Tous ; tri par date d'ajout, titre, note.

### 5.3 Menu « Explorer »

C'est ici qu'on **cherche et ajoute** des séries, animes et films.

- **Barre de recherche** (recherche en temps réel) sur l'ensemble du catalogue.
- Onglets ou filtre par type : Séries / Animes / Films.
- Sections de découverte : Tendances, Populaires, Nouveautés, Par genre.
- Chaque résultat : affiche, titre, année, note.
- Au clic : fiche de présentation (synopsis, note, saisons/durée) avec bouton **« Ajouter à ma liste »**.
- Si le contenu est déjà dans la liste de l'utilisateur, l'indiquer clairement (badge « Déjà ajouté »).

**Source des données (recommandation) :** API **TMDB** (The Movie Database), gratuite pour usage non commercial, qui fournit affiches, synopsis, notes, saisons, épisodes et durées pour les séries, animes et films. Alternative/complément pour les animes : API Jikan (MyAnimeList) ou AniList.

### 5.4 Menu « Profil »

**Informations personnelles :**
- Avatar, nom d'utilisateur, e-mail.
- Modification des infos : changer avatar, nom d'utilisateur, e-mail, mot de passe (avec confirmation de l'ancien mot de passe).

**Statistiques :**
- **Temps total de visionnage** (global), avec détail par type : séries / animes / films.
- Temps passé **devant chaque série / film** (classement, ex. top 10 des contenus les plus regardés en heures).
- Nombre d'épisodes vus, nombre de films vus.
- (Optionnel) Graphiques : activité par mois, répartition par genre.

**Listes des contenus terminés :**
- Liste des **films terminés**.
- Liste des **séries terminées**.
- Liste des **animes terminés**.
- Présentation en grilles d'affiches, avec compteur pour chaque catégorie.

---

## 6. Panneau d'administration

Accessible uniquement au compte admin (menu supplémentaire ou section dans Profil) :
- **Liste des inscriptions en attente** : nom, e-mail, date de demande, boutons **Approuver** / **Refuser**.
- Liste des utilisateurs existants : possibilité de désactiver ou supprimer un compte.
- (Optionnel v2) Statistiques globales de l'instance.

---

## 7. Exigences techniques

### 7.1 Responsive / UI
- Approche **mobile-first**, breakpoints classiques (~640 px, ~1024 px).
- Mobile : navigation en bas d'écran, grilles 2-3 affiches par ligne.
- Desktop : sidebar ou header, grilles 5-6 affiches par ligne.
- Thème sombre par défaut (adapté à ce type d'app), thème clair optionnel.
- Images lazy-loadées, squelettes de chargement.

### 7.2 Stack proposée (à valider)
- **Front** : React (ou Vue/Svelte) + Tailwind CSS, buildé en statique.
- **Back** : Node.js (Express/Fastify) — sert l'API REST **et** les fichiers du front (contrainte mono-conteneur).
- **Base de données** : **SQLite** (fichier unique sur le volume persistant) — retenu pour l'architecture tout-en-un.
- **Auth** : JWT ou sessions.
- **Données catalogue** : API TMDB (+ cache local des métadonnées pour limiter les appels et conserver l'historique même si l'API change).

### 7.3 Modèle de données (simplifié)
- `users` : id, username, email, password_hash, avatar, role (user/admin), status (pending/active/disabled), created_at.
- `shows` : id, tmdb_id, type (série/anime), titre, poster, synopsis, note, nb_saisons, nb_episodes... (cache TMDB).
- `episodes` : id, show_id, saison, numero, titre, durée.
- `movies` : id, tmdb_id, titre, poster, synopsis, durée, note.
- `user_shows` : user_id, show_id, statut (en cours/terminée), note_perso, avis_perso, date_ajout.
- `user_episodes` : user_id, episode_id, vu (bool), date_vu.
- `user_movies` : user_id, movie_id, statut (à voir/vu), note_perso, date_vu.

### 7.4 Performance et divers
- Temps de chargement des listes < 1 s pour ~200 contenus par utilisateur.
- Marquage d'un épisode : mise à jour optimiste (instantanée à l'écran).
- Sauvegardes régulières de la base de données.

### 7.5 Déploiement — conteneur unique « tout-en-un »

Le projet doit tenir dans **un seul conteneur Docker** pour coller aux contraintes de l'hébergeur : une seule image à lancer, et l'application est en ligne.

**Architecture de l'image unique :**

| Élément | Solution |
|---|---|
| Frontend | Buildé en fichiers statiques lors de la construction de l'image (multi-stage), puis servi directement par le backend |
| Backend / API | Serveur Node.js (ou équivalent) qui sert à la fois l'API REST et les fichiers du front sur le même port |
| Base de données | **SQLite** — un simple fichier, embarqué dans le conteneur, aucun service BDD séparé nécessaire. Largement suffisant pour un petit groupe d'utilisateurs |
| HTTPS | Géré par l'hébergeur (reverse proxy de la plateforme), le conteneur expose un seul port HTTP |

**Exigences :**
- **Dockerfile multi-stage** : étape 1 build du front, étape 2 image finale légère (backend + fichiers statiques).
- Un seul port exposé, configurable via variable d'environnement.
- Toute la configuration passe par des **variables d'environnement** (clé API TMDB, secret JWT, identifiants admin initiaux...) — aucun secret en dur.
- **Volume persistant unique** monté sur un dossier `/data` contenant : le fichier SQLite + les uploads (avatars). C'est le seul élément à préserver entre les mises à jour.
- Les migrations de base de données s'exécutent automatiquement au démarrage du conteneur.
- Healthcheck intégré à l'image.
- Un `docker-compose.yml` d'exemple est quand même fourni (un seul service) pour tester en local et documenter les variables.
- README avec la commande unique de lancement (`docker run` ou `docker compose up -d`).

**Limite assumée :** SQLite convient très bien pour quelques dizaines d'utilisateurs. Si le projet grossissait fortement, une migration vers PostgreSQL (conteneur séparé) resterait possible plus tard.

### 7.6 Déploiement continu (CI/CD) — mise à jour automatique depuis GitHub

**Objectif :** chaque `push` (ou merge) sur la branche `main` du dépôt GitHub met à jour le site en production **automatiquement**, sans intervention manuelle sur le serveur.

**Fonctionnement (GitHub Actions + registre d'images) :**
1. Push sur `main` → déclenchement d'un workflow **GitHub Actions**.
2. Le workflow build l'image unique et la pousse sur **GHCR** (GitHub Container Registry, gratuit) avec le tag `latest` + un tag de version.
3. Le serveur applique la mise à jour, selon ce que permet l'hébergeur :
   - **Option A — Webhook de redéploiement** *(si la plateforme d'hébergement en propose un, cas le plus courant)* : à la fin du build, GitHub Actions appelle l'URL de webhook de l'hébergeur, qui tire la nouvelle image et redémarre le conteneur. Mise à jour immédiate, un seul conteneur au total.
   - **Option B — Watchtower** *(si l'hébergeur autorise un 2ᵉ mini-conteneur)* : Watchtower (~15 Mo) surveille le registre et redéploie automatiquement dès qu'une nouvelle image apparaît, sans aucune configuration côté GitHub.

**Exigences :**
- Le volume `/data` (SQLite + uploads) n'est jamais touché par un redéploiement : aucune perte de données lors des mises à jour.
- Les migrations de BDD se jouent automatiquement au démarrage de la nouvelle version.
- Possibilité de **rollback** simple : relancer le conteneur sur le tag de version précédent.
- (Optionnel) Le workflow lance les tests avant de builder : si les tests échouent, pas de mise en production.
- (Optionnel) Une branche `dev` publiant une image `:dev` pour un environnement de test.

---

## 8. Parcours utilisateur type

1. Un ami s'inscrit → compte en attente.
2. Tu approuves depuis le panneau admin.
3. Il se connecte, arrive sur **Séries** (vide), passe par **Explorer**, cherche « One Piece », l'ajoute.
4. La série apparaît dans **Séries** avec une barre à 0 %.
5. Il ouvre la fiche, coche les épisodes vus (ou des saisons entières), la barre progresse.
6. Ses heures s'accumulent dans **Profil → Statistiques**.
7. Quand tout est coché (ou validé manuellement), la série passe dans ses « Séries/Animes terminés ».

---

## 9. Découpage en lots (proposition)

| Lot | Contenu | Priorité |
|---|---|---|
| **Lot 1 — MVP** | Docker Compose + pipeline CI/CD GitHub, auth + validation admin, menu Séries (liste, fiche, coche épisodes/saisons, suppression, progression), Explorer (recherche + ajout via TMDB) | Indispensable |
| **Lot 2** | Menu Films, Profil (infos + modification), statistiques de base (temps total, terminés) | Haute |
| **Lot 3** | Notes/avis perso, stats détaillées par contenu, filtres et tris avancés, thème clair | Moyenne |
| **Lot 4 (v2)** | Notifications de nouveaux épisodes, graphiques avancés, import des données TV Time | Bonus |

---

## 10. Points à trancher (questions ouvertes)

1. **Stack technique** : préférence pour Node/React, PHP/Laravel, autre ?
2. **Nombre d'utilisateurs visés** (dimensionne l'hébergement et la BDD).
3. ~~**Hébergement**~~ → tranché : **conteneur Docker unique** (backend + front + SQLite dans une seule image, volume `/data` persistant). Reste à vérifier : ton hébergeur propose-t-il un **webhook de redéploiement** (Option A) ou faut-il un mini-conteneur Watchtower (Option B) ?
4. **Import TV Time** : veux-tu récupérer ton historique existant (export CSV de TV Time) ? Si oui, à intégrer au Lot 1 ou 2.
5. Les **animes** : simple étiquette sur les séries, ou source de données dédiée (AniList/MAL) pour de meilleures métadonnées ?
6. Nom définitif du projet.
