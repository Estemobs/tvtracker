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

// Quick actions on hover, same idea as PosterCard on the "Mes séries"/"Mes films" lists: add
// straight from a search/genre result without opening its detail page, and once added, mark
// watched or remove the same way — no full page round-trip either way.
function Poster({ r }) {
  const [state, setState] = useState({ added: r.already_added, id: r.list_id, status: r.list_status });
  const [busy, setBusy] = useState(false);
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };

  const add = async () => {
    setBusy(true);
    try {
      const data = r.media_type === 'movie'
        ? await api.post('/movies', { source: r.source, source_id: r.source_id })
        : await api.post('/shows', { source_id: r.source_id });
      setState({ added: true, id: data.movie_id ?? data.show_id, status: null });
    } finally {
      setBusy(false);
    }
  };

  const toggleWatched = async () => {
    setBusy(true);
    try {
      if (r.media_type === 'movie') {
        const newStatus = state.status === 'watched' ? 'to_watch' : 'watched';
        await api.patch(`/movies/${state.id}/status`, { status: newStatus });
        setState((s) => ({ ...s, status: newStatus }));
      } else if (state.status !== 'completed') {
        await api.post(`/shows/${state.id}/mark-complete`);
        setState((s) => ({ ...s, status: 'completed' }));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Supprimer ${r.title} de votre liste ?`)) return;
    setBusy(true);
    try {
      await api.delete(r.media_type === 'movie' ? `/movies/${state.id}` : `/shows/${state.id}`);
      setState({ added: false, id: null, status: null });
    } finally {
      setBusy(false);
    }
  };

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
        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
          {!state.added ? (
            <button
              onClick={stop(add)}
              disabled={busy}
              title="Ajouter à ma liste"
              className="w-7 h-7 rounded-full bg-accent-600 hover:bg-accent-500 text-white flex items-center justify-center text-base font-bold shrink-0 disabled:opacity-40"
            >
              +
            </button>
          ) : (
            <>
              <button
                onClick={stop(toggleWatched)}
                disabled={busy}
                title={state.status === 'watched' || state.status === 'completed' ? 'Déjà vu' : 'Marquer comme vu'}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors disabled:opacity-40 ${
                  state.status === 'watched' || state.status === 'completed' ? 'bg-green-600 text-white' : 'bg-black/70 text-gray-200 hover:bg-accent-600'
                }`}
              >
                ✓
              </button>
              <button
                onClick={stop(remove)}
                disabled={busy}
                title="Supprimer de ma liste"
                className="w-7 h-7 rounded-full bg-black/70 text-gray-200 hover:bg-red-600 hover:text-white flex items-center justify-center text-sm shrink-0 disabled:opacity-40"
              >
                ✕
              </button>
            </>
          )}
        </div>
        {state.added && (
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

// Genre browsing (like Netflix's "Action", "Comédie"…) needs to know which vocabulary to use —
// series/anime genres (TVmaze) and movie genres (JustWatch) are different lists. On "Tout", there's
// no single obvious choice, so it defaults to TV/anime genres (the most common two of the three).
const GENRE_MEDIA_TYPE = { all: 'tv', serie: 'tv', anime: 'tv', movie: 'movie' };

// A movie search resolves a poster for every result missing one (see backend), which on a
// Wikipedia/Wikidata rate-limited day can take a while — the static skeleton alone doesn't tell
// the user whether it's still working or just stuck. A spinner plus an elapsed counter (and an
// apologetic note once it's clearly taking a while) keeps that distinction obvious.
function SearchProgress({ seconds }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
      <span className="w-4 h-4 border-2 border-gray-600 border-t-accent-500 rounded-full animate-spin" />
      <span>Recherche en cours{seconds > 0 ? ` (${seconds}s)` : '…'}</span>
      {seconds >= 8 && <span className="text-gray-500">— Wikipédia répond lentement, ça arrive.</span>}
    </div>
  );
}

function useElapsedSeconds(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const start = Date.now();
    const handle = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(handle);
  }, [active]);
  return seconds;
}

export default function Explore() {
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  // What was actually searched, separate from what's typed: a search-as-you-type debounce means
  // every keystroke (including a mid-typo one) fires a real request, and on a slow/rate-limited
  // day (see SearchProgress below) that's a pile of wasted, overlapping searches — annoying and
  // exactly what triggers this. Only Enter or the button commits `query` into `submittedQuery`,
  // which is the only thing the search effect below reacts to.
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState(null);
  const [categories, setCategories] = useState(null);
  const [genres, setGenres] = useState(null);
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [genreResults, setGenreResults] = useState(null);

  useEffect(() => {
    api.get('/explore/trending').then(setCategories).catch(() => setCategories({}));
  }, []);

  useEffect(() => {
    if (!submittedQuery.trim()) { setResults(null); return; }
    setResults(null);
    api.get(`/explore/search?q=${encodeURIComponent(submittedQuery)}`).then((data) => setResults(data.results));
  }, [submittedQuery]);

  const runSearch = () => setSubmittedQuery(query);

  const searchSeconds = useElapsedSeconds(!!submittedQuery.trim() && results === null);

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

      <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une série, un anime, un film…"
          className="flex-1 min-w-0 rounded-lg bg-base-800 border border-base-600 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <button
          type="submit"
          className="bg-accent-600 hover:bg-accent-500 text-sm rounded-lg px-4 py-2.5 font-medium shrink-0"
        >
          Rechercher
        </button>
      </form>

      <div className="flex items-center justify-between gap-3 flex-wrap">
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

        {!submittedQuery.trim() && genres && (
          <select
            value={selectedGenre || ''}
            onChange={(e) => setSelectedGenre(e.target.value || null)}
            className="bg-base-800 border border-base-600 rounded-lg text-xs px-3 py-2 text-gray-300 focus:outline-none focus:ring-2 focus:ring-accent-500"
          >
            <option value="">Recommandé par genre…</option>
            {genres.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        )}
      </div>

      {submittedQuery.trim() ? (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Résultats</h2>
          {results === null ? (
            <>
              <SearchProgress seconds={searchSeconds} />
              <PosterGridSkeleton />
            </>
          ) : (
            <ResultGrid results={filterByTab(results)} />
          )}
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
