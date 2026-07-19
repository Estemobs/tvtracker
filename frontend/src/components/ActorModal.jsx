import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { LoadingProgress, useElapsedSeconds } from './LoadingProgress.jsx';

export default function ActorModal({ personId, onClose }) {
  const [actor, setActor] = useState(null);
  const [pendingTitle, setPendingTitle] = useState(null);
  const [failedTitle, setFailedTitle] = useState(null);
  const navigate = useNavigate();
  const loadingSeconds = useElapsedSeconds(!actor);

  useEffect(() => {
    setActor(null);
    api.get(`/explore/actor/${personId}`).then(setActor);
  }, [personId]);

  // Movie credits found via Wikidata (see backend) arrive with no source_id/poster — resolving
  // all of them up front used to be exactly the burst of Wikipedia/Wikidata calls that made this
  // modal hang. Instead they're resolved one at a time, only for the title actually clicked, the
  // same way the Explorer's Top10/Nouveautés rows do.
  const openFilm = async (f) => {
    setFailedTitle(null);
    setPendingTitle(f.title);
    try {
      const resolved = await api.get(`/explore/resolve?title=${encodeURIComponent(f.title)}&media_type=${f.media_type}`);
      onClose();
      navigate(`/explorer/${resolved.media_type}/${resolved.source}/${encodeURIComponent(resolved.source_id)}`);
    } catch {
      setFailedTitle(f.title);
    } finally {
      setPendingTitle(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-base-900 border border-base-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!actor ? (
          <LoadingProgress seconds={loadingSeconds} className="p-6" />
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-base-800 overflow-hidden shrink-0">
                  {actor.photo && <img src={actor.photo} alt={actor.name} className="w-full h-full object-cover" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold">{actor.name}</h2>
                  {actor.birthday && (
                    <p className="text-xs text-gray-400">
                      Né(e) le {new Date(actor.birthday).toLocaleDateString('fr-FR')}
                      {actor.country ? ` · ${actor.country}` : ''}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none px-2">×</button>
            </div>

            {actor.bio && <p className="text-sm text-gray-300 leading-relaxed">{actor.bio}</p>}

            {actor.filmography?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-2">
                  Filmographie <span className="text-gray-500 font-normal">({actor.filmography.length})</span>
                </h3>
                <div className="grid grid-cols-3 xs:grid-cols-4 gap-3">
                  {actor.filmography.map((f, i) => {
                    const pending = pendingTitle === f.title;
                    const failed = failedTitle === f.title;
                    const card = (
                      <>
                        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
                          {f.poster ? (
                            <img src={f.poster} alt={f.title} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">{f.title}</div>
                          )}
                          {pending && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-[10px] text-gray-200">…</div>
                          )}
                        </div>
                        <div className="text-[11px] truncate">{f.title}</div>
                        {failed ? (
                          <div className="text-[9px] text-red-400">Introuvable</div>
                        ) : f.year && (
                          <div className="text-[10px] text-gray-500">{f.year}</div>
                        )}
                      </>
                    );
                    // TVmaze credits already carry a source_id (a plain, instant Link); Wikidata
                    // movie credits don't (see wikidata.js) and resolve on click instead.
                    return f.source_id ? (
                      <Link
                        key={`${f.source}-${f.source_id}`}
                        to={`/explorer/${f.media_type}/${f.source}/${encodeURIComponent(f.source_id)}`}
                        onClick={onClose}
                        className="flex flex-col gap-1"
                      >
                        {card}
                      </Link>
                    ) : (
                      <button key={i} onClick={() => openFilm(f)} className="flex flex-col gap-1 text-left">
                        {card}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
