import { Link } from 'react-router-dom';
import ProgressBar from './ProgressBar.jsx';

// Quick actions (mark watched, remove) live inside the same <Link> as the poster, positioned on
// top of it and only shown on hover — like TV Time's list view, so acting on an item doesn't
// require opening its full detail page first. Each button stops the click from also triggering
// the Link's navigation.
export default function PosterCard({ to, title, poster, subtitle, progressPercent, badge, watched, onToggleWatched, onRemove }) {
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return (
    <Link to={to} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-base-800">
        {poster ? (
          <img
            src={poster}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs p-2 text-center">
            {title}
          </div>
        )}
        {badge && (
          <span className="absolute top-1.5 right-1.5 bg-accent-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
            {badge}
          </span>
        )}
        {(onToggleWatched || onRemove) && (
          <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            {onToggleWatched && (
              <button
                onClick={stop(onToggleWatched)}
                title={watched ? 'Marquer comme non vu' : 'Marquer comme vu'}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                  watched ? 'bg-green-600 text-white' : 'bg-black/70 text-gray-200 hover:bg-accent-600'
                }`}
              >
                ✓
              </button>
            )}
            {onRemove && (
              <button
                onClick={stop(onRemove)}
                title="Supprimer de ma liste"
                className="w-7 h-7 rounded-full bg-black/70 text-gray-200 hover:bg-red-600 hover:text-white flex items-center justify-center text-sm shrink-0 transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-gray-100 truncate">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 truncate -mt-1.5">{subtitle}</div>}
      {progressPercent !== undefined && (
        <ProgressBar percent={progressPercent} label={`${progressPercent}%`} />
      )}
    </Link>
  );
}
