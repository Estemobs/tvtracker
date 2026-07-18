import { db } from '../db/index.js';

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.)?(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+(?:\?.*)?$/i;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

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

async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(`Discord a refusé le webhook (${response.status}).`);
  }
}

function buildPayload(showTitle, nextEpisode, poster) {
  const episodeLabel = `S${nextEpisode.season}E${nextEpisode.episode_number}`;
  const payload = {
    username: 'TVTracker',
    content: `Nouvel épisode disponible pour ${showTitle} : ${episodeLabel}`,
    embeds: [
      {
        title: showTitle,
        description: `L'épisode ${episodeLabel} est maintenant disponible.`,
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
        us.show_id,
        us.discord_last_notified_episode_key,
        s.title,
        s.poster,
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

    for (const row of rows) {
      let nextEpisode = null;
      try {
        nextEpisode = JSON.parse(row.next_episode_json);
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
        await sendWebhook(target.webhookUrl, buildPayload(target.showTitle, target.nextEpisode, target.poster));
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