import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';

export default function SeriesDetail() {
  const { showId } = useParams();
  const navigate = useNavigate();
  const [show, setShow] = useState(null);
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
          <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-2">
            <span>{show.genres.join(', ')}</span>
            {show.note && <span>· ⭐ {show.note.toFixed(1)}</span>}
            <span>· {show.air_status}</span>
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full bg-base-700 rounded-full overflow-hidden">
              <div className="h-full bg-accent-500 rounded-full" style={{ width: `${percent}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1">{watchedEpisodes}/{totalEpisodes} épisodes — {percent}%</div>
          </div>
        </div>
      </div>

      {show.synopsis && <p className="text-sm text-gray-300 leading-relaxed">{show.synopsis}</p>}

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

      <div className="flex flex-wrap gap-2">
        <button
          onClick={markComplete}
          disabled={busy || show.status === 'completed'}
          className="bg-accent-600 hover:bg-accent-500 disabled:opacity-40 text-sm rounded-lg px-3 py-2 font-medium"
        >
          {show.status === 'completed' ? 'Terminée ✓' : 'Marquer comme complètement vue'}
        </button>
        <button
          onClick={removeShow}
          className="bg-base-800 hover:bg-red-900/40 text-red-400 text-sm rounded-lg px-3 py-2 font-medium border border-base-700"
        >
          Supprimer de ma liste
        </button>
      </div>

      <div className="space-y-2">
        {show.seasons.map((season) => {
          const seasonWatched = season.episodes.every((e) => e.watched);
          return (
            <div key={season.season} className="border border-base-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenSeason(openSeason === season.season ? null : season.season)}
                className="w-full flex items-center justify-between px-4 py-3 bg-base-900 text-sm font-medium"
              >
                <span>Saison {season.season}</span>
                <span className="text-xs text-gray-400">
                  {season.episodes.filter((e) => e.watched).length}/{season.episodes.length}
                </span>
              </button>
              {openSeason === season.season && (
                <div className="divide-y divide-base-800">
                  <div className="px-4 py-2 bg-base-800/50">
                    <button
                      onClick={() => toggleSeason(season.season, !seasonWatched)}
                      disabled={busy}
                      className="text-xs text-accent-500 hover:underline"
                    >
                      {seasonWatched ? 'Tout décocher' : 'Marquer toute la saison comme vue'}
                    </button>
                  </div>
                  {season.episodes.map((ep) => (
                    <label key={ep.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-base-800/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!ep.watched}
                        onChange={(e) => toggleEpisode(ep.id, e.target.checked)}
                        className="accent-accent-500 w-4 h-4"
                      />
                      <span className="text-gray-500 w-8 shrink-0">E{ep.episode_number}</span>
                      <span className="flex-1 truncate">{ep.title}</span>
                      {ep.duration && <span className="text-xs text-gray-500 shrink-0">{ep.duration} min</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
