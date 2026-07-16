// SCHEDULER (thread 3): "the game mails you a newspaper as it happens."
//
// Given a real-time CADENCE (how often a Gazette digest goes out) and a real-time
// INTERVAL (how much real time separates deliveries — compressed for a dry-run demo,
// 1:1 for real play), this walks the already-simulated voyage LOG and produces a
// delivery plan: a list of { deliverAt, kind, spanFrom, spanTo, subject, preview }
// objects, sorted by real delivery time. Two kinds:
//
//   - "gazette"  regular digest, one per `cadenceDays` of voyage time.
//   - "dispatch" breaking news: a single day inside a cadence window whose salience
//     clears `dispatchThreshold` gets pulled out and delivered EARLY (a fraction of
//     the way into the window) instead of waiting for the weekly digest — the way a
//     death or a wreck wouldn't wait for Sunday's paper.
//
// This module only PLANS; it never calls setTimeout or touches the network. A dry run
// (`plan`) is deterministic and instant. `emit` optionally renders each planned entry
// to an HTML file via the existing gazette builder, so the plan is directly usable by
// a real delivery mechanism later (cron job + mailer, a push job, etc.) — swap the
// `--emit` step's `writeFileSync` for `sendMail(entry)` and the rest is unchanged.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildGazette } from "./gazette.js";
import { hasContent, narrateDayOffline } from "../narrate/narrator.js";
import { makeRng } from "../util/rng.js";

const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
export function parseInterval(s) {
  const m = /^(\d+(?:\.\d+)?)(s|m|h|d|w)$/.exec(String(s).trim());
  if (!m) throw new Error(`Bad interval "${s}" — use e.g. 1d, 12h, 30m, 1w`);
  return Number(m[1]) * UNIT_MS[m[2]];
}
const CADENCE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };

function chunk(log, n) {
  const out = [];
  for (let i = 0; i < log.length; i += n) out.push(log.slice(i, i + n));
  return out;
}

function leadOf(records) {
  let best = null;
  for (const r of records) for (const b of [...r.incidents, ...r.rawEvents]) {
    if (b.summary && (!best || (b.salience || 0) > best.b.salience)) best = { r, b };
  }
  return best;
}

// Build the delivery plan. Pure function of the log + cadence knobs.
export function planSchedule({ log, cadence = "weekly", cadenceDays = null,
  startReal = new Date(), intervalMs = parseInterval("1d"), dispatchThreshold = 0.75 }) {
  const days = cadenceDays || CADENCE_DAYS[cadence] || 7;
  const chunks = chunk(log.filter((r) => r.date), days);
  const plan = [];
  chunks.forEach((records, i) => {
    const windowStart = new Date(startReal.getTime() + i * intervalMs);
    const windowEnd = new Date(startReal.getTime() + (i + 1) * intervalMs);
    const eventful = records.filter(hasContent);
    if (!eventful.length) return;

    // breaking news: any day whose top beat clears the threshold gets pulled out and
    // delivered early within the window (position by day-index within the chunk).
    const dispatches = [];
    records.forEach((r, di) => {
      const top = [...r.incidents, ...r.rawEvents].filter((b) => b.summary)
        .sort((a, b) => (b.salience || 0) - (a.salience || 0))[0];
      if (top && (top.salience || 0) >= dispatchThreshold) {
        const frac = (di + 0.5) / records.length;
        dispatches.push({
          deliverAt: new Date(windowStart.getTime() + frac * (windowEnd.getTime() - windowStart.getTime())),
          kind: "dispatch", spanFrom: r.date, spanTo: r.date,
          subject: `DISPATCH — ${top.summary.replace(/\.$/, "")}`,
          preview: `${r.longDate}, ${r.leg.place}: ${top.summary}`,
          records: [r],
        });
      }
    });

    plan.push(...dispatches);
    plan.push({
      deliverAt: windowEnd,
      kind: "gazette", spanFrom: records[0].date, spanTo: records[records.length - 1].date,
      subject: `The Endeavour Gazette — ${records[0].longDate} to ${records[records.length - 1].longDate}`,
      preview: (() => { const l = leadOf(records); return l ? l.b.summary : `${eventful.length} eventful day(s) of record.`; })(),
      records,
    });
  });
  return plan.sort((a, b) => a.deliverAt - b.deliverAt);
}

// Fast-forward SIMULATE: walk the plan against a "now" and report what would already
// have been delivered vs. what's still pending — the dry-run's whole point is you can
// point `simulateNow` anywhere and see the mailbox as of that moment.
export function simulateDelivery(plan, simulateNow = new Date()) {
  const delivered = plan.filter((e) => e.deliverAt <= simulateNow);
  const pending = plan.filter((e) => e.deliverAt > simulateNow);
  return { simulateNow, delivered, pending, total: plan.length };
}

// Render a planned entry to disk (gazette = full HTML broadsheet; dispatch = a small
// HTML slip). This is the seam where a real integration would substitute a mailer.
export function emit(entry, { meta = {}, outDir } = {}) {
  const rng = makeRng(1);
  let html, name;
  if (entry.kind === "gazette") {
    html = buildGazette({ records: entry.records, meta, prose: null, rng });
    name = `gazette-${entry.spanFrom}_${entry.spanTo}.html`;
  } else {
    const r = entry.records[0];
    html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(entry.subject)}</title>
<style>body{font-family:Georgia,serif;max-width:520px;margin:32px auto;padding:0 16px;color:#231d13;background:#f4ecd8;}
h1{font-size:20px;border-bottom:2px solid #231d13;padding-bottom:6px;} .meta{font-size:12px;color:#5a4a30;text-transform:uppercase;letter-spacing:1px;}</style>
</head><body><div class="meta">Special Dispatch &middot; ${esc(r.longDate)} &middot; ${esc(r.leg.place)}</div>
<h1>${esc(entry.subject.replace(/^DISPATCH — /, ""))}</h1><p>${esc(narrateDayOffline(r, rng))}</p></body></html>`;
    name = `dispatch-${entry.spanFrom}.html`;
  }
  const out = resolve(outDir, name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, html);
  return out;
}
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
