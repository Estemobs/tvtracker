import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import PosterCard from '../../components/PosterCard.jsx';
import { PosterGridSkeleton } from '../../components/Skeleton.jsx';

export default function SeriesList() {
  const [shows, setShows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('recent');
  const [version, setVersion] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (type !== 'all') params.set('type', type);
    params.set('sort', sort);
    setShows(null);
    api.get(`/shows?${params}`).then(setShows).catch(() => setShows([]));
  }, [filter, type, sort]);

  useEffect(() => {
    api.get('/version').then((d) => setVersion(d.version)).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Séries & Animes</h1>

      <div className="flex flex-wrap gap-2">
        <Tabs value={filter} onChange={setFilter} options={[
          ['all', 'Toutes'], ['in_progress', 'En cours'], ['completed', 'Terminées'],
        ]} />
        <Tabs value={type} onChange={setType} options={[
          ['all', 'Tout'], ['serie', 'Séries'], ['anime', 'Animes'],
        ]} />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-base-800 border border-base-600 rounded-lg text-xs px-2 py-1.5 text-gray-300"
        >
          <option value="recent">Dernière activité</option>
          <option value="alpha">Alphabétique</option>
          <option value="progress">Progression</option>
        </select>
      </div>

      {shows === null ? (
        <PosterGridSkeleton />
      ) : shows.length === 0 ? (
        <p className="text-gray-400 text-sm">Aucune série pour le moment. Direction l'onglet Explorer !</p>
      ) : (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {shows.map((s) => (
            <PosterCard
              key={s.show_id}
              to={`/series/${s.show_id}`}
              title={s.title}
              poster={s.poster}
              progressPercent={s.progress.percent}
              subtitle={`${s.progress.watched}/${s.progress.total} épisodes`}
              badge={s.type === 'anime' ? 'Anime' : undefined}
            />
          ))}
        </div>
      )}

      {version && (
        <p className="text-center text-[11px] text-gray-600 pt-4">
          Version{' '}
          {version === 'dev' ? (
            'dev'
          ) : (
            <a
              href={`https://github.com/Estemobs/tvtracker/commit/${version}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-gray-400 hover:underline"
            >
              {version.slice(0, 7)}
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function Tabs({ value, onChange, options }) {
  return (
    <div className="flex bg-base-800 rounded-lg p-0.5 border border-base-700">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            value === v ? 'bg-accent-600 text-white' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
