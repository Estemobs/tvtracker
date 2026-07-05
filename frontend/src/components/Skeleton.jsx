export function PosterGridSkeleton({ count = 10 }) {
  return (
    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-[2/3] rounded-lg bg-base-800 animate-pulse" />
      ))}
    </div>
  );
}
