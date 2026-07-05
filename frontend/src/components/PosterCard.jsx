import { Link } from 'react-router-dom';
import ProgressBar from './ProgressBar.jsx';

export default function PosterCard({ to, title, poster, subtitle, progressPercent, badge }) {
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
      </div>
      <div className="text-sm font-medium text-gray-100 truncate">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 truncate -mt-1.5">{subtitle}</div>}
      {progressPercent !== undefined && (
        <ProgressBar percent={progressPercent} label={`${progressPercent}%`} />
      )}
    </Link>
  );
}
