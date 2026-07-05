export default function ProgressBar({ percent = 0, label }) {
  return (
    <div>
      <div className="h-1.5 w-full bg-base-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-500 rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      {label && <div className="text-xs text-gray-400 mt-1">{label}</div>}
    </div>
  );
}
