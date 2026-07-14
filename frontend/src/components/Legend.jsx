import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS } from "../constants";

export default function Legend({ authors, groups, onFlyTo }) {
  const viewportRef = useRef(null);
  const [canPagePrev, setCanPagePrev] = useState(false);
  const [canPageNext, setCanPageNext] = useState(false);

  const items = useMemo(() => {
    const byAuthor = new Map();
    groups.forEach((g, i) => {
      const key = g[0].a;
      if (!byAuthor.has(key)) byAuthor.set(key, []);
      byAuthor.get(key).push(i);
    });

    return [...byAuthor.entries()]
      .map(([key, idxs]) => {
        const author = authors[key];
        if (!author) return null;
        const place =
          idxs.length === 1
            ? groups[idxs[0]][0].place.split(/[,，]/).pop().trim()
            : `${idxs.length} places`;
        return { key, idxs, author, place };
      })
      .filter(Boolean);
  }, [authors, groups]);

  function updatePaging() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    setCanPagePrev(viewport.scrollTop > 1);
    setCanPageNext(viewport.scrollTop < maxScroll - 1);
  }

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    updatePaging();
    viewport.addEventListener("scroll", updatePaging, { passive: true });
    window.addEventListener("resize", updatePaging);
    return () => {
      viewport.removeEventListener("scroll", updatePaging);
      window.removeEventListener("resize", updatePaging);
    };
  }, [items.length]);

  function pageLegend(direction) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      top: direction * viewport.clientHeight,
      behavior: "smooth",
    });
  }

  return (
    <div className="legend-shell">
      <button
        type="button"
        className="legend-page"
        onClick={() => pageLegend(-1)}
        disabled={!canPagePrev}
        aria-label="Previous diary filters"
        title="Previous diary filters"
      >
        ‹
      </button>
      <div id="legend" ref={viewportRef}>
        {items.map(({ key, idxs, author, place }) => (
          <button
            key={key}
            className="legend-chip"
            style={{ "--c": COLORS[key] }}
            onClick={() => onFlyTo(idxs)}
          >
            <span className="dot"></span>
            {author.name}
            <span style={{ color: "var(--ink-soft)" }}>{place}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="legend-page"
        onClick={() => pageLegend(1)}
        disabled={!canPageNext}
        aria-label="Next diary filters"
        title="Next diary filters"
      >
        ›
      </button>
    </div>
  );
}
