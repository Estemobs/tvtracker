import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ActorModal from '../../components/ActorModal.jsx';
import ExpandableText from '../../components/ExpandableText.jsx';
import { RatingBadge, PlatformRow } from '../../components/JustWatchInfo.jsx';

// `release_date` is either a bare 4-digit year (Wikipedia's crude extraction, see
// backend/src/services/wikipedia.js's extractYear) or a full YYYY-MM-DD (JustWatch's, more
// precise when available) — show whichever precision is actually there.
function formatReleaseDate(releaseDate) {
  if (!releaseDate) return null;
  if (releaseDate.length === 4) return releaseDate;
  return new Date(releaseDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MovieDetail() {
  const { movieId } = useParams();
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);
  const [selectedActorId, setSelectedActorId] = useState(null);

  const load = () => api.get(`/movies/${movieId}`).then(setMovie);
  useEffect(() => { load(); }, [movieId]);

  if (!movie) return <p className="text-gray-400 text-sm">Chargement…</p>;

  const toggleStatus = async () => {
    const newStatus = movie.status === 'watched' ? 'to_watch' : 'watched';
    setMovie((prev) => ({ ...prev, status: newStatus }));
    await api.patch(`/movies/${movieId}/status`, { status: newStatus });
  };

  const remove = async () => {
    if (!confirm('Supprimer ce film de votre liste ?')) return;
    await api.delete(`/movies/${movieId}`);
    navigate('/films');
  };

  const rate = async (personal_rating) => {
    setMovie((prev) => ({ ...prev, personal_rating }));
    await api.patch(`/movies/${movieId}/rating`, { personal_rating });
  };

  return (
    <div className="space-y-5 pb-8">
      {movie.backdrop && (
        <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 h-40 sm:h-56 overflow-hidden">
          <img src={movie.backdrop} alt="" className="w-full h-full object-cover opacity-40" />
        </div>
      )}
      <div className="flex gap-4">
        {movie.poster && <img src={movie.poster} alt="" className="w-28 rounded-lg shrink-0" />}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{movie.title}</h1>
          <div className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-x-2">
            <span>{movie.genres.join(', ')}</span>
            <RatingBadge score={movie.jw_score ?? movie.note} url={movie.jw_url} />
            {movie.release_date && <span>· {formatReleaseDate(movie.release_date)}</span>}
            {movie.duration && <span>· {movie.duration} min</span>}
          </div>
        </div>
      </div>

      <ExpandableText text={movie.synopsis} className="text-sm text-gray-300 leading-relaxed" />

      <PlatformRow platforms={movie.jw_platforms} url={movie.jw_url} fallback={movie.platform} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {movie.added_by_count > 0 && (
          <span>👥 Ajouté par {movie.added_by_count} utilisateur{movie.added_by_count > 1 ? 's' : ''}</span>
        )}
      </div>

      {movie.next_installment?.release_date && (
        <p className="text-xs text-accent-500">
          🎬 Prochain volet « {movie.next_installment.title} » — {new Date(movie.next_installment.release_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
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
                (movie.personal_rating || 0) > i ? 'bg-accent-600 text-white' : 'bg-base-800 text-gray-500'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={toggleStatus}
          className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-3 py-2 font-medium"
        >
          {movie.status === 'watched' ? 'Marquer comme à voir' : 'Marquer comme vu'}
        </button>
        <button
          onClick={remove}
          className="bg-base-800 hover:bg-red-900/40 text-red-400 text-sm rounded-lg px-3 py-2 font-medium border border-base-700"
        >
          Supprimer de ma liste
        </button>
      </div>

      {movie.cast?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Distribution</h3>
          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-3">
            {movie.cast.map((c, i) => (
              <button
                key={i}
                onClick={() => c.person_id && setSelectedActorId(c.person_id)}
                disabled={!c.person_id}
                className="flex items-center gap-2 text-left hover:bg-base-800/50 rounded-lg p-1 -m-1 transition-colors disabled:hover:bg-transparent"
              >
                {c.photo && (
                  <div className="w-9 h-9 rounded-full bg-base-800 overflow-hidden shrink-0">
                    <img src={c.photo} alt={c.actor} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{c.actor}</div>
                  {c.character && <div className="text-[11px] text-gray-500 truncate">{c.character}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedActorId && (
        <ActorModal personId={selectedActorId} onClose={() => setSelectedActorId(null)} />
      )}
    </div>
  );
}
