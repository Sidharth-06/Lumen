import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, BellRing, Check, Plus } from "lucide-react";

function parsePriceValue(price) {
  if (!price) return null;
  const match = String(price).replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : null;
}

function FallbackThumb({ source }) {
  const letter = (source || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="w-full h-full bg-ink-100 flex items-center justify-center">
      <span className="font-display italic text-7xl text-ink-300">{letter}</span>
    </div>
  );
}

function MatchBar({ score }) {
  const pct = Math.max(0, Math.min(100, Math.round((score || 0) * 100)));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-ink-200 overflow-hidden">
        <motion.div
          className="h-full bg-forest-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.65, ease: "easeOut" }}
        />
      </div>
      <span className="font-mono text-[11px] text-ink-500 tabular-nums">{pct}%</span>
    </div>
  );
}

export default function ProductCard({ rec, index, selected, onToggleCompare, onOpenTrackify }) {
  const { title, url, source, snippet, price, image, score, reason } = rec;
  const currentPrice = useMemo(() => parsePriceValue(price), [price]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      whileHover={{ y: -6 }}
      className="card group/card relative shadow-soft hover:shadow-lift transition overflow-hidden flex flex-col"
    >
      <motion.span
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-forest-500 via-coral-500 to-forest-500"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.55, delay: index * 0.04, ease: "easeOut" }}
        style={{ transformOrigin: "left" }}
        aria-hidden="true"
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[16/10] relative overflow-hidden bg-ink-100 group"
      >
        {image ? (
          <img
            src={image}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
        ) : (
          <FallbackThumb source={source} />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-ink-900/20 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover/card:opacity-100"
          aria-hidden="true"
        />

        <div className="absolute top-3 left-3 inline-flex items-center gap-1.5">
          <span className="font-mono text-[11px] tabular-nums px-2 py-0.5 bg-paper-50/95 border border-ink-200 rounded-full text-ink-700">
            {String(index + 1).padStart(2, "0")}
          </span>
          {price && (
            <span className="text-[11px] px-2 py-0.5 bg-ink-800 text-paper-50 rounded-full">
              {price}
            </span>
          )}
        </div>

        <div className="absolute top-3 right-3 flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => {
              e.preventDefault();
              onOpenTrackify?.({
                title,
                url,
                source: source || "Web",
                image,
                current_price: currentPrice,
              });
            }}
            title="Track price"
            className="w-8 h-8 rounded-full flex items-center justify-center border bg-paper-50/95 border-ink-200 text-ink-600 hover:text-forest-600 transition"
          >
            <BellRing className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => {
              e.preventDefault();
              onToggleCompare();
            }}
            title={selected ? "Remove from compare" : "Add to compare"}
            className={`w-8 h-8 rounded-full flex items-center justify-center border transition ${
              selected
                ? "bg-forest-500 border-forest-500 text-paper-50"
                : "bg-paper-50/95 border-ink-200 text-ink-600 hover:text-ink-900"
            }`}
          >
            {selected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </motion.button>
        </div>
      </a>

      <div className="p-5 flex-1 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="label truncate">{source || "web"}</span>
        </div>
        <h3 className="font-display text-[22px] leading-[1.15] text-ink-800 line-clamp-2">
          {title}
        </h3>
        {reason ? (
          <p className="text-[14.5px] text-ink-600 leading-[1.6] line-clamp-3">
            <span className="italic text-forest-600">Why this. </span>
            {reason}
          </p>
        ) : (
          <p className="text-sm text-ink-500 leading-[1.6] line-clamp-3">{snippet}</p>
        )}

        <MatchBar score={score} />

        <div className="mt-auto pt-3 flex items-center justify-between border-t border-ink-200/70">
          <span className="label">Listing</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-ink-800 hover:text-forest-600"
          >
            Open
            <motion.span
              className="inline-flex"
              animate={{ x: [0, 2, 0], y: [0, -2, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <ArrowUpRight className="w-4 h-4" />
            </motion.span>
          </a>
        </div>
      </div>
    </motion.article>
  );
}
