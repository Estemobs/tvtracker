import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db/index.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import exploreRoutes from './routes/explore.js';
import showsRoutes from './routes/shows.js';
import moviesRoutes from './routes/movies.js';
import profileRoutes from './routes/profile.js';
import { startDiscordNotificationLoop } from './services/discordNotifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'public');

bootstrapAdmin();

// If something crashes the process outright (e.g. running out of memory while buffering a large
// TV Time archive), Docker just sees the container die and restart — from the outside that can
// look identical to a proxy timing out (502), with no clue which one actually happened. Logging
// here at least leaves a trace in `docker logs` for the moment right before it goes down.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (req, res) => res.json({ version: process.env.GIT_SHA || 'dev' }));

app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/explore', exploreRoutes);
app.use('/api/shows', showsRoutes);
app.use('/api/movies', moviesRoutes);
app.use('/api/profile', profileRoutes);

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur.' });
});

const server = app.listen(PORT, () => {
  console.log(`[tvtracker] backend listening on port ${PORT}`);
  startDiscordNotificationLoop();
});

// The TV Time import processes hundreds of shows/movies against external APIs and can take
// several minutes — Node's default 5-minute request timeout would otherwise kill it mid-import.
server.requestTimeout = 0;
server.headersTimeout = 0;
