import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';

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
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-400 mb-2">{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500">Rien pour l'instant.</p>
      ) : (
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
      )}
    </div>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ username: user.username, email: user.email });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [showNotFound, setShowNotFound] = useState(false);

  useEffect(() => { api.get('/profile/stats').then(setStats); }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      await api.patch('/profile', form);
      setUser((prev) => ({ ...prev, ...form }));
      setMessage('Profil mis à jour.');
    } catch (err) {
      setError(err.message);
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

  const importTvTime = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setShowNotFound(false);
    try {
      const fd = new FormData();
      fd.append('archive', file);
      const result = await api.postForm('/profile/import/tvtime', fd);
      setImportResult(result);
      api.get('/profile/stats').then(setStats);
    } catch (err) {
      setImportError(err.message);
    } finally {
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
          <button className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-3 py-2 font-medium">Enregistrer</button>
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

        {importError && <p className="text-sm text-red-400">{importError}</p>}

        {importResult && (
          <div className="bg-base-900 border border-base-700 rounded-lg p-4 space-y-2 text-sm">
            <p className="text-green-400 font-medium">Import terminé.</p>
            <ul className="text-gray-300 space-y-1">
              <li>📺 {importResult.shows_imported} série{importResult.shows_imported > 1 ? 's' : ''} importée{importResult.shows_imported > 1 ? 's' : ''} ({importResult.episodes_imported} épisode{importResult.episodes_imported > 1 ? 's' : ''} coché{importResult.episodes_imported > 1 ? 's' : ''})</li>
              <li>🎬 {importResult.movies_imported} film{importResult.movies_imported > 1 ? 's' : ''} vu{importResult.movies_imported > 1 ? 's' : ''} importé{importResult.movies_imported > 1 ? 's' : ''}</li>
              <li>📋 {importResult.movies_to_watch_imported} film{importResult.movies_to_watch_imported > 1 ? 's' : ''} à voir importé{importResult.movies_to_watch_imported > 1 ? 's' : ''}</li>
            </ul>
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
