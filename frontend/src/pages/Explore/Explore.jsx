import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { PosterGridSkeleton } from '../../components/Skeleton.jsx';

// Lets the mouse wheel scroll a horizontal row directly (like a streaming platform's shelf) —
// without this, hovering a row and scrolling just scrolls the whole page vertically, and reaching
// the row's own horizontal scrollbar (now hidden, see .scroll-row in index.css) isn't an option.
function useWheelToHorizontalScroll() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return ref;
}

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

// Top10/Nouveautés items come straight from JustWatch (title + its own poster CDN + platforms) —
// there's no source/source_id yet, so they can't be a plain <Link>. Clicking one resolves that
// single title against this app's catalog (TVmaze/Wikipedia) on demand, then navigates — instead
// of resolving all ~60 of these titles up front, which used to be enough of a burst to trip
// Wikipedia/Wikidata's rate limiter and leave the whole page blank (see explore.js backend).
function useResolveAndOpen() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState(null);
  const [failedKey, setFailedKey] = useState(null);

  const open = async (r) => {
    const key = `${r.media_type}-${r.title}`;
    setFailedKey(null);
    setPendingKey(key);
    try {
      const resolved = await api.get(`/explore/resolve?title=${encodeURIComponent(r.title)}&media_type=${r.media_type}`);
      navigate(`/explorer/${resolved.media_type}/${resolved.source}/${encodeURIComponent(resolved.source_id)}`);
    } catch {
      setFailedKey(key);
    } finally {
      setPendingKey(null);
    }
  };

  return { open, pendingKey, failedKey };
}

function JustWatchPoster({ r, pending, failed, onClick }) {
  return (
    <button onClick={onClick} className="group flex flex-col gap-2 w-full text-left">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
        {r.poster ? (
          <img src={r.poster} alt={r.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs p-2 text-center">{r.title}</div>
        )}
        {r.jw_rank && (
          <span className="absolute bottom-0 left-0 text-3xl font-black text-white/90 leading-none px-2 py-1"
            style={{ WebkitTextStroke: '1.5px rgba(0,0,0,0.6)' }}>
            {r.jw_rank}
          </span>
        )}
        {pending && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-gray-200">Ouverture…</div>
        )}
      </div>
      <div className="text-sm font-medium truncate">{r.title}</div>
      {failed ? (
        <div className="text-[11px] text-red-400 -mt-1.5">Introuvable dans le catalogue</div>
      ) : r.platforms?.length > 0 ? (
        <div className="text-[11px] text-gray-500 -mt-1.5 truncate">{r.platforms.join(' · ')}</div>
      ) : null}
    </button>
  );
}

// Genre browsing grid: same click-to-resolve items as JustWatchRow, but wrapped into a grid
// instead of a horizontal row (for a whole genre's worth of results, not just a Top10).
function JustWatchGrid({ items }) {
  const { open, pendingKey, failedKey } = useResolveAndOpen();
  if (!items.length) return <p className="text-gray-400 text-sm">Aucun résultat pour ce genre.</p>;
  return (
    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {items.map((r) => {
        const key = `${r.media_type}-${r.title}`;
        return (
          <JustWatchPoster
            key={key}
            r={r}
            pending={pendingKey === key}
            failed={failedKey === key}
            onClick={() => open(r)}
          />
        );
      })}
    </div>
  );
}

function JustWatchRow({ title, items }) {
  const { open, pendingKey, failedKey } = useResolveAndOpen();
  const scrollRef = useWheelToHorizontalScroll();
  if (!items || !items.length) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-400 mb-3">{title}</h2>
      <div ref={scrollRef} className="scroll-row flex gap-4 overflow-x-auto pr-4 sm:pr-6">
        {items.map((r) => {
          const key = `${r.media_type}-${r.title}`;
          return (
            <div key={key} className="w-32 sm:w-36 flex-shrink-0">
              <JustWatchPoster
                r={r}
                pending={pendingKey === key}
                failed={failedKey === key}
                onClick={() => open(r)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Genre browsing (like Netflix's "Action", "Comédie"…) only makes sense once a media type is
// picked — series/anime genres (TVmaze) and movie genres (JustWatch) are different vocabularies.
const GENRE_MEDIA_TYPE = { serie: 'tv', anime: 'tv', movie: 'movie' };

export default function Explore() {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [categories, setCategories] = useState(null);
  const [genres, setGenres] = useState(null);
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [genreResults, setGenreResults] = useState(null);
  const genreScrollRef = useWheelToHorizontalScroll();

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

  const genreMediaType = GENRE_MEDIA_TYPE[tab];

  useEffect(() => {
    setSelectedGenre(null);
    setGenreResults(null);
    if (!genreMediaType) { setGenres(null); return; }
    api.get(`/explore/genres/${genreMediaType}`).then(setGenres);
  }, [genreMediaType]);

  useEffect(() => {
    if (!selectedGenre) { setGenreResults(null); return; }
    setGenreResults(null);
    api.get(`/explore/discover/${genreMediaType}?genre=${encodeURIComponent(selectedGenre)}`)
      .then((data) => setGenreResults(data.results));
  }, [selectedGenre, genreMediaType]);

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

      {!query.trim() && genres && (
        <div ref={genreScrollRef} className="scroll-row flex gap-2 overflow-x-auto">
          {genres.map((g) => (
            <button
              key={g.value}
              onClick={() => setSelectedGenre(selectedGenre === g.value ? null : g.value)}
              className={`shrink-0 text-xs rounded-full px-3 py-1.5 font-medium border ${
                selectedGenre === g.value
                  ? 'bg-accent-600 border-accent-600 text-white'
                  : 'bg-base-800 border-base-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {query.trim() ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Résultats</h2>
          {results === null ? <PosterGridSkeleton /> : <ResultGrid results={filterByTab(results)} />}
        </section>
      ) : selectedGenre ? (
        <section>
          {genreResults === null ? (
            <PosterGridSkeleton />
          ) : genreMediaType === 'movie' ? (
            <JustWatchGrid items={genreResults} />
          ) : (
            <ResultGrid results={filterByTab(genreResults)} />
          )}
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
                <JustWatchRow key={title} title={title} items={items} />
              ))}
              {newRows.map(([title, items]) => (
                <JustWatchRow key={title} title={title} items={items} />
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}
