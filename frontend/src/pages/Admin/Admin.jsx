import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { LoadingProgress, useElapsedSeconds } from '../../components/LoadingProgress.jsx';

export default function Admin() {
  const [pending, setPending] = useState(null);
  const [users, setUsers] = useState(null);
  const [debug, setDebug] = useState(null);
  const [copied, setCopied] = useState(false);
  const [movieBackfill, setMovieBackfill] = useState(null);
  const [fullRepair, setFullRepair] = useState(null);

  const load = () => {
    api.get('/admin/users/pending').then(setPending);
    api.get('/admin/users').then(setUsers);
    api.get('/admin/debug').then(setDebug);
    api.get('/admin/movies/missing-duration-count').then(setMovieBackfill);
    api.get('/admin/movies/full-repair-status').then((data) =>
      setFullRepair({ total: data.total, fixed: data.total - data.incomplete, running: data.running })
    );
  };
  useEffect(() => { load(); }, []);

  // While a backfill is running, poll the remaining count so the button's own label tracks
  // progress without needing the debug panel open.
  useEffect(() => {
    if (!movieBackfill?.running) return;
    const handle = setInterval(() => {
      api.get('/admin/movies/missing-duration-count').then(setMovieBackfill);
    }, 4000);
    return () => clearInterval(handle);
  }, [movieBackfill?.running]);

  // Poll full repair status while running
  useEffect(() => {
    if (!fullRepair?.running) return;
    const handle = setInterval(() => {
      api.get('/admin/movies/full-repair-status').then((data) => {
        setFullRepair((prev) => ({
          ...prev,
          total: data.total,
          fixed: data.total - data.incomplete,
          running: data.running,
        }));
      });
    }, 5000);
    return () => clearInterval(handle);
  }, [fullRepair?.running]);

  const startMovieBackfill = async () => {
    const data = await api.post('/admin/movies/backfill-durations');
    setMovieBackfill({ count: data.count, running: data.count > 0 });
  };

  const startFullRepair = async () => {
    const data = await api.post('/admin/movies/full-repair');
    setFullRepair({ total: data.total, fixed: 0, running: data.total > 0 });
  };

  const pendingLoadingSeconds = useElapsedSeconds(pending === null);
  const usersLoadingSeconds = useElapsedSeconds(users === null);

  // While debug mode is on, poll the log buffer so it's usable as a live view: enable it, then
  // go reproduce the issue elsewhere in the app and come back to see what happened.
  useEffect(() => {
    if (!debug?.enabled) return;
    const handle = setInterval(() => {
      api.get('/admin/debug').then(setDebug);
    }, 3000);
    return () => clearInterval(handle);
  }, [debug?.enabled]);

  const toggleDebug = async () => {
    const data = await api.post('/admin/debug/toggle', { enabled: !debug?.enabled });
    setDebug({ ...data, logs: [] });
  };

  const copyDebugLog = async () => {
    const text = (debug?.logs || [])
      .map((l) => `${new Date(l.at).toLocaleTimeString('fr-FR')} [${l.scope}] ${l.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const approve = async (id) => { await api.post(`/admin/users/${id}/approve`); load(); };
  const refuse = async (id) => { await api.post(`/admin/users/${id}/refuse`); load(); };
  const disable = async (id) => { await api.post(`/admin/users/${id}/disable`); load(); };
  const enable = async (id) => { await api.post(`/admin/users/${id}/enable`); load(); };
  const remove = async (id) => {
    if (!confirm('Supprimer définitivement ce compte ?')) return;
    await api.delete(`/admin/users/${id}`);
    load();
  };

  return (
    <div className="space-y-8 pb-8">
      <h1 className="text-xl font-bold">Administration</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Inscriptions en attente ({pending?.length ?? 0})</h2>
        {pending === null ? (
          <LoadingProgress seconds={pendingLoadingSeconds} />
        ) : pending.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune demande en attente.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-base-900 border border-base-700 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{u.username}</div>
                  <div className="text-xs text-gray-400">{u.email} · {new Date(u.created_at).toLocaleDateString('fr-FR')}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approve(u.id)} className="bg-green-600 hover:bg-green-500 text-xs rounded-lg px-3 py-1.5 font-medium">Approuver</button>
                  <button onClick={() => refuse(u.id)} className="bg-base-800 hover:bg-red-900/40 text-red-400 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Refuser</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Utilisateurs ({users?.length ?? 0})</h2>
        {users === null ? (
          <LoadingProgress seconds={usersLoadingSeconds} />
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-base-900 border border-base-700 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{u.username} {u.role === 'admin' && <span className="text-accent-500 text-xs">(admin)</span>}</div>
                  <div className="text-xs text-gray-400">{u.email} · {u.status}</div>
                </div>
                {u.role !== 'admin' && (
                  <div className="flex gap-2">
                    {u.status === 'disabled' ? (
                      <button onClick={() => enable(u.id)} className="bg-green-600 hover:bg-green-500 text-xs rounded-lg px-3 py-1.5 font-medium">Réactiver</button>
                    ) : (
                      <button onClick={() => disable(u.id)} className="bg-base-800 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Désactiver</button>
                    )}
                    <button onClick={() => remove(u.id)} className="bg-base-800 hover:bg-red-900/40 text-red-400 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Supprimer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Films incomplets</h2>
        <p className="text-xs text-gray-500">
          Corrige les statistiques de temps de visionnage cassées (ex. "0 h 0 min" alors que des films ont
          été vus), les dates de sortie et les affiches manquantes : les films ajoutés via d'anciennes sources
          n'ont parfois ni durée, ni date fiable, ni image tant qu'ils n'ont pas été réparés. Répare tout le
          catalogue en une fois plutôt que d'attendre que ça se fasse tout seul au fil des visites.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={startMovieBackfill}
            disabled={movieBackfill?.running || !movieBackfill?.count}
            className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 text-xs rounded-lg px-3 py-2 font-medium"
          >
            {movieBackfill?.running
              ? 'Réparation en cours…'
              : `Réparer les films incomplets (${movieBackfill?.count ?? '…'})`}
          </button>
          {movieBackfill?.running && (
            <span className="text-xs text-gray-500">Active le mode debug ci-dessous pour suivre la progression.</span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Réparation complète du catalogue films</h2>
        <p className="text-xs text-gray-500">
          Récupère affiches, backdrops, durées, dates de sortie et synopsis manquants via plusieurs sources
          (TMDB, Wikidata, Wikipédia, JustWatch, iTunes). Préserve les données existantes si une source échoue.
          Utile après une migration ou si des films apparaissent sans image/infos.
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={startFullRepair}
              disabled={fullRepair?.running || !fullRepair?.total}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-xs rounded-lg px-3 py-2 font-medium"
            >
              {fullRepair?.running
                ? `Réparation en cours… ({fullRepair.fixed ?? 0}/{fullRepair.total})`
                : `Réparer TOUT le catalogue (${fullRepair?.total ?? '…'} films)`}
            </button>
            {fullRepair?.running && (
              <span className="text-xs text-gray-500">Active le mode debug ci-dessous pour suivre la progression détaillée.</span>
            )}
          </div>
          {fullRepair && !fullRepair.running && fullRepair.total > 0 && (
            <p className="text-xs text-green-400">
              {fullRepair.fixed > 0
                ? `✅ ${fullRepair.fixed} film${fullRepair.fixed > 1 ? 's' : ''} corrigé${fullRepair.fixed > 1 ? 's' : ''} sur ${fullRepair.total}`
                : 'Aucun film à corriger, tout est complet !'}
            </p>
          )}
          {fullRepair && fullRepair.total === 0 && (
            <p className="text-xs text-gray-500">Aucun film en base de données.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-400">Mode debug</h2>
          <div className="flex gap-2">
            {debug?.enabled && (
              <button
                onClick={copyDebugLog}
                disabled={!debug.logs?.length}
                className="bg-base-800 hover:bg-base-700 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700 disabled:opacity-40"
              >
                {copied ? 'Copié !' : 'Copier le journal'}
              </button>
            )}
            <button
              onClick={toggleDebug}
              className={`text-xs rounded-lg px-3 py-1.5 font-medium ${
                debug?.enabled ? 'bg-red-900/40 text-red-400 border border-base-700' : 'bg-accent-600 hover:bg-accent-500'
              }`}
            >
              {debug?.enabled ? 'Désactiver' : 'Activer'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Active la journalisation détaillée (chaque appel externe, rafraîchissement des tendances…) pour
          diagnostiquer une page qui charge sans fin ou qui reste vide. Active-le, va reproduire le problème
          ailleurs sur le site, puis reviens ici — les logs se rafraîchissent automatiquement.
        </p>
        {debug?.enabled && (
          <div className="bg-black/40 border border-base-700 rounded-lg p-3 max-h-96 overflow-y-auto font-mono text-[11px] space-y-1">
            {!debug.logs?.length ? (
              <p className="text-gray-500">En attente d'activité…</p>
            ) : (
              debug.logs.map((l, i) => (
                <div key={i} className="text-gray-300">
                  <span className="text-gray-600">{new Date(l.at).toLocaleTimeString('fr-FR')}</span>{' '}
                  <span className="text-accent-500">[{l.scope}]</span> {l.message}
                </div>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
