import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import PosterCard from '../../components/PosterCard.jsx';
import { PosterGridSkeleton } from '../../components/Skeleton.jsx';

export default function MoviesList() {
  const [movies, setMovies] = useState(null);
  const [filter, setFilter] = useState('to_watch');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    params.set('sort', sort);
    setMovies(null);
    api.get(`/movies?${params}`).then(setMovies).catch(() => setMovies([]));
  }, [filter, sort]);

  const toggle = async (movie) => {
    const newStatus = movie.status === 'watched' ? 'to_watch' : 'watched';
    setMovies((prev) => prev.map((m) => (m.movie_id === movie.movie_id ? { ...m, status: newStatus } : m)));
    await api.patch(`/movies/${movie.movie_id}/status`, { status: newStatus });
  };

  const remove = async (movie) => {
    if (!confirm('Supprimer ce film de votre liste ?')) return;
    setMovies((prev) => prev.filter((m) => m.movie_id !== movie.movie_id));
    await api.delete(`/movies/${movie.movie_id}`);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Films</h1>

      <div className="flex flex-wrap gap-2">
        <div className="flex bg-base-800 rounded-lg p-0.5 border border-base-700">
          {[['to_watch', 'À voir'], ['watched', 'Vus']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === v ? 'bg-accent-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="bg-base-800 border border-base-600 rounded-lg text-xs px-2 py-1.5 text-gray-300"
        >
          <option value="recent">Date d'ajout</option>
          <option value="alpha">Titre</option>
          <option value="note">Note</option>
        </select>
      </div>

      {movies === null ? (
        <PosterGridSkeleton />
      ) : movies.length === 0 ? (
        <p className="text-gray-400 text-sm">Aucun film pour le moment. Direction l'onglet Explorer !</p>
      ) : (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {movies.map((m) => (
            <PosterCard
              key={m.movie_id}
              to={`/films/${m.movie_id}`}
              title={m.title}
              poster={m.poster}
              watched={m.status === 'watched'}
              onToggleWatched={() => toggle(m)}
              onRemove={() => remove(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
