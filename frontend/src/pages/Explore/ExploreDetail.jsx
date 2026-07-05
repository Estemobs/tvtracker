import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';

export default function ExploreDetail() {
  const { mediaType, tmdbId } = useParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const endpoint = mediaType === 'movie' ? `/explore/movie/${tmdbId}` : `/explore/tv/${tmdbId}`;
    api.get(endpoint).then(setDetails);
  }, [mediaType, tmdbId]);

  if (!details) return <p className="text-gray-400 text-sm">Chargement…</p>;

  const addToList = async () => {
    setAdding(true);
    try {
      if (mediaType === 'movie') {
        await api.post('/movies', { tmdb_id: Number(tmdbId) });
        navigate(`/films/${tmdbId}`);
      } else {
        await api.post('/shows', { tmdb_id: Number(tmdbId) });
        setDetails((prev) => ({ ...prev, already_added: true }));
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {details.backdrop && (
        <div className="-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 h-40 sm:h-56 overflow-hidden">
          <img src={details.backdrop} alt="" className="w-full h-full object-cover opacity-40" />
        </div>
      )}
      <div className="flex gap-4">
        {details.poster && <img src={details.poster} alt="" className="w-28 rounded-lg shrink-0" />}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{details.title}</h1>
          <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-2">
            <span>{(details.genres || []).join(', ')}</span>
            {details.note && <span>· ⭐ {details.note.toFixed(1)}</span>}
            {mediaType === 'movie' && details.duration && <span>· {details.duration} min</span>}
            {mediaType !== 'movie' && <span>· {details.nb_seasons} saisons, {details.nb_episodes} épisodes</span>}
          </div>
        </div>
      </div>

      {details.synopsis && <p className="text-sm text-gray-300 leading-relaxed">{details.synopsis}</p>}

      <button
        onClick={addToList}
        disabled={adding || details.already_added}
        className="bg-accent-600 hover:bg-accent-500 disabled:opacity-50 text-sm rounded-lg px-4 py-2.5 font-medium"
      >
        {details.already_added ? 'Déjà ajouté ✓' : adding ? 'Ajout…' : 'Ajouter à ma liste'}
      </button>
    </div>
  );
}
