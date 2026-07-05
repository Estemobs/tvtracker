import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PosterGridSkeleton } from '../../components/Skeleton.jsx';

function ResultGrid({ results }) {
  if (!results.length) return <p className="text-gray-400 text-sm">Aucun résultat.</p>;
  return (
    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {results.map((r) => (
        <Link
          key={`${r.source}-${r.source_id}`}
          to={`/explorer/${r.media_type}/${r.source}/${encodeURIComponent(r.source_id)}`}
          className="group flex flex-col gap-2"
        >
          <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
            {r.poster ? (
              <img src={r.poster} alt={r.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs p-2 text-center">{r.title}</div>
            )}
            {r.already_added && (
              <span className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                Déjà ajouté
              </span>
            )}
          </div>
          <div className="text-sm font-medium truncate">{r.title}</div>
          <div className="text-xs text-gray-400 -mt-1.5">{r.year} {r.note ? `· ⭐ ${r.note.toFixed(1)}` : ''}</div>
        </Link>
      ))}
    </div>
  );
}

export default function Explore() {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [trending, setTrending] = useState(null);

  useEffect(() => {
    api.get('/explore/trending?media_type=all').then(setTrending).catch(() => setTrending([]));
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    const handle = setTimeout(() => {
      api.get(`/explore/search?q=${encodeURIComponent(query)}`).then((data) => setResults(data.results));
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const filterByTab = (list) => {
    if (!list) return list;
    if (tab === 'all') return list;
    if (tab === 'serie') return list.filter((r) => r.media_type === 'tv' && r.type !== 'anime');
    if (tab === 'anime') return list.filter((r) => r.type === 'anime');
    if (tab === 'movie') return list.filter((r) => r.media_type === 'movie');
    return list;
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Explorer</h1>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher une série, un anime, un film…"
        className="w-full rounded-lg bg-base-800 border border-base-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
      />

      <div className="flex bg-base-800 rounded-lg p-0.5 border border-base-700 w-fit">
        {[['all', 'Tout'], ['serie', 'Séries'], ['anime', 'Animes'], ['movie', 'Films']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === v ? 'bg-accent-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {query.trim() ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Résultats</h2>
          {results === null ? <PosterGridSkeleton /> : <ResultGrid results={filterByTab(results)} />}
        </section>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Tendances</h2>
          {trending === null ? <PosterGridSkeleton /> : <ResultGrid results={filterByTab(trending)} />}
        </section>
      )}
    </div>
  );
}
