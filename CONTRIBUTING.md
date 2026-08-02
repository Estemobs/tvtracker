# Contribution

Merci de vouloir contribuer à TVTracker !

## Bugs et idées

- Ouvrez une issue avec un titre clair et les étapes de reproduction.
- Précisez la version utilisée (image Docker ou commit).

## Développement

```bash
# Backend (Node 20)
cd backend && npm install
JWT_SECRET=dev ADMIN_EMAIL=admin@test.com ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass npm run dev

# Frontend (autre terminal)
cd frontend && npm install
npm run dev
```

## Pull requests

1. Décrivez le problème résolu et testez en local.
2. Gardez la PR petite et ciblée.
3. Vérifiez que l'application démarre avec `docker compose up -d --build`.
4. Référencez l'issue concernée dans la description.

Le style de code suit les conventions existantes (voir `backend/src/` et `frontend/src/`).
