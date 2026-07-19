import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PosterGridSkeleton } from '../../components/Skeleton.jsx';

function Poster({ r }) {
  return (
    <Link
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
      {r.nb_seasons ? (
        <div className="text-[11px] text-gray-500 -mt-1.5">{r.nb_seasons} saison{r.nb_seasons > 1 ? 's' : ''}</div>
      ) : null}
    </Link>
  );
}

function ResultGrid({ results }) {
  if (!results.length) return <p className="text-gray-400 text-sm">Aucun résultat.</p>;
  return (
    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {results.map((r) => (
        <Poster key={`${r.source}-${r.source_id}`} r={r} />
      ))}
    </div>
  );
}

function CategoryRow({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-400 mb-3">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((r) => (
          <div key={`${r.source}-${r.source_id}`} className="w-32 sm:w-36 flex-shrink-0">
            <Poster r={r} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Top 10 rows show a rank number over the poster and the streaming platforms JustWatch reports
// the title as actually available on (Netflix, Disney+…) — the real "trending" signal the plain
// CategoryRow can't show, since its items have no jw_rank/platforms.
function Top10Row({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-400 mb-3">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {items.map((r) => (
          <Link
            key={`${r.source}-${r.source_id}`}
            to={`/explorer/${r.media_type}/${r.source}/${encodeURIComponent(r.source_id)}`}
            className="group flex flex-col gap-2 w-32 sm:w-36 flex-shrink-0"
          >
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
              {r.poster ? (
                <img src={r.poster} alt={r.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs p-2 text-center">{r.title}</div>
              )}
              <span className="absolute bottom-0 left-0 text-3xl font-black text-white/90 leading-none px-2 py-1"
                style={{ WebkitTextStroke: '1.5px rgba(0,0,0,0.6)' }}>
                {r.jw_rank}
              </span>
              {r.already_added && (
                <span className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                  Déjà ajouté
                </span>
              )}
            </div>
            <div className="text-sm font-medium truncate">{r.title}</div>
            {r.platforms?.length > 0 && (
              <div className="text-[11px] text-gray-500 -mt-1.5 truncate">{r.platforms.join(' · ')}</div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function Explore() {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [categories, setCategories] = useState(null);

  useEffect(() => {
    api.get('/explore/trending').then(setCategories).catch(() => setCategories({}));
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
      ) : categories === null ? (
        <PosterGridSkeleton />
      ) : (
        (() => {
          const top10Rows = [
            ['Top 10 séries', tab === 'all' || tab === 'serie' ? categories.top10_series : []],
            ['Top 10 animes', tab === 'all' || tab === 'anime' ? categories.top10_animes : []],
            ['Top 10 films', tab === 'all' || tab === 'movie' ? categories.top10_movies : []],
          ];
          const newRows = [
            ['Nouveautés séries', tab === 'all' || tab === 'serie' ? categories.new_series : []],
            ['Nouveautés animes', tab === 'all' || tab === 'anime' ? categories.new_animes : []],
            ['Nouveautés films', tab === 'all' || tab === 'movie' ? categories.new_movies : []],
          ];
          const hasAny = [...top10Rows, ...newRows].some(([, items]) => items && items.length);
          if (!hasAny) return <p className="text-gray-400 text-sm">Aucun résultat.</p>;
          return (
            <div className="space-y-6">
              {top10Rows.map(([title, items]) => (
                <Top10Row key={title} title={title} items={items} />
              ))}
              {newRows.map(([title, items]) => (
                <CategoryRow key={title} title={title} items={items} />
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
