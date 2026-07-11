import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ActorModal from '../../components/ActorModal.jsx';
import ExpandableText from '../../components/ExpandableText.jsx';

const DAYS_FR = {
  Monday: 'Lun.', Tuesday: 'Mar.', Wednesday: 'Mer.', Thursday: 'Jeu.',
  Friday: 'Ven.', Saturday: 'Sam.', Sunday: 'Dim.',
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ExploreDetail() {
  const { mediaType, source, sourceId } = useParams();
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState(null);

  useEffect(() => {
    const endpoint = mediaType === 'movie' ? `/explore/movie/${source}/${sourceId}` : `/explore/tv/${sourceId}`;
    api.get(endpoint).then(setDetails);
  }, [mediaType, source, sourceId]);

  if (!details) return <p className="text-gray-400 text-sm">Chargement…</p>;

  const addToList = async () => {
    setAdding(true);
    try {
      if (mediaType === 'movie') {
        const { movie_id } = await api.post('/movies', { source, source_id: sourceId });
        navigate(`/films/${movie_id}`);
      } else {
        const { show_id } = await api.post('/shows', { source_id: sourceId });
        setDetails((prev) => ({ ...prev, already_added: true, show_id }));
      }
    } finally {
      setAdding(false);
    }
  };

  const removeFromList = async () => {
    if (!confirm('Supprimer de votre liste ?')) return;
    setRemoving(true);
    try {
      if (mediaType === 'movie') {
        await api.delete(`/movies/${details.movie_id}`);
      } else {
        await api.delete(`/shows/${details.show_id}`);
      }
      setDetails((prev) => ({ ...prev, already_added: false, show_id: null, movie_id: null }));
    } finally {
      setRemoving(false);
    }
  };

  const scheduleLabel = details.schedule_day && details.schedule_time
    ? `${DAYS_FR[details.schedule_day] || details.schedule_day} ${details.schedule_time}`
    : null;

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

      <ExpandableText text={details.synopsis} className="text-sm text-gray-300 leading-relaxed" />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {details.platform && <span>📺 Disponible sur {details.platform}</span>}
        {scheduleLabel && <span>📅 {scheduleLabel}</span>}
        {details.added_by_count > 0 && (
          <span>👥 Ajouté par {details.added_by_count} utilisateur{details.added_by_count > 1 ? 's' : ''}</span>
        )}
      </div>

      {details.next_episode?.air_date && (
        <p className="text-xs text-accent-500">
          ▶️ Prochain épisode : S{details.next_episode.season}E{details.next_episode.episode_number} — {formatDate(details.next_episode.air_date)}
        </p>
      )}
      {details.next_installment?.release_date && (
        <p className="text-xs text-accent-500">
          🎬 Prochain volet « {details.next_installment.title} » — {formatDate(details.next_installment.release_date)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {details.already_added ? (
          <>
            <Link
              to={mediaType === 'movie' ? `/films/${details.movie_id}` : `/series/${details.show_id}`}
              className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-4 py-2.5 font-medium"
            >
              {mediaType === 'movie' ? 'Voir ma fiche' : 'Voir ma fiche (épisodes vus)'}
            </Link>
            <button
              onClick={removeFromList}
              disabled={removing}
              className="bg-base-800 hover:bg-red-900/40 text-red-400 disabled:opacity-50 text-sm rounded-lg px-4 py-2.5 font-medium border border-base-700"
            >
              {removing ? 'Suppression…' : 'Supprimer de ma liste'}
            </button>
          </>
        ) : (
          <button
            onClick={addToList}
            disabled={adding}
            className="bg-accent-600 hover:bg-accent-500 disabled:opacity-50 text-sm rounded-lg px-4 py-2.5 font-medium"
          >
            {adding ? 'Ajout…' : 'Ajouter à ma liste'}
          </button>
        )}
      </div>

      {details.cast?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Distribution</h3>
          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-3">
            {details.cast.map((c, i) => (
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
