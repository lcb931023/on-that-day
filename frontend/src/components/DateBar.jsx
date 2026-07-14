import { MONTH_NAMES } from "../constants";
import { fmtDate } from "../utils";

function formatInputDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DateBar({
  date,
  onChange,
  isPlaying,
  onTogglePlay,
  playbackStep,
  playbackSteps,
  onPlaybackStepChange,
  focusShip,
  onFocusShipChange,
  hasVoyage,
  mode,
  voyageRange,
  voyageLog,
  panelOpen,
  onOpenVoyageLog,
}) {
  const inVoyage = mode === "voyage" && voyageRange;

  const inputValue = `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  const timeValue = `${String(date.h || 0).padStart(2, "0")}:${String(date.min || 0).padStart(2, "0")}`;
  const minDate = inVoyage ? formatInputDate(voyageRange.start) : "2024-01-01";
  const maxDate = inVoyage ? formatInputDate(voyageRange.end) : "2024-12-31";

  function handleDateInput(e) {
    const [y, m, d] = e.target.value.split("-").map(Number);
    if (y && m && d) onChange(y, m, d, date.h || 0, date.min || 0);
  }

  function handleTimeInput(e) {
    const [h, min] = e.target.value.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(min)) onChange(date.y, date.m, date.d, h, min);
  }

  let dayLabel = null;
  if (inVoyage) {
    const cur = new Date(date.y, date.m - 1, date.d, date.h || 0, date.min || 0).getTime();
    const start = voyageRange.start.getTime();
    const end = voyageRange.end.getTime();
    const day = Math.round((cur - start) / (1000 * 60 * 60 * 24)) + 1;
    const total = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    dayLabel = `Day ${day} / ${total}`;
  }

  const logEntry = voyageLog?.entry;
  const logText = logEntry?.text?.trim().replace(/\s+/g, " ");

  return (
    <div id="datebar-shell" className={panelOpen ? "panel-open" : ""}>
      <div id="datebar">
        <button
          id="play-btn"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <div className="date-current">
          <span className="date-big">{date.d}</span>
          <span className="date-month">{MONTH_NAMES[date.m - 1]}</span>
        </div>
        <label className="date-picker">
          <span>Jump to</span>
          <input type="date" value={inputValue} min={minDate} max={maxDate} onChange={handleDateInput} />
          {inVoyage && <input type="time" value={timeValue} onChange={handleTimeInput} />}
        </label>
        {hasVoyage && (
          <div className="playback-step" aria-label="Playback step">
            {Object.entries(playbackSteps).map(([key, step]) => (
              <button
                key={key}
                type="button"
                className={playbackStep === key ? "active" : ""}
                onClick={() => onPlaybackStepChange(key)}
                title={`Advance ${step.label} per tick`}
              >
                {step.label}
              </button>
            ))}
          </div>
        )}
        {inVoyage && (
          <button
            type="button"
            className={`focus-toggle ${focusShip ? "active" : ""}`}
            onClick={() => onFocusShipChange((v) => !v)}
            title="Keep the ship centered while playing"
          >
            Focus
          </button>
        )}
        {hasVoyage && (
          <div className="date-hint">
            {inVoyage ? `Cook’s voyage — ${dayLabel}` : "Playback moves the ship along Cook’s voyage"}
          </div>
        )}
      </div>

      {inVoyage && logEntry && (
        <div className="voyage-log-card">
          <div className="voyage-log-meta">
            <span>{fmtDate(logEntry.y, logEntry.m, logEntry.d)}</span>
            <span>{logEntry.place}</span>
          </div>
          <p>{logText}</p>
          <button type="button" onClick={onOpenVoyageLog}>
            Read full log
          </button>
        </div>
      )}
    </div>
  );
}
