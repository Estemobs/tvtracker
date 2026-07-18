import { db } from '../db/index.js';
import { cacheShow } from './catalog.js';

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.)?(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+(?:\?.*)?$/i;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MESSAGE_MAX_LENGTH = 300;
const PLACEHOLDER_RE = /\{(titre|saison|numero|episode|date)\}/g;

export const DEFAULT_MESSAGE_TEMPLATE = 'Nouvel épisode disponible pour {titre} : {episode}';

let sweepRunning = false;
let sweepTimer = null;

export function normalizeDiscordWebhookUrl(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!DISCORD_WEBHOOK_RE.test(trimmed)) {
    throw new Error('Lien de webhook Discord invalide.');
  }
  return trimmed;
}

export function normalizeDiscordMessageTemplate(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    throw new Error(`Le message est trop long (${MESSAGE_MAX_LENGTH} caractères max).`);
  }
  return trimmed;
}

// Placeholders: {titre} nom de la série, {episode} "S1E5", {saison}, {numero}, {date} de diffusion.
export function renderMessageTemplate(template, vars) {
  return template.replace(PLACEHOLDER_RE, (_, key) => vars[key] ?? '');
}

export async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(`Discord a refusé le webhook (${response.status}).`);
  }
}

export function buildPayload(showTitle, nextEpisode, poster, messageTemplate) {
  const episodeLabel = `S${nextEpisode.season}E${nextEpisode.episode_number}`;
  const vars = {
    titre: showTitle,
    saison: String(nextEpisode.season),
    numero: String(nextEpisode.episode_number),
    episode: episodeLabel,
    date: nextEpisode.air_date,
  };
  const content = renderMessageTemplate(messageTemplate || DEFAULT_MESSAGE_TEMPLATE, vars);

  // The message goes in top-level `content`, not the embed: Discord only pings/notifies for
  // mentions (roles, users, @everyone) placed in `content` — a mention inside an embed's title,
  // description or fields is rendered but silent, so a user putting a role mention in their
  // template would never actually get notified.
  const payload = {
    username: 'TVTracker',
    content,
    embeds: [
      {
        title: showTitle,
        color: 0x5865f2,
        footer: { text: `Diffusion prévue le ${nextEpisode.air_date}` },
      },
    ],
  };

  if (poster) {
    payload.embeds[0].thumbnail = { url: poster };
  }

  return payload;
}

export async function sweepDiscordNotifications() {
  if (sweepRunning) return;
  sweepRunning = true;

  try {
    const rows = db.prepare(`
      SELECT
        u.id AS user_id,
        u.discord_webhook_url,
        u.discord_message_template,
        us.show_id,
        us.discord_last_notified_episode_key,
        s.title,
        s.poster,
        s.source_id,
        s.next_episode_json
      FROM users u
      JOIN user_shows us ON us.user_id = u.id
      JOIN shows s ON s.id = us.show_id
      WHERE u.discord_webhook_url IS NOT NULL
        AND u.discord_webhook_url != ''
        AND us.status != 'completed'
        AND s.next_episode_json IS NOT NULL
    `).all();

    const today = new Date().toISOString().slice(0, 10);
    const targets = new Map();
    // Nothing else refreshes a show's cached `next_episode_json` unless a user happens to open its
    // page — left alone, a show nobody browses can sit with stale/outdated episode data for days,
    // so by the time it's finally refreshed the "next" episode has long since aired and this sweep
    // fires late (or batches several past-due shows at once). Refreshing here, once per distinct
    // show per sweep, keeps the data this check relies on at most a day old regardless of traffic.
    const refreshedShows = new Map();

    for (const row of rows) {
      let nextEpisodeJson = row.next_episode_json;
      if (!refreshedShows.has(row.show_id)) {
        try {
          const refreshed = await cacheShow(row.source_id);
          refreshedShows.set(row.show_id, refreshed?.next_episode_json ?? row.next_episode_json);
        } catch (error) {
          console.error('[discord-notify] refresh failed for show', row.show_id, error);
          refreshedShows.set(row.show_id, row.next_episode_json);
        }
      }
      nextEpisodeJson = refreshedShows.get(row.show_id);

      let nextEpisode = null;
      try {
        nextEpisode = JSON.parse(nextEpisodeJson);
      } catch {
        continue;
      }

      if (!nextEpisode?.air_date || nextEpisode.air_date > today) continue;

      const episodeKey = `${nextEpisode.season}x${nextEpisode.episode_number}`;
      if (row.discord_last_notified_episode_key === episodeKey) continue;

      const targetKey = `${row.discord_webhook_url}::${row.show_id}::${episodeKey}`;
      if (!targets.has(targetKey)) {
        targets.set(targetKey, {
          webhookUrl: row.discord_webhook_url,
          messageTemplate: row.discord_message_template,
          showTitle: row.title,
          poster: row.poster,
          episodeKey,
          nextEpisode,
          rows: [],
        });
      }
      targets.get(targetKey).rows.push(row);
    }

    for (const target of targets.values()) {
      try {
        await sendWebhook(target.webhookUrl, buildPayload(target.showTitle, target.nextEpisode, target.poster, target.messageTemplate));
        const update = db.prepare(`UPDATE user_shows SET discord_last_notified_episode_key = ? WHERE user_id = ? AND show_id = ?`);
        for (const row of target.rows) {
          update.run(target.episodeKey, row.user_id, row.show_id);
        }
      } catch (error) {
        console.error('[discord-notify] webhook failed:', error);
      }
    }
  } finally {
    sweepRunning = false;
  }
}

export function startDiscordNotificationLoop() {
  if (sweepTimer) return sweepTimer;
  void sweepDiscordNotifications().catch((error) => {
    console.error('[discord-notify] initial sweep failed:', error);
  });
  sweepTimer = setInterval(() => {
    void sweepDiscordNotifications().catch((error) => {
      console.error('[discord-notify] sweep failed:', error);
    });
  }, SWEEP_INTERVAL_MS);
  return sweepTimer;
}