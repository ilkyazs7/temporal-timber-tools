"use strict";

/*
  Temporal Timber / Maintenance — possibility tree

  Every maintenance event opens a parallel reality. Each run of the
  prediction adds its event sequence to a tree: runs that share their
  first events share branches, and the first different event branches off.

  Each reality is a horizontal lane that runs to the end of the horizon.
  Instead of text, the tree shows the surface itself: a 10×10 pixel matrix
  at every branching point (the moment of the intervention, with the new
  coverage outlined) and at the end of every lane (the predicted surface if
  nothing else is done after that point).
*/

const PT = { nodes: [], current: null, seq: 0, signature: null };

function ptSignature() {
  if (!state.dailyEnvironment.length) return null;
  const l = state.location || {};
  return [l.latitude, l.longitude, isoDate(state.simulationStart), state.dailyEnvironment.length].join("|");
}

function ptReset() {
  PT.nodes = [{ id: 0, parent: null, day: 0, event: null }];
  PT.current = 0;
  PT.seq = 1;
  PT.signature = ptSignature();
}

function ptNode(id) { return id == null ? null : PT.nodes.find((n) => n.id === id); }

function ptEventKey(e) {
  return `${e.dayIndex}|${e.action}|${e.pattern || ""}|${e.cells ? e.cells.join("") : ""}`;
}

function ptPathEvents(node) {
  const events = [];
  for (let p = node; p && p.event; p = ptNode(p.parent)) events.unshift(p.event);
  return events;
}

// record the event sequence of the run that just happened
function ptRecord() {
  if (PT.signature !== ptSignature()) ptReset();
  let node = ptNode(0);
  for (const ev of state.events) {
    const event = {
      dayIndex: ev.dayIndex,
      date: ev.date,
      action: ev.action,
      pattern: ev.pattern,
      cells: ev.pattern && state.patterns.has(ev.pattern) ? [...state.patterns.get(ev.pattern)] : null,
    };
    const key = ptEventKey(event);
    let child = PT.nodes.find((n) => n.parent === node.id && ptEventKey(n.event) === key);
    if (!child) {
      child = { id: PT.seq++, parent: node.id, day: event.dayIndex, event };
      PT.nodes.push(child);
    }
    node = child;
  }
  PT.current = node.id;
}

// ─── surface prediction for any event sequence (same model as runSimulation)
function ptSimulate(events, stopDays) {
  const days = state.dailyEnvironment.length;
  const byDay = new Map();
  events.forEach((e) => {
    if (!byDay.has(e.dayIndex)) byDay.set(e.dayIndex, []);
    byDay.get(e.dayIndex).push(e);
  });

  const totalBaseUv = state.dailyEnvironment.reduce((s, e) => s + e.uvIncrement, 0);
  const targetUvDose = (totalBaseUv / Math.max(1, days)) * 30.4375 * TARGET_DARKENING_MONTHS;
  const delta = state.rgbT0.map((c0, i) => [0, 1, 2].map((k) => state.rgbT1[i][k] - c0[k]));

  const wanted = new Set(stopDays);
  const out = {};
  let coverage = new Array(CELL_COUNT).fill(0);
  const uv = new Array(CELL_COUNT).fill(0);

  const surfaceNow = () => state.rgbT1.map((rgb, i) => {
    const p = normalizedWeatheringProgress(uv[i], targetUvDose) * RGB_RESPONSE_AMPLITUDE;
    return [0, 1, 2].map((k) => clamp(rgb[k] + delta[i][k] * p, 0, 255));
  });

  for (let day = 0; day <= days; day += 1) {
    // exposure accumulated up to this day uses yesterday's coverage
    if (day > 0) {
      const env = state.dailyEnvironment[day - 1];
      for (let i = 0; i < CELL_COUNT; i += 1) {
        uv[i] += env.uvIncrement * (1 - coverage[i] * SUN_PROTECTION_EFFICIENCY);
      }
    }
    for (const e of byDay.get(day) || []) {
      coverage = e.action === "remove" || !e.cells ? new Array(CELL_COUNT).fill(0) : [...e.cells];
    }
    if (wanted.has(day)) out[day] = { rgb: surfaceNow(), coverage: [...coverage] };
  }
  return out;
}

// ─── returning to a reality
function ptTravel(id) {
  const node = ptNode(id);
  if (!node) return;
  const events = ptPathEvents(node).map((e) => {
    let name = e.pattern;
    if (name && e.cells) {
      const existing = state.patterns.get(name);
      if (!existing) {
        state.patterns.set(name, [...e.cells]);
      } else if (existing.join("") !== e.cells.join("")) {
        name = `${name}*`;
        state.patterns.set(name, [...e.cells]);
      }
    }
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      date: e.date,
      dayIndex: e.dayIndex,
      action: e.action,
      pattern: name,
    };
  });
  state.events = events;
  renderPatternLists();
  renderMaintenanceLog();
  renderTimelineEventMarkers();
  ptClose();
  runSimulation();
}

// ─── hooks into the existing tool
const _ptRunSimulation = runSimulation;
runSimulation = function () {
  _ptRunSimulation();
  if (state.rgbStates.length) {
    ptRecord();
    const btn = document.getElementById("ptOpenButton");
    if (btn) btn.disabled = false;
  }
};

const _ptStopPlayback = stopPlayback;
stopPlayback = function () {
  const finished = isPlaying && Number(els.daySlider.value) >= Number(els.daySlider.max);
  _ptStopPlayback();
  // a completed timespan opens the tree of possibilities
  if (finished && PT.nodes.length) ptOpen();
};

// ─── drawing
function ptOpen() {
  if (!state.rgbT0 || !state.dailyEnvironment.length) return;
  document.getElementById("pt-sheet").classList.add("open");
  ptRender();
}
function ptClose() { document.getElementById("pt-sheet").classList.remove("open"); }

function ptShortDate(dayIndex) {
  const d = dayIndex === 0 ? state.simulationStart : timelineDateForDay(dayIndex);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d).toLowerCase();
}

function ptEventLabel(e) {
  if (e.action === "remove") return `${ptShortDate(e.dayIndex)} · remove`;
  return `${ptShortDate(e.dayIndex)} · ${e.action} ${String(e.pattern || "").toLowerCase()}`;
}

function ptMatrix(x, y, size, snap, outline) {
  const c = size / GRID_SIZE;
  let s = "";
  snap.rgb.forEach((rgb, i) => {
    const cx = x + (i % GRID_SIZE) * c, cy = y + Math.floor(i / GRID_SIZE) * c;
    s += `<rect x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" width="${(c + 0.05).toFixed(2)}" height="${(c + 0.05).toFixed(2)}" fill="rgb(${rgb.map(Math.round).join(",")})"/>`;
  });
  if (outline) {
    snap.coverage.forEach((v, i) => {
      if (!v) return;
      const cx = x + (i % GRID_SIZE) * c, cy = y + Math.floor(i / GRID_SIZE) * c;
      s += `<rect x="${(cx + 0.6).toFixed(2)}" y="${(cy + 0.6).toFixed(2)}" width="${(c - 1.2).toFixed(2)}" height="${(c - 1.2).toFixed(2)}" fill="none" stroke="#000" stroke-width="0.8"/>`;
    });
  }
  s += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="none" stroke="#000" stroke-width="1"/>`;
  return s;
}

function ptRender() {
  const host = document.getElementById("pt-tree");
  const days = state.dailyEnvironment.length;
  const kids = (id) => PT.nodes.filter((n) => n.parent === id).sort((a, b) => b.day - a.day || b.id - a.id);
  const order = [];
  (function walk(n) { order.push(n); kids(n.id).forEach(walk); })(PT.nodes[0]);
  const lane = {}; order.forEach((n, i) => (lane[n.id] = i));

  const path = new Set();
  for (let p = ptNode(PT.current); p; p = ptNode(p.parent)) path.add(p.id);

  const M = 52, ME = 64, LANE = M + 58, PADT = 44 + M + 16, PADL = 90;
  const TEXT = ME + 150;
  const W = Math.max(host.clientWidth, 1100);
  const span = W - PADL - TEXT - 60;
  const X = (d) => PADL + (d / days) * span;
  const Y = (n) => PADT + lane[n.id] * LANE;
  const H = PADT + order.length * LANE - LANE + ME / 2 + 40;
  const BLK = "#000", GRY = "#a8a8a8";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const txt = (x, y, t, fill, anchor) => `<text x="${x}" y="${y}" fill="${fill}" ${anchor ? `text-anchor="${anchor}"` : ""} stroke="#fff" stroke-width="4" paint-order="stroke">${esc(t)}</text>`;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="IBM Plex Mono, ui-monospace, Menlo, monospace" font-size="11">`;
  svg += `<rect width="${W}" height="${H}" fill="#fff"/>`;

  // time axis: ~6 ticks across the horizon
  const step = Math.max(1, Math.round(days / 6));
  for (let d = 0; d <= days; d += step) {
    svg += `<line x1="${X(d)}" y1="28" x2="${X(d)}" y2="${H}" stroke="#f0f0f0"/>`;
    svg += `<text x="${X(d)}" y="20" text-anchor="middle" fill="#9a9a9a">${ptShortDate(Math.min(d, days - 1))}</text>`;
  }

  // lanes
  order.forEach((n) => {
    const y = Y(n), x0 = X(n.day), xEnd = X(days);
    const pathKid = kids(n.id).find((k) => path.has(k.id));
    const xBlack = !path.has(n.id) ? x0 : pathKid ? X(pathKid.day) : xEnd;
    if (n.parent == null) {
      svg += `<line x1="${PADL - 54}" y1="${y}" x2="${PADL - 38}" y2="${y}" stroke="${BLK}" stroke-dasharray="2 4"/>`;
      svg += `<line x1="${PADL - 38}" y1="${y}" x2="${x0}" y2="${y}" stroke="${BLK}" stroke-width="1.4"/>`;
    }
    if (xBlack > x0) svg += `<line x1="${x0}" y1="${y}" x2="${xBlack}" y2="${y}" stroke="${BLK}" stroke-width="1.4"/>`;
    if (xEnd > xBlack) svg += `<line x1="${xBlack}" y1="${y}" x2="${xEnd}" y2="${y}" stroke="${GRY}"/>`;
    const tailOn = path.has(n.id) && !pathKid;
    svg += `<line x1="${xEnd}" y1="${y}" x2="${xEnd + 44}" y2="${y}" stroke="${tailOn ? BLK : GRY}" stroke-dasharray="3 4"/>`;
    if (n.parent != null) {
      const on = path.has(n.id);
      svg += `<line x1="${x0}" y1="${Y(ptNode(n.parent))}" x2="${x0}" y2="${y}" stroke="${on ? BLK : GRY}" stroke-width="${on ? 1.4 : 1}"/>`;
    }
  });

  // matrices
  order.forEach((n) => {
    const y = Y(n), x0 = X(n.day), xEnd = X(days);
    const on = path.has(n.id), isCur = n.id === PT.current;
    const events = ptPathEvents(n);
    const sims = ptSimulate(events, [n.day, days]);
    const pathKid = kids(n.id).find((k) => path.has(k.id));

    svg += `<g onclick="ptTravel(${n.id})" style="cursor:pointer"><title>return to this reality</title>`;
    // branching moment
    svg += ptMatrix(x0 + 8, y - M - 10, M, sims[n.day], n.event && n.event.action !== "remove");
    svg += txt(x0 + M + 16, y - 12, n.event ? ptEventLabel(n.event) : `${ptShortDate(0)} · as is`, on ? BLK : "#8a8a8a");
    svg += `<circle cx="${x0}" cy="${y}" r="10" fill="transparent"/>`;
    svg += `<circle cx="${x0}" cy="${y}" r="${isCur ? 4.5 : 3.2}" fill="${on ? BLK : "#fff"}" stroke="${on ? BLK : GRY}" stroke-width="1.2"/>`;
    if (isCur) svg += `<circle cx="${x0}" cy="${y}" r="8" fill="none" stroke="${BLK}"/>`;
    // this reality at the end of the horizon
    const endOn = on && !pathKid;
    svg += `<circle cx="${xEnd}" cy="${y}" r="2.6" fill="#fff" stroke="${endOn ? BLK : GRY}" stroke-width="1.2"/>`;
    svg += ptMatrix(xEnd + 52, y - ME / 2, ME, sims[days], false);
    const count = events.length;
    svg += txt(xEnd + 52 + ME + 10, y - 4, ptShortDate(days - 1), endOn ? BLK : "#8a8a8a");
    svg += txt(xEnd + 52 + ME + 10, y + 10, count === 0 ? "no maintenance" : `${count} event${count > 1 ? "s" : ""}`, "#9a9a9a");
    svg += `</g>`;
  });

  svg += `</svg>`;
  host.innerHTML = svg;
  const n = PT.nodes.length;
  document.getElementById("pt-count").textContent = `${n} ${n === 1 ? "reality" : "realities"}`;
}

function ptDownload() {
  const svg = document.querySelector("#pt-tree svg");
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.querySelectorAll("[onclick]").forEach((g) => { g.removeAttribute("onclick"); g.removeAttribute("style"); });
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "maintenance-possibilities.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") ptClose(); });
window.addEventListener("resize", () => {
  if (document.getElementById("pt-sheet").classList.contains("open")) ptRender();
});
ptReset();

// the run button was bound to the original function at start-up: rebind it
els.runSimulationButton.removeEventListener("click", _ptRunSimulation);
els.runSimulationButton.addEventListener("click", runSimulation);
