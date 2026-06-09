import ProductCard from "./ProductCard.jsx";

export default function ResultsGrid({ results, compareSet, onToggleCompare, onOpenTrackify }) {
  if (!results || results.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-5">
        <span className="label">The picks</span>
        <span className="h-px flex-1 bg-ink-200" />
        <span className="label tabular-nums">{results.length} found</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {results.map((rec, i) => (
          <ProductCard
            key={`${rec.url}-${i}`}
            rec={rec}
            index={i}
            selected={compareSet?.has(rec.url)}
            onToggleCompare={() => onToggleCompare(rec)}
            onOpenTrackify={onOpenTrackify}
          />
        ))}
      </div>
    </section>
  );
}
