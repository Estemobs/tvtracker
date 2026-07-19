import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ActorModal from '../../components/ActorModal.jsx';
import ExpandableText from '../../components/ExpandableText.jsx';
import { RatingBadge, PlatformRow } from '../../components/JustWatchInfo.jsx';
import { LoadingProgress, useElapsedSeconds } from '../../components/LoadingProgress.jsx';

const DAYS_FR = {
  Monday: 'Lun.', Tuesday: 'Mar.', Wednesday: 'Mer.', Thursday: 'Jeu.',
  Friday: 'Ven.', Saturday: 'Sam.', Sunday: 'Dim.',
};

// TVMaze's own `status` field (passed through verbatim as air_status): only 'Ended' means the
// show is actually over. 'Running' covers a show between seasons/episodes just as much as one
// mid-season, so it must never be conflated with "completed" elsewhere in this page.
const AIR_STATUS_FR = {
  Running: 'En cours', Ended: 'Terminée', 'To Be Determined': 'Indéterminé',
  'In Development': 'En développement', Pilot: 'Pilote',
};

export default function SeriesDetail() {
  const { showId } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
  const [tab, setTab] = useState('about');
  const [selectedActorId, setSelectedActorId] = useState(null);
  const [openSeason, setOpenSeason] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/shows/${showId}`).then((data) => {
    setShow(data);
    setOpenSeason((prev) => prev ?? data.seasons[0]?.season);
  });

  useEffect(() => { load(); }, [showId]);

  if (!show) return <p className="text-gray-400 text-sm">Chargement…</p>;

  const totalEpisodes = show.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const watchedEpisodes = show.seasons.reduce((acc, s) => acc + s.episodes.filter((e) => e.watched).length, 0);
  const percent = totalEpisodes ? Math.round((watchedEpisodes / totalEpisodes) * 100) : 0;

  const toggleEpisode = async (episodeId, watched) => {
    setShow((prev) => ({
      ...prev,
      seasons: prev.seasons.map((s) => ({
        ...s,
        episodes: s.episodes.map((e) => (e.id === episodeId ? { ...e, watched: watched ? 1 : 0 } : e)),
      })),
    }));
    await api.put(`/shows/${showId}/episodes/${episodeId}`, { watched });
    load();
  };

  const toggleSeason = async (season, watched) => {
    setBusy(true);
    await api.put(`/shows/${showId}/seasons/${season}`, { watched });
    await load();
    setBusy(false);
  };

  const markComplete = async () => {
    setBusy(true);
    await api.post(`/shows/${showId}/mark-complete`);
    await load();
    setBusy(false);
  };

  const removeShow = async () => {
    if (!confirm('Supprimer cette série de votre liste ? Votre progression sera perdue.')) return;
    await api.delete(`/shows/${showId}`);
    navigate('/series');
  };

  const rate = async (personal_rating) => {
    setShow((prev) => ({ ...prev, personal_rating }));
    await api.patch(`/shows/${showId}/rating`, { personal_rating, personal_review: show.personal_review });
  };

  const scheduleLabel = show.schedule_day && show.schedule_time
    ? `${DAYS_FR[show.schedule_day] || show.schedule_day} ${show.schedule_time}`
    : null;

  return (
    <div className="space-y-5 pb-8">
      {show.backdrop && (
        <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 h-40 sm:h-56 overflow-hidden">
          <img src={show.backdrop} alt="" className="w-full h-full object-cover opacity-40" />
        </div>
      )}

      <div className="flex gap-4">
        {show.poster && <img src={show.poster} alt="" className="w-28 rounded-lg shrink-0" />}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{show.title}</h1>
          <div className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-x-2">
            <span>{show.genres.join(', ')}</span>
            <RatingBadge score={show.jw_score ?? show.note} url={show.jw_url} />
            {show.air_status && <span>· {AIR_STATUS_FR[show.air_status] || show.air_status}</span>}
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full bg-base-700 rounded-full overflow-hidden">
              <div className="h-full bg-accent-500 rounded-full" style={{ width: `${percent}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">{watchedEpisodes}/{totalEpisodes} épisodes — {percent}%</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={markComplete}
          disabled={busy || show.status === 'completed'}
          className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 text-sm rounded-lg px-3 py-2 font-medium"
        >
          {show.status === 'completed'
            ? (show.air_status === 'Ended' ? 'Terminée ✓' : 'À jour ✓')
            : 'Marquer comme complètement vue'}
        </button>
        <button
          onClick={removeShow}
          className="bg-base-800 hover:bg-red-900/40 text-red-400 text-sm rounded-lg px-3 py-2 font-medium border border-base-700"
        >
          Supprimer de ma liste
        </button>
      </div>

      <div className="flex bg-base-800 rounded-lg p-0.5 border border-base-700 w-fit">
        {[['about', 'À propos'], ['episodes', 'Épisodes']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === v ? 'bg-accent-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'about' && (
        <div className="space-y-5">
          <ExpandableText text={show.synopsis} className="text-sm text-gray-300 leading-relaxed" />

          <PlatformRow platforms={show.jw_platforms} url={show.jw_url} fallback={show.platform} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            {scheduleLabel && <span>📅 {scheduleLabel}</span>}
            {show.runtime && <span>⏱️ {show.runtime} min/épisode</span>}
            <span>👥 Ajoutée par {show.added_by_count} utilisateur{show.added_by_count > 1 ? 's' : ''}</span>
          </div>

          {show.next_episode?.air_date && (
            <p className="text-xs text-accent-500">
              ▶️ Prochain épisode : S{show.next_episode.season}E{show.next_episode.episode_number} — {new Date(show.next_episode.air_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}

          <div>
            <label className="text-sm text-gray-400 block mb-1">Votre note (sur 10)</label>
            <div className="flex gap-1">
              {Array.from({ length: 10 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => rate(i + 1)}
                  className={`w-6 h-6 rounded text-xs font-medium ${
                    (show.personal_rating || 0) > i ? 'bg-accent-600 text-white' : 'bg-base-800 text-gray-500'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          {show.cast?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Distribution</h3>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-3">
                {show.cast.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedActorId(c.person_id)}
                    className="flex items-center gap-2 text-left hover:bg-base-800/50 rounded-lg p-1 -m-1 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-base-800 overflow-hidden shrink-0">
                      {c.photo && <img src={c.photo} alt={c.actor} className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{c.actor}</div>
                      <div className="text-[11px] text-gray-500 truncate">{c.character}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'episodes' && (
        <div className="space-y-2">
          {show.seasons.map((season) => {
            const seasonWatched = season.episodes.every((e) => e.watched);
            const hasAired = (ep) => ep.air_date && new Date(ep.air_date) <= new Date();
            const seasonNotAiredYet = season.episodes.length > 0 && season.episodes.every((e) => !hasAired(e));
            return (
              <div key={season.season} className="border border-base-700 rounded-lg overflow-hidden">
                <div className="flex items-center bg-base-900">
                  <button
                    onClick={() => setOpenSeason(openSeason === season.season ? null : season.season)}
                    className="flex-1 flex items-center gap-2 px-4 py-3 text-sm font-medium min-w-0"
                  >
                    <span>Saison {season.season}</span>
                    {seasonNotAiredYet && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
                        À venir
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {season.episodes.filter((e) => e.watched).length}/{season.episodes.length}
                    </span>
                  </button>
                  <button
                    onClick={() => toggleSeason(season.season, !seasonWatched)}
                    disabled={busy || seasonNotAiredYet}
                    title={seasonNotAiredYet ? 'Saison pas encore diffusée' : seasonWatched ? 'Décocher toute la saison' : 'Marquer toute la saison comme vue'}
                    className={`shrink-0 mx-3 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 ${
                      seasonWatched
                        ? 'bg-accent-600 border-accent-600 text-white'
                        : 'bg-base-800 border-base-600 text-gray-300 hover:border-accent-500 hover:text-accent-500'
                    }`}
                  >
                    {seasonWatched ? 'Vue ✓' : 'Tout voir'}
                  </button>
                </div>
                {openSeason === season.season && (
                  <div className="divide-y divide-base-800">
                    {season.episodes.map((ep) => {
                      const notAired = !hasAired(ep);
                      return (
                        <label
                          key={ep.id}
                          className={`flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-base-800/40 ${notAired ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            checked={!!ep.watched}
                            disabled={notAired}
                            onChange={(e) => toggleEpisode(ep.id, e.target.checked)}
                            className="accent-accent-500 w-4 h-4 disabled:opacity-40"
                          />
                          <span className="text-gray-500 w-8 shrink-0">E{ep.episode_number}</span>
                          <span className={`flex-1 truncate ${notAired ? 'text-gray-500' : ''}`}>{ep.title}</span>
                          {notAired && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5 shrink-0">
                              {ep.air_date ? new Date(ep.air_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'À venir'}
                            </span>
                          )}
                          {!notAired && ep.duration && <span className="text-xs text-gray-500 shrink-0">{ep.duration} min</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedActorId && (
        <ActorModal personId={selectedActorId} onClose={() => setSelectedActorId(null)} />
      )}
    </div>
  );
}
