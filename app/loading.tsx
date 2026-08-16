export default function Loading() {
  return (
    <div className="page-shell mobile-page">
      <div className="skeleton-line w-24 mb-4" />
      <div className="skeleton h-9 w-64 rounded-xl mb-2" />
      <div className="skeleton-line w-80 mb-8" />

      <div className="grid grid-cols-3 gap-4 max-w-md mb-10">
        <div>
          <div className="skeleton-line w-14 mb-2" />
          <div className="skeleton h-7 w-16 rounded-lg" />
        </div>
        <div>
          <div className="skeleton-line w-14 mb-2" />
          <div className="skeleton h-7 w-16 rounded-lg" />
        </div>
        <div>
          <div className="skeleton-line w-14 mb-2" />
          <div className="skeleton h-7 w-16 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="skeleton h-56 rounded-2xl" />
        <div className="skeleton h-56 rounded-2xl" />
        <div className="skeleton h-56 rounded-2xl" />
      </div>
    </div>
  );
}
