import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';

const DEFAULT_DISCORD_TEMPLATE = 'Nouvel épisode disponible pour {titre} : {episode}';

// Mirrors the backend's renderMessageTemplate() in discordNotifications.js, using example data
// so the user sees exactly what a real notification will look like before saving/testing it.
function previewDiscordMessage(template) {
  const vars = { titre: 'Ma Série (exemple)', saison: '1', numero: '1', episode: 'S1E1', date: new Date().toISOString().slice(0, 10) };
  return (template || DEFAULT_DISCORD_TEMPLATE).replace(/\{(titre|saison|numero|episode|date)\}/g, (_, key) => vars[key]);
}

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m} min`;
}

function StatCard({ label, value }) {
  return (
    <div className="bg-base-900 border border-base-700 rounded-lg p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function CompletedGrid({ title, items }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        disabled={items.length === 0}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-400 mb-2 disabled:cursor-default"
      >
        <span>{title} ({items.length})</span>
        {items.length > 0 && <span className="text-xs">{expanded ? '▲' : '▼'}</span>}
      </button>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">Rien pour l'instant.</p>
      ) : expanded ? (
        <div className="grid grid-cols-3 xs:grid-cols-4 sm:grid-cols-6 gap-3">
          {items.map((it) => (
            <div key={`${it.source}-${it.source_id}`} className="aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
              {it.poster ? (
                <img src={it.poster} alt={it.title} loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">{it.title}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({
    username: user.username,
    email: user.email,
    discord_webhook_url: user.discord_webhook_url || '',
    discord_message_template: user.discord_message_template || '',
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [discordTestState, setDiscordTestState] = useState({ status: 'idle', text: '' });
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [showNotFound, setShowNotFound] = useState(false);

  useEffect(() => { api.get('/profile/stats').then(setStats); }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      const payload = {
        ...form,
        discord_webhook_url: form.discord_webhook_url.trim(),
        discord_message_template: form.discord_message_template.trim(),
      };
      await api.patch('/profile', payload);
      setUser((prev) => ({
        ...prev,
        ...payload,
        discord_webhook_url: payload.discord_webhook_url || null,
        discord_message_template: payload.discord_message_template || null,
      }));
      setMessage('Profil mis à jour.');
    } catch (err) {
      setError(err.message);
    }
  };

  const testDiscordWebhook = async () => {
    setDiscordTestState({ status: 'sending', text: 'Envoi en cours…' });
    try {
      const data = await api.post('/profile/discord-webhook/test', {
        discord_webhook_url: form.discord_webhook_url.trim(),
        discord_message_template: form.discord_message_template.trim(),
      });
      setDiscordTestState({ status: 'success', text: data.message });
    } catch (err) {
      setDiscordTestState({ status: 'error', text: err.message });
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      await api.patch('/profile/password', passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setMessage('Mot de passe mis à jour.');
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    const data = await api.postForm('/profile/avatar', fd);
    setUser((prev) => ({ ...prev, avatar: data.avatar }));
  };

  const changeLanguage = async (language) => {
    setUser((prev) => ({ ...prev, language }));
    await api.patch('/profile', { language });
  };

  const pollImportJob = (jobId) => {
    // A single failed poll (a proxy hiccup, a brief redeploy) doesn't mean the import itself
    // failed — the job keeps running server-side regardless. Only give up after several polls
    // in a row fail, so a momentary network blip during a multi-minute import doesn't wrongly
    // surface as "the import crashed" while it's actually still working in the background.
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 8;
    const interval = setInterval(async () => {
      try {
        const job = await api.get(`/profile/import/tvtime/${jobId}`);
        consecutiveFailures = 0;
        setImportProgress(job.progress);
        if (job.status === 'done') {
          clearInterval(interval);
          setImportResult(job.result);
          setImporting(false);
          api.get('/profile/stats').then(setStats);
        } else if (job.status === 'error') {
          clearInterval(interval);
          setImportError(job.error);
          setImporting(false);
        }
      } catch (err) {
        consecutiveFailures++;
        console.warn(`[import] poll failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, err);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          clearInterval(interval);
          setImportError(
            `Impossible de suivre la progression (${err.message}). L'import continue peut-être en arrière-plan côté serveur — vérifie la liste dans quelques minutes avant de réessayer.`
          );
          setImporting(false);
        }
      }
    }, 1000);
  };

  const importTvTime = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportProgress(null);
    setShowNotFound(false);
    try {
      const fd = new FormData();
      fd.append('archive', file);
      const { job_id } = await api.postForm('/profile/import/tvtime', fd);
      pollImportJob(job_id);
    } catch (err) {
      setImportError(err.message);
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="flex items-center gap-4">
        <label className="relative cursor-pointer">
          <div className="w-16 h-16 rounded-full bg-base-800 overflow-hidden flex items-center justify-center text-xl">
            {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.username[0].toUpperCase()}
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadAvatar} />
        </label>
        <div>
          <h1 className="text-xl font-bold">{user.username}</h1>
          <p className="text-sm text-gray-400">{user.email}</p>
        </div>
      </div>

      {stats && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400">Statistiques</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Temps total" value={formatMinutes(stats.total_minutes)} />
            <StatCard label="Séries" value={formatMinutes(stats.series_minutes)} />
            <StatCard label="Animes" value={formatMinutes(stats.anime_minutes)} />
            <StatCard label="Films" value={formatMinutes(stats.movies_minutes)} />
            <StatCard label="Épisodes vus" value={stats.episodes_watched} />
            <StatCard label="Films vus" value={stats.movies_watched} />
          </div>

          {stats.top_content.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2 mt-4">Top contenus (temps de visionnage)</h3>
              <ol className="space-y-1">
                {stats.top_content.map((c, i) => (
                  <li key={i} className="flex justify-between text-sm bg-base-900 border border-base-700 rounded-lg px-3 py-2">
                    <span>{i + 1}. {c.title}</span>
                    <span className="text-gray-400">{formatMinutes(c.minutes)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="space-y-4 mt-4">
            <CompletedGrid title="Séries terminées" items={stats.completed.series} />
            <CompletedGrid title="Animes terminés" items={stats.completed.animes} />
            <CompletedGrid title="Films vus" items={stats.completed.movies} />
          </div>
        </section>
      )}

      <section className="space-y-4 max-w-sm">
        <h2 className="text-sm font-semibold text-gray-400">Informations personnelles</h2>
        <form onSubmit={saveProfile} className="space-y-3">
          <input
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            type="url"
            placeholder="Lien du webhook Discord"
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
            value={form.discord_webhook_url}
            onChange={(e) => setForm({ ...form, discord_webhook_url: e.target.value })}
          />
          <p className="text-xs text-gray-500">
            Colle ici l'URL du webhook du salon Discord où tu veux recevoir l'alerte quand un épisode est disponible.
          </p>

          <textarea
            placeholder={DEFAULT_DISCORD_TEMPLATE}
            rows={2}
            maxLength={300}
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm resize-none"
            value={form.discord_message_template}
            onChange={(e) => setForm({ ...form, discord_message_template: e.target.value })}
          />
          <p className="text-xs text-gray-500">
            Message envoyé sur Discord. Jokers disponibles : {'{titre}'}, {'{episode}'} (ex. S1E5), {'{saison}'}, {'{numero}'}, {'{date}'}.
            Laisse vide pour le message par défaut. Tu peux inclure une mention (ex. {'@everyone'} ou {'<@&idDuRole>'}) : elle notifiera bien les membres du salon.
          </p>

          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Aperçu</p>
            <p className="text-sm font-medium">TVTracker <span className="text-[10px] bg-accent-600/70 rounded px-1 py-0.5 align-middle">BOT</span></p>
            <p className="text-sm text-gray-200">{previewDiscordMessage(form.discord_message_template)}</p>
            <div className="bg-[#2b2d31] border-l-4 border-[#5865f2] rounded-r-lg p-3 max-w-md">
              <p className="text-sm font-semibold text-gray-100">Ma Série (exemple)</p>
              <p className="text-xs text-gray-500 mt-2">Diffusion prévue le {new Date().toISOString().slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-3 py-2 font-medium">Enregistrer</button>
            <button
              type="button"
              onClick={testDiscordWebhook}
              disabled={!form.discord_webhook_url.trim() || discordTestState.status === 'sending'}
              className="bg-base-800 hover:bg-base-700 border border-base-600 text-sm rounded-lg px-3 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {discordTestState.status === 'sending' ? 'Envoi…' : 'Tester le webhook'}
            </button>
          </div>
          {discordTestState.status === 'success' && <p className="text-sm text-green-400">{discordTestState.text}</p>}
          {discordTestState.status === 'error' && <p className="text-sm text-red-400">{discordTestState.text}</p>}
        </form>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Langue des résumés</label>
          <select
            value={user.language || 'fr'}
            onChange={(e) => changeLanguage(e.target.value)}
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">S'applique aux résumés des séries et animes (traduction automatique).</p>
        </div>

        <h2 className="text-sm font-semibold text-gray-400 mt-6">Changer le mot de passe</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Mot de passe actuel"
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
          />
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm"
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
          />
          <button className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-3 py-2 font-medium">Mettre à jour</button>
        </form>

        {message && <p className="text-sm text-green-400">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      <section className="space-y-3 max-w-lg">
        <h2 className="text-sm font-semibold text-gray-400">Importer depuis TV Time</h2>
        <p className="text-xs text-gray-500">
          Récupère ton historique TV Time (séries, épisodes vus, films vus et à voir) à partir de
          l'export RGPD téléchargé sur{' '}
          <a href="https://gdpr.tvtime.com/gdpr/self-service" target="_blank" rel="noreferrer" className="text-accent-500 hover:underline">
            gdpr.tvtime.com
          </a>{' '}
          (le fichier .zip téléchargé, sans le décompresser). L'import peut prendre plusieurs
          minutes selon la taille de ton historique — reste sur cette page en attendant.
        </p>

        <label className={`inline-block ${importing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
          <span className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-3 py-2 font-medium inline-block">
            {importing ? 'Import en cours…' : 'Choisir le fichier .zip'}
          </span>
          <input type="file" accept=".zip,application/zip" className="hidden" onChange={importTvTime} disabled={importing} />
        </label>

        {importing && importProgress && importProgress.total > 0 && (
          <div className="space-y-1">
            <div className="h-2 w-full bg-base-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 rounded-full transition-all"
                style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">
              {importProgress.done}/{importProgress.total} — {importProgress.phase === 'shows' ? 'séries' : 'films'} en cours de traitement
            </p>
          </div>
        )}

        {importError && <p className="text-sm text-red-400">{importError}</p>}

        {importResult && (
          <div className="bg-base-900 border border-base-700 rounded-lg p-4 space-y-2 text-sm">
            <p className="text-green-400 font-medium">Import terminé.</p>
            <ul className="text-gray-300 space-y-1">
              <li>📺 {importResult.shows_imported} série{importResult.shows_imported > 1 ? 's' : ''} importée{importResult.shows_imported > 1 ? 's' : ''} ({importResult.episodes_imported} épisode{importResult.episodes_imported > 1 ? 's' : ''} coché{importResult.episodes_imported > 1 ? 's' : ''})</li>
              <li>🎬 {importResult.movies_imported} film{importResult.movies_imported > 1 ? 's' : ''} vu{importResult.movies_imported > 1 ? 's' : ''} importé{importResult.movies_imported > 1 ? 's' : ''}</li>
              <li>📋 {importResult.movies_to_watch_imported} film{importResult.movies_to_watch_imported > 1 ? 's' : ''} à voir importé{importResult.movies_to_watch_imported > 1 ? 's' : ''}</li>
            </ul>

            {(importResult.shows_preview?.length > 0 || importResult.movies_preview?.length > 0) && (
              <div className="pt-2 border-t border-base-800 space-y-4">
                {importResult.shows_preview?.length > 0 && (
                  <CompletedGrid title="Séries importées" items={importResult.shows_preview.map((s, i) => ({ ...s, source: 'tvtime-show', source_id: i }))} />
                )}
                {importResult.movies_preview?.length > 0 && (
                  <CompletedGrid title="Films importés" items={importResult.movies_preview.map((m, i) => ({ ...m, source: 'tvtime-movie', source_id: i }))} />
                )}
              </div>
            )}

            {(importResult.shows_not_found.length > 0 || importResult.movies_not_found.length > 0) && (
              <div className="pt-2 border-t border-base-800">
                <button onClick={() => setShowNotFound((v) => !v)} className="text-xs text-accent-500 hover:underline">
                  {importResult.shows_not_found.length + importResult.movies_not_found.length} contenu(s) non retrouvé(s) {showNotFound ? '▲' : '▼'}
                </button>
                {showNotFound && (
                  <ul className="text-xs text-gray-500 mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                    {[...importResult.shows_not_found, ...importResult.movies_not_found].map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Réessaie l'import plus tard pour ces titres : certains échecs viennent de limites
                  temporaires des sources de données, pas d'une absence réelle.
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
