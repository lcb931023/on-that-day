// Artifact generator: THE ENDEAVOUR GAZETTE. Given a span of the voyage log it prints
// a period broadsheet that blends REAL history (the "Dispatches of Record" column)
// with the crew's simulated exploits (the "Ship's Intelligence" column) and singles
// out the player characters' deeds. This is the thing the game "sends to players" —
// a self-contained HTML page you can open, mail, or publish as an Artifact.

import { hasContent, narrateDayOffline } from "../narrate/narrator.js";

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

// Choose the lead story: the single highest-salience beat across the span.
function pickLead(records) {
  let best = null;
  for (const r of records) for (const b of [...r.incidents, ...r.rawEvents]) {
    if (b.summary && (!best || (b.salience || 0) > (best.b.salience || 0))) best = { r, b };
  }
  return best;
}

export function buildGazette({ records, meta = {}, prose = null, rng }) {
  const withContent = records.filter(hasContent);
  const first = records[0], last = records[records.length - 1];
  const lead = pickLead(records);

  const realDispatches = [];
  for (const r of records) for (const e of r.realEvents) realDispatches.push({ date: r.longDate, text: e.text });

  const notices = [];
  for (const r of records) for (const b of [...r.incidents, ...r.rawEvents]) {
    if (b.summary && b.salience >= 0.4 && b !== lead?.b) notices.push({ date: r.longDate, text: b.summary, pc: b.pcInvolved });
  }
  const deaths = [];
  for (const r of records) for (const d of r.deaths) deaths.push({ date: r.longDate, name: d.name, cause: d.cause });
  const pcDeeds = notices.filter((n) => n.pc);

  const body = prose || withContent.map((r) => `<p><b>${r.longDate}.</b> ${esc(narrateDayOffline(r, rng))}</p>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>The Endeavour Gazette — ${esc(first?.longDate || "")}</title>
<style>
  :root{--ink:#231d13;--paper:#f4ecd8;--rule:#8a7a55;}
  body{margin:0;background:#2a2620;font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;color:#231d13;}
  .sheet{max-width:900px;margin:24px auto;background:#f4ecd8;padding:36px 44px;box-shadow:0 8px 40px rgba(0,0,0,.5);
    background-image:radial-gradient(rgba(120,90,40,.05) 1px,transparent 1px);background-size:4px 4px;}
  .masthead{text-align:center;border-bottom:3px double #231d13;padding-bottom:10px;}
  .masthead h1{font-size:52px;margin:0;letter-spacing:1px;font-variant:small-caps;}
  .masthead .sub{display:flex;justify-content:space-between;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:8px;border-top:1px solid #231d13;padding-top:6px;}
  .lead{margin:18px 0;padding-bottom:14px;border-bottom:1px solid #b8a06a;}
  .lead h2{font-size:30px;margin:0 0 6px;font-variant:small-caps;line-height:1.1;}
  .cols{column-count:2;column-gap:28px;column-rule:1px solid #c9ba97;font-size:14.5px;line-height:1.5;text-align:justify;}
  .cols p{margin:0 0 10px;}
  .box{break-inside:avoid;border:1px solid #231d13;padding:10px 12px;margin:0 0 14px;}
  .box h3{margin:0 0 6px;font-variant:small-caps;font-size:16px;border-bottom:1px solid #231d13;}
  .box ul{margin:0;padding-left:16px;} .box li{margin-bottom:5px;}
  .pc{background:#efe0b8;} .pc::before{content:"★ ";}
  .obit li{color:#5a3a2a;}
  h1,h2,h3{font-family:"Playbill","Bodoni MT",Georgia,serif;}
  .drop::first-letter{font-size:44px;float:left;line-height:.8;padding:2px 6px 0 0;font-weight:bold;}
</style></head><body><div class="sheet">
  <div class="masthead">
    <h1>The Endeavour Gazette</h1>
    <div class="sub"><span>${esc(meta.ship || "HMS Endeavour")}</span><span>Printed at Sea &amp; Ashore</span><span>${esc(first?.longDate || "")} — ${esc(last?.longDate || "")}</span></div>
  </div>
  ${lead ? `<div class="lead"><h2>${esc(lead.b.summary.replace(/\.$/, ""))}</h2>
    <p class="drop">${esc(lead.r.longDate)}, off ${esc(lead.r.leg.place)}. ${esc(narrateDayOffline(lead.r, rng))}</p></div>` : ""}
  <div class="cols">
    <div class="box"><h3>Dispatches of Record</h3><ul>
      ${realDispatches.map((d) => `<li><b>${esc(d.date)}.</b> ${esc(d.text)}</li>`).join("") || "<li>Nothing of record.</li>"}
    </ul></div>
    ${pcDeeds.length ? `<div class="box pc" style="content:none"><h3>Of Our Own Company</h3><ul>${pcDeeds.map((n) => `<li>${esc(n.text)} <i>(${esc(n.date)})</i></li>`).join("")}</ul></div>` : ""}
    <div class="box"><h3>Ship's Intelligence</h3><ul>
      ${notices.filter((n)=>!n.pc).slice(0, 12).map((n) => `<li>${esc(n.text)} <i>(${esc(n.date)})</i></li>`).join("") || "<li>All quiet.</li>"}
    </ul></div>
    ${deaths.length ? `<div class="box obit"><h3>The Bill of Mortality</h3><ul>${deaths.map((d) => `<li><b>${esc(d.name)}</b>, ${esc(d.cause)} — ${esc(d.date)}.</li>`).join("")}</ul></div>` : ""}
    ${body}
  </div>
</div></body></html>`;
}
