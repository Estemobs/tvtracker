import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function ActorModal({ personId, onClose }) {
  const [actor, setActor] = useState(null);

  useEffect(() => {
    setActor(null);
    api.get(`/explore/actor/${personId}`).then(setActor);
  }, [personId]);

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
          <p className="text-gray-400 text-sm p-6">Chargement…</p>
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
                <h3 className="text-sm font-semibold text-gray-400 mb-2">Filmographie</h3>
                {actor.filmography[0]?.source_id ? (
                  <div className="grid grid-cols-3 xs:grid-cols-4 gap-3">
                    {actor.filmography.map((f) => (
                      <Link
                        key={f.source_id}
                        to={`/explorer/tv/tvmaze/${f.source_id}`}
                        onClick={onClose}
                        className="flex flex-col gap-1"
                      >
                        <div className="aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
                          {f.poster ? (
                            <img src={f.poster} alt={f.title} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 p-1 text-center">{f.title}</div>
                          )}
                        </div>
                        <div className="text-[11px] truncate">{f.title}</div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <ul className="text-sm text-gray-300 space-y-1">
                    {actor.filmography.map((f, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="truncate">{f.title}</span>
                        {f.year && <span className="text-gray-500 shrink-0 ml-2">{f.year}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
