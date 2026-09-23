"use strict";

/*
  Temporal Timber / Maintenance — place + time pickers

  where: a pixelated dymaxion (fuller airocean) map drawn as a dot grid.
         land dots are clickable; each carries the latitude/longitude of
         its pixel centre.
  when:  a line spanning the map's width is one year (jan → dec). a
         rectangle on it is the prediction period: its left edge is the
         start day, its width is the span. drag it to move, pull its right
         edge to resize. periods can wrap past december.
*/

const PICK = {
  cols: DYMAXION.cols,
  rows: DYMAXION.rows,
  selected: null,         // [col, row, lat, lon]
  startDoy: null,         // 0-based day of year
  days: 30,
  minDays: 7,
  maxDays: 365,
};

const SVGNS = "http://www.w3.org/2000/svg";
const YEAR_DAYS = 365;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function svgEl(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "n" : "s"} · ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "e" : "w"}`;
}

function doyOf(date) {
  const start = new Date(date.getFullYear(), 0, 1, 12);
  return Math.min(YEAR_DAYS - 1, Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12) - start) / 86400000));
}

function fmtDoy(doy) {
  const d = new Date(2025, 0, 1 + ((doy % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS);
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
}

// the next occurrence of the chosen day of year, from today on
function nextDateForDoy(doy) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  let d = new Date(today.getFullYear(), 0, 1 + doy, 12);
  if (d < today) d = new Date(today.getFullYear() + 1, 0, 1 + doy, 12);
  return d;
}

/* ─── where ───────────────────────────────────────────────────── */
function buildDymaxion() {
  const host = document.getElementById("dymaxion");
  const C = 10; // svg units per pixel
  const W = PICK.cols * C, H = PICK.rows * C;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, host);

  const sea = svgEl("g", { class: "dym-sea" }, svg);
  DYMAXION.sea.forEach(([c, r]) => svgEl("circle", { cx: c * C + C / 2, cy: r * C + C / 2, r: 0.9 }, sea));

  const land = svgEl("g", { class: "dym-land" }, svg);
  const readout = document.getElementById("hoverLocation");
  DYMAXION.land.forEach((px) => {
    const [c, r, lat, lon] = px;
    const g = svgEl("g", { class: "dym-px", tabindex: 0 }, land);
    svgEl("rect", { x: c * C, y: r * C, width: C, height: C, class: "dym-hit" }, g);
    svgEl("circle", { cx: c * C + C / 2, cy: r * C + C / 2, r: 2.3 }, g);
    const pick = () => choosePlace(px, g);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    g.addEventListener("mouseenter", () => { readout.textContent = fmtLatLon(lat, lon); });
  });
  svg.addEventListener("mouseleave", () => {
    readout.innerHTML = "&nbsp;";
  });

  PICK.marker = svgEl("g", { class: "dym-marker", visibility: "hidden" }, svg);
  svgEl("circle", { r: 11 }, PICK.marker);
  svgEl("line", { x1: -20, y1: 0, x2: -13, y2: 0 }, PICK.marker);
  svgEl("line", { x1: 13, y1: 0, x2: 20, y2: 0 }, PICK.marker);
  svgEl("line", { x1: 0, y1: -20, x2: 0, y2: -13 }, PICK.marker);
  svgEl("line", { x1: 0, y1: 13, x2: 0, y2: 20 }, PICK.marker);
  PICK.C = C;
}

function choosePlace(px, g) {
  const [c, r, lat, lon] = px;
  PICK.selected = px;
  document.querySelectorAll(".dym-px.on").forEach((n) => n.classList.remove("on"));
  g.classList.add("on");
  PICK.marker.setAttribute("transform", `translate(${c * PICK.C + PICK.C / 2},${r * PICK.C + PICK.C / 2})`);
  PICK.marker.setAttribute("visibility", "visible");

  state.location = {
    name: fmtLatLon(lat, lon),
    admin1: "",
    country: "",
    latitude: lat,
    longitude: lon,
    timezone: "auto",
  };
  els.selectedLocation.textContent = fmtLatLon(lat, lon);
  unlock(els.stepTime);
  markStale();
}

/* ─── when ────────────────────────────────────────────────────── */
function buildYearStrip() {
  const host = document.getElementById("yearStrip");
  const W = 1000, H = 64, L = 10, R = 990, Y = 34;
  const X = (doy) => L + (doy / YEAR_DAYS) * (R - L);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` }, host);
  PICK.strip = { svg, X, L, R, Y, W };

  svgEl("line", { x1: L, y1: Y, x2: R, y2: Y, class: "ys-line" }, svg);
  for (let w = 0; w <= 52; w += 1) {
    const x = X(w * 7);
    svgEl("line", { x1: x, y1: Y - 3, x2: x, y2: Y + 3, class: "ys-week" }, svg);
  }
  MONTH_START.forEach((d, i) => {
    const x = X(d);
    svgEl("line", { x1: x, y1: Y - 8, x2: x, y2: Y + 8, class: "ys-month" }, svg);
    const t = svgEl("text", { x: x + 3, y: Y + 24, class: "ys-label" }, svg);
    t.textContent = MONTHS[i];
  });
  // today
  const tx = X(doyOf(new Date()));
  svgEl("line", { x1: tx, y1: Y - 14, x2: tx, y2: Y - 9, class: "ys-today" }, svg);
  const tt = svgEl("text", { x: tx, y: Y - 18, class: "ys-label", "text-anchor": "middle" }, svg);
  tt.textContent = "today";

  // selection: up to two rects (the period may wrap into next january)
  PICK.rectA = svgEl("rect", { y: Y - 9, height: 18, class: "ys-sel" }, svg);
  PICK.rectB = svgEl("rect", { y: Y - 9, height: 18, class: "ys-sel" }, svg);
  PICK.handle = svgEl("rect", { y: Y - 12, width: 10, height: 24, class: "ys-handle" }, svg);

  PICK.startDoy = doyOf(new Date());
  renderStrip();

  // interaction
  const toDoy = (evt) => {
    const box = svg.getBoundingClientRect();
    const x = ((evt.clientX - box.left) / box.width) * W;
    return Math.round(clamp((x - L) / (R - L), 0, 1) * YEAR_DAYS);
  };
  let drag = null;
  const onDown = (evt) => {
    const d = toDoy(evt);
    const end = (PICK.startDoy + PICK.days) % YEAR_DAYS;
    const nearEnd = Math.abs(d - end) <= 4 || evt.target === PICK.handle;
    const inside = inSelection(d);
    if (nearEnd) drag = { mode: "resize" };
    else if (inside) drag = { mode: "move", offset: ((d - PICK.startDoy) + YEAR_DAYS) % YEAR_DAYS };
    else { PICK.startDoy = clamp(d, 0, YEAR_DAYS - 1); drag = { mode: "move", offset: 0 }; renderStrip(); }
    svg.setPointerCapture?.(evt.pointerId);
    evt.preventDefault();
  };
  const onMove = (evt) => {
    const d = toDoy(evt);
    if (!drag) {
      const end = (PICK.startDoy + PICK.days) % YEAR_DAYS;
      svg.style.cursor = Math.abs(d - end) <= 4 ? "ew-resize" : inSelection(d) ? "grab" : "pointer";
      return;
    }
    if (drag.mode === "move") {
      PICK.startDoy = ((d - drag.offset) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
    } else {
      let span = ((d - PICK.startDoy) + YEAR_DAYS) % YEAR_DAYS;
      if (span === 0) span = PICK.days > YEAR_DAYS / 2 ? YEAR_DAYS : PICK.minDays;
      PICK.days = clamp(span, PICK.minDays, PICK.maxDays);
    }
    renderStrip();
  };
  const onUp = () => { if (drag) { drag = null; markStale(); } };
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  // keyboard: arrows move, shift+arrows resize
  host.tabIndex = 0;
  host.addEventListener("keydown", (e) => {
    const step = e.altKey ? 1 : 7;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    if (e.shiftKey) PICK.days = clamp(PICK.days + dir * step, PICK.minDays, PICK.maxDays);
    else PICK.startDoy = ((PICK.startDoy + dir * step) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
    e.preventDefault();
    renderStrip();
    markStale();
  });
}

function inSelection(d) {
  const rel = ((d - PICK.startDoy) + YEAR_DAYS) % YEAR_DAYS;
  return rel <= PICK.days;
}

function renderStrip() {
  const { X, R } = PICK.strip;
  const s = PICK.startDoy, e = s + PICK.days;
  if (e <= YEAR_DAYS) {
    PICK.rectA.setAttribute("x", X(s)); PICK.rectA.setAttribute("width", Math.max(1, X(e) - X(s)));
    PICK.rectB.setAttribute("visibility", "hidden");
  } else {
    PICK.rectA.setAttribute("x", X(s)); PICK.rectA.setAttribute("width", R - X(s));
    PICK.rectB.setAttribute("visibility", "visible");
    PICK.rectB.setAttribute("x", X(0)); PICK.rectB.setAttribute("width", Math.max(1, X(e - YEAR_DAYS) - X(0)));
  }
  PICK.handle.setAttribute("x", X(e % YEAR_DAYS === 0 && e > 0 ? YEAR_DAYS : e % YEAR_DAYS) - 5);

  const start = nextDateForDoy(s);
  const weeks = PICK.days / 7;
  document.getElementById("periodReadout").textContent =
    `${fmtDoy(s)} → ${fmtDoy(s + PICK.days - 1)} · ${PICK.days} days` +
    (Number.isInteger(weeks) ? ` · ${weeks} weeks` : ` · ${weeks.toFixed(1)} weeks`) +
    ` · from ${start.getFullYear()}`;

  state.pickedStart = start;
  state.pickedDays = PICK.days;
}

// a new place or period means the loaded weather no longer applies
function markStale() {
  if (!state.dailyEnvironment.length) return;
  setStatus(els.environmentStatus, "place or period changed · load weather again to update");
}

/* ─── surface previews + cell readout ─────────────────────────── */
function drawSmallMatrix(canvas, grid) {
  if (!canvas || !grid) return;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(GRID_SIZE, GRID_SIZE);
  grid.forEach((rgb, i) => img.data.set([Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), 255], i * 4));
  ctx.putImageData(img, 0, 0);
}

function renderCalibrationPreviews() {
  drawSmallMatrix(document.getElementById("calibrationT0"), state.rgbT0);
  drawSmallMatrix(document.getElementById("calibrationT1"), state.rgbT1);
}

const _pkTryDefaults = tryLoadDefaultCalibrationImages;
tryLoadDefaultCalibrationImages = async function () {
  await _pkTryDefaults();
  renderCalibrationPreviews();
};
const _pkUpload = handleCalibrationUpload;
handleCalibrationUpload = async function (which, file) {
  await _pkUpload(which, file);
  renderCalibrationPreviews();
};

(function cellReadout() {
  const canvas = els.resultFigure;
  const out = document.getElementById("cellReadout");
  canvas.addEventListener("mousemove", (e) => {
    if (!state.rgbStates.length) return;
    const box = canvas.getBoundingClientRect();
    const c = clamp(Math.floor(((e.clientX - box.left) / box.width) * GRID_SIZE), 0, GRID_SIZE - 1);
    const r = clamp(Math.floor(((e.clientY - box.top) / box.height) * GRID_SIZE), 0, GRID_SIZE - 1);
    const i = r * GRID_SIZE + c;
    const day = Number(els.daySlider.value);
    const covered = state.coverageStates[day][i] ? " · covered" : "";
    out.textContent = `cell ${c + 1}, ${r + 1} · uv ${state.effectiveUv[day][i].toFixed(0)} uvi·h · moisture ${state.effectiveMoisture[day][i].toFixed(0)} %·h${covered}`;
  });
  canvas.addEventListener("mouseleave", () => { out.innerHTML = "&nbsp;"; });
})();

buildDymaxion();
buildYearStrip();
