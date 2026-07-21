import { useEffect, useState } from "react";
import { COLORS, MONTH_NAMES, VOYAGE_COLOR } from "../constants";
import { dataUrl, fetchOnThisDay } from "../api";
import { ageOn, fmtDate, yearsAgo, esc } from "../utils";

const OTD_WINDOW_DAYS = 14;

function formatOtdDate(m, d) {
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

export default function Panel({ group, entryIndex, author, target, onClose, onSelectEntry }) {
  const [events, setEvents] = useState(null);
  const entry = group[entryIndex];

  useEffect(() => {
    const cache = new Map();
    async function load() {
      setEvents(null);
      const days = [];
      for (let i = OTD_WINDOW_DAYS; i >= 0; i--) {
        const d = new Date(entry.y, entry.m - 1, entry.d - i);
        days.push([d.getMonth() + 1, d.getDate()]);
      }
      const perDay = await Promise.all(
        days.map(async ([m, d]) => {
          const key = `${m}-${d}`;
          if (!cache.has(key)) {
            const evs = await fetchOnThisDay(m, d);
            cache.set(key, evs);
          }
          return cache.get(key).filter((ev) => ev.year === entry.y).map((ev) => ({ m, d, text: ev.text }));
        })
      );
      setEvents(perDay.flat().slice(-6));
    }
    load();
  }, [entry]);

  const paragraphs = entry.text.split(/\n\n+/).map((p, i) => (
    <p key={i} dangerouslySetInnerHTML={{ __html: esc(p.trim()) }}></p>
  ));

  const [imgError, setImgError] = useState(false);
  const accent = COLORS[entry.a] || VOYAGE_COLOR;
  const age = author.born ? ageOn(author.born, entry.y, entry.m, entry.d) : null;
  const initials = author.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div id="panel">
      <button id="panel-close" onClick={onClose}>×</button>
      <div id="panel-body" style={{ "--c": accent }}>
        <div className="pn-head">
          {!imgError && (
            <img
              className="pn-cover"
              src={dataUrl(`${entry.a}.jpg`)}
              alt=""
              onError={() => setImgError(true)}
            />
          )}
          {imgError && (
            <div className="pn-cover pn-cover-placeholder" style={{ background: accent }}>
              {initials}
            </div>
          )}
          <div>
            <div className="pn-author">{author.name}</div>
            <div className="pn-source">{author.source}</div>
          </div>
        </div>

        {group.length > 1 && (
          <div className="pn-years">
            {group.map((x, i) => (
              <button
                key={x.y}
                className={`year-chip ${i === entryIndex ? "active" : ""}`}
                onClick={() => onSelectEntry(i)}
              >
                {x.y}
              </button>
            ))}
          </div>
        )}

        <div className="pn-dateline">
          <span className="pn-date">{fmtDate(entry.y, entry.m, entry.d)}</span>
          <span className="pn-age">
            {age !== null ? `aged ${age} · ` : ""}
            {yearsAgo(entry.y)} years ago
          </span>
        </div>

        <div className="pn-placeline">
          {entry.place} — {author.note}
        </div>

        {entry.delta ? (
          <div className="pn-note">
            No entry survives for {target.d} {MONTH_NAMES[target.m - 1]} — this is the nearest, {entry.delta} day
            {entry.delta > 1 ? "s" : ""} away.
          </div>
        ) : null}

        <div className="pn-text">{paragraphs}</div>

        <div className="pn-otd">
          <h3>Meanwhile, in the world</h3>
          <div className="pn-otd-sub">
            The days leading up to {entry.d} {MONTH_NAMES[entry.m - 1]}, {entry.y}
          </div>
          {events === null ? (
            <div className="otd-muted">Consulting the archives…</div>
          ) : events.length === 0 ? (
            <div className="otd-muted">The archives are silent for the days before this.</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="otd-item">
                <span className="otd-year">{formatOtdDate(ev.m, ev.d)}</span>
                <span dangerouslySetInnerHTML={{ __html: esc(ev.text) }}></span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
