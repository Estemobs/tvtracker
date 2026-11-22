import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db/index.js';
import { HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './utils/timeouts.js';
import { isSafeUploadPath } from './utils/uploads.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import exploreRoutes, { startTrendingWarmup } from './routes/explore.js';
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
app.use(cookieParser());

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/api/version', (req, res) => res.json({ version: process.env.GIT_SHA || 'dev' }));

app.use('/uploads', (req, res, next) => {
  if (!isSafeUploadPath(req.path)) return res.status(404).end();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(path.join(DATA_DIR, 'uploads')));

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
  startTrendingWarmup();
});

// The TV Time import returns 202 immediately and runs in the background, so the HTTP request
// only covers the upload. Keep finite timeouts to prevent Slowloris-style connection exhaustion.
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
