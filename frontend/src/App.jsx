import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { fetchAuthors, fetchDay, fetchVoyage } from "./api";
import { MONTH_NAMES } from "./constants";
import { targetDate, groupByPlace } from "./utils";
import MapView from "./components/MapView";
import Legend from "./components/Legend";
import Panel from "./components/Panel";
import DateBar from "./components/DateBar";
import "./App.css";

const PLAY_SPEED_MS = 1000;
const PLAYBACK_STEPS = {
  day: { label: "1d", ms: 24 * 60 * 60 * 1000 },
  hour: { label: "1h", ms: 60 * 60 * 1000 },
  minute: { label: "1m", ms: 60 * 1000 },
};

function entryTime(entry) {
  return new Date(entry.y, entry.m - 1, entry.d).getTime();
}

function pickVoyageEntry(entries, target) {
  if (!entries.length) return null;

  if (target <= entryTime(entries[0])) return entries[0];

  const last = entries[entries.length - 1];
  if (target >= entryTime(last)) return last;

  for (let i = 0; i < entries.length - 1; i++) {
    const current = entries[i];
    const next = entries[i + 1];
    const currentTime = entryTime(current);
    const nextTime = entryTime(next);
    if (target >= currentTime && target <= nextTime) {
      return target - currentTime <= nextTime - target ? current : next;
    }
  }

  return null;
}

function App() {
  const [authors, setAuthors] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [voyages, setVoyages] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [panel, setPanel] = useState(null); // { groupIndex?, entryIndex?, voyageKey?, entry? }
  const [voyageDate, setVoyageDate] = useState(targetDate());
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackStep, setPlaybackStep] = useState("day");
  const [focusShip, setFocusShip] = useState(false);
  const [mode, setMode] = useState("diary"); // "diary" | "voyage"
  const mapRef = useRef(null);
  const playRef = useRef(null);

  const diaryDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const diaryTarget = {
    y: diaryDate.getFullYear(),
    m: diaryDate.getMonth() + 1,
    d: diaryDate.getDate(),
    h: 0,
    min: 0,
  };
  const voyageTarget = {
    y: voyageDate.getFullYear(),
    m: voyageDate.getMonth() + 1,
    d: voyageDate.getDate(),
    h: voyageDate.getHours(),
    min: voyageDate.getMinutes(),
  };
  const target = mode === "voyage" ? voyageTarget : diaryTarget;
  const groups = dayData ? groupByPlace(dayData.entries) : [];
  const hasVoyage = voyages.length > 0;
  const targetVoyageTime = new Date(
    voyageTarget.y,
    voyageTarget.m - 1,
    voyageTarget.d,
    voyageTarget.h || 0,
    voyageTarget.min || 0
  ).getTime();

  const currentVoyageLog = useMemo(() => {
    if (mode !== "voyage" || !authors) return null;

    for (const voyage of voyages) {
      const entry = pickVoyageEntry(voyage.entries, targetVoyageTime);
      if (entry) {
        return {
          voyageKey: voyage.key,
          entry,
          author: authors[voyage.key],
        };
      }
    }

    return null;
  }, [authors, mode, targetVoyageTime, voyages]);

  const voyageRange = useMemo(() => {
    if (!voyages.length) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of voyages) {
      for (const e of v.entries) {
        const ord = new Date(e.y, e.m - 1, e.d).getTime();
        if (ord < min) min = ord;
        if (ord > max) max = ord;
      }
    }
    return { start: new Date(min), end: new Date(max) };
  }, [voyages]);

  // Load authors and voyage routes once. Playback changes the current date
  // frequently, so route data must not be re-fetched on each day tick.
  useEffect(() => {
    async function load() {
      const a = await fetchAuthors();
      setAuthors(a);

      const voyageKeys = Object.entries(a)
        .filter(([, auth]) => auth.type === "voyage")
        .map(([key]) => key);
      if (voyageKeys.length) {
        const voyageData = await Promise.all(voyageKeys.map((key) => fetchVoyage(key)));
        setVoyages(
          voyageKeys.map((key, i) => ({
            key,
            entries: voyageData[i].entries,
          }))
        );
      }
    }
    load();
  }, []);

  // Load calendar-day diary data when the selected month/day changes.
  useEffect(() => {
    async function loadDay() {
      const d = await fetchDay(diaryTarget.m, diaryTarget.d);
      setDayData(d);
    }
    loadDay();
  }, [diaryTarget.m, diaryTarget.d]);

  // When switching to voyage mode, make sure the current date falls within the
  // voyage's actual date range so the ship is positioned on the route.
  useEffect(() => {
    if (mode !== "voyage" || !voyageRange) return;
    setVoyageDate((prev) => {
      const cur = prev.getTime();
      const start = voyageRange.start.getTime();
      const end = voyageRange.end.getTime();
      if (cur < start || cur > end) {
        return new Date(voyageRange.start);
      }
      return prev;
    });
  }, [mode, voyageRange]);

  useEffect(() => {
    if (!panel?.voyageKey || !currentVoyageLog) return;
    if (panel.voyageKey !== currentVoyageLog.voyageKey) return;
    if (panel.entry === currentVoyageLog.entry && panel.author === currentVoyageLog.author) return;

    setPanel({
      voyageKey: currentVoyageLog.voyageKey,
      entry: currentVoyageLog.entry,
      author: currentVoyageLog.author,
    });
  }, [currentVoyageLog, panel]);

  // Fit map to diary markers on first load; voyages are fitted by VoyageLayer.
  useEffect(() => {
    if (!groups.length || !mapRef.current || hasVoyage) return;
    const fallback = () => {
      const bounds = L.latLngBounds(groups.map((g) => [g[0].lat, g[0].lng]));
      mapRef.current.flyToBounds(bounds.pad(0.3));
    };
    fallback();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      fallback,
      { timeout: 8000 }
    );
  }, [groups.length, hasVoyage]);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying || mode !== "voyage") {
      if (playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
      return;
    }
    playRef.current = setInterval(() => {
      setVoyageDate((prev) => {
        const next = new Date(prev.getTime() + PLAYBACK_STEPS[playbackStep].ms);
        if (voyageRange) {
          if (next.getTime() > voyageRange.end.getTime()) {
            return new Date(voyageRange.start);
          }
        }
        return next;
      });
    }, PLAY_SPEED_MS);
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [isPlaying, mode, voyageRange, playbackStep]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setPanel(null);
      if (e.key === " " && mode === "voyage") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode]);

  function handleDateChange(y, m, d, h = 0, min = 0) {
    setIsPlaying(false);
    setVoyageDate(() => {
      const next = new Date(y, m - 1, d, h, min);
      if (voyageRange) {
        const start = voyageRange.start.getTime();
        const end = voyageRange.end.getTime();
        if (next.getTime() < start) {
          return new Date(voyageRange.start);
        } else if (next.getTime() > end) {
          return new Date(voyageRange.end);
        }
      }
      return next;
    });
  }

  function handleOpenPanel(groupIndex, entryIndex) {
    setPanel({ groupIndex, entryIndex });
  }

  function handleOpenVoyageEntry(voyageKey, entry) {
    const author = authors[voyageKey];
    if (!author) return;
    setPanel({ voyageKey, entry, author });
  }

  function handleFlyTo(idxs) {
    if (!mapRef.current || !idxs.length) return;
    if (idxs.length === 1) {
      const g = groups[idxs[0]];
      mapRef.current.flyTo(g[0].lat, g[0].lng, 12);
    } else {
      const bounds = L.latLngBounds(idxs.map((i) => [groups[i][0].lat, groups[i][0].lng]));
      mapRef.current.flyToBounds(bounds);
    }
  }

  if (!authors || !dayData) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <>
      <header id="masthead">
        <div className="masthead-left">
          {hasVoyage && (
            <button
              className={`mode-toggle ${mode}`}
              onClick={() => {
                setIsPlaying(false);
                setMode((m) => (m === "diary" ? "voyage" : "diary"));
              }}
            >
              <span className="mode-icon" aria-hidden="true">
                {mode === "diary" ? "D" : "V"}
              </span>
              <span>{mode === "diary" ? "Diary mode" : "Voyage mode"}</span>
            </button>
          )}
          <div className="masthead-title">
            <h1>On That Day</h1>
            <span id="masthead-date">
              {target.d} {MONTH_NAMES[target.m - 1]} — the same day, decades ago
            </span>
          </div>
        </div>
        <div className="masthead-controls">
          {mode === "diary" && <Legend authors={authors} groups={groups} onFlyTo={handleFlyTo} />}
        </div>
      </header>

      {mode === "voyage" && (
        <DateBar
          date={voyageTarget}
          onChange={handleDateChange}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          playbackStep={playbackStep}
          playbackSteps={PLAYBACK_STEPS}
          onPlaybackStepChange={setPlaybackStep}
          focusShip={focusShip}
          onFocusShipChange={setFocusShip}
          hasVoyage={hasVoyage}
          mode={mode}
          voyageRange={voyageRange}
          voyageLog={currentVoyageLog}
          panelOpen={Boolean(panel)}
          onOpenVoyageLog={() => {
            if (currentVoyageLog) {
              handleOpenVoyageEntry(currentVoyageLog.voyageKey, currentVoyageLog.entry);
            }
          }}
        />
      )}

      <MapView
        ref={mapRef}
        mode={mode}
        groups={groups}
        authors={authors}
        voyages={voyages}
        currentDate={voyageTarget}
        focusShip={focusShip}
        onOpenPanel={handleOpenPanel}
        onOpenVoyageEntry={handleOpenVoyageEntry}
        userLocation={userLocation}
      />

      {panel && panel.groupIndex !== undefined && (
        <Panel
          group={groups[panel.groupIndex]}
          entryIndex={panel.entryIndex}
          author={authors[groups[panel.groupIndex][0].a]}
          target={diaryTarget}
          onClose={() => setPanel(null)}
          onSelectEntry={(i) => setPanel({ ...panel, entryIndex: i })}
        />
      )}

      {panel && panel.voyageKey && (
        <Panel
          group={[panel.entry]}
          entryIndex={0}
          author={panel.author}
          target={voyageTarget}
          onClose={() => setPanel(null)}
        />
      )}

      <div id="colophon">
        Made with <span className="heart">♥</span> for old diaries ·{" "}
        <a href="https://github.com/RaphaelRong/on-that-day" target="_blank" rel="noreferrer">
          source
        </a>
      </div>
    </>
  );
}

export default App;
