
"use strict";

/*
  Temporal Timber / Maintenance — browser prototype

  Flow:
    1. Geocode project location.
    2. Choose horizon.
    3. Fetch same calendar period from previous year.
    4. Convert hourly weather to daily UV + moisture-exposure increments.
    5. Read t-01 / t-02 into 10×10 RGB fields.
    6. Draw coverage patterns.
    7. Timestamp add / remove / replace maintenance events.
    8. Apply local protection to accumulated exposure.
    9. Predict local RGB state.

  Current empirical constants are intentionally aligned with the Python prototype.
*/

const GRID_SIZE = 10;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

const STARTING_TIMBER_MC = 14.0;
const CALIBRATION_UV_DOSE = 120.0;
const WEATHERING_RATE_SCALE = 0.55;

const SUN_PROTECTION_EFFICIENCY = 1.0;
const MOISTURE_PROTECTION_EFFICIENCY = 1.0;

const state = {
  location: null,
  simulationStart: null,
  simulationEnd: null,
  historicalStart: null,
  historicalEnd: null,

  dailyEnvironment: [],

  rgbT0: null,
  rgbT1: null,

  patterns: new Map(),
  draftPattern: new Array(CELL_COUNT).fill(0),
  events: [],

  coverageStates: [],
  activePatternStates: [],
  effectiveUv: [],
  effectiveMoisture: [],
  rgbStates: [],
};

const $ = (id) => document.getElementById(id);

const els = {
  locationInput: $("locationInput"),
  searchLocationButton: $("searchLocationButton"),
  locationResults: $("locationResults"),
  selectedLocation: $("selectedLocation"),

  stepTime: $("step-time"),
  loadEnvironmentButton: $("loadEnvironmentButton"),
  environmentStatus: $("environmentStatus"),
  environmentMetrics: $("environmentMetrics"),
  predictionPeriodMetric: $("predictionPeriodMetric"),
  historicalPeriodMetric: $("historicalPeriodMetric"),
  uvMetric: $("uvMetric"),
  moistureMetric: $("moistureMetric"),

  stepCalibration: $("step-calibration"),
  imageT0Input: $("imageT0Input"),
  imageT1Input: $("imageT1Input"),
  calibrationStatus: $("calibrationStatus"),

  stepMaintenance: $("step-maintenance"),
  patternGrid: $("patternGrid"),
  clearPatternButton: $("clearPatternButton"),
  patternNameInput: $("patternNameInput"),
  savePatternButton: $("savePatternButton"),
  savedPatternList: $("savedPatternList"),

  eventDateInput: $("eventDateInput"),
  eventActionInput: $("eventActionInput"),
  eventPatternInput: $("eventPatternInput"),
  eventPatternField: $("eventPatternField"),
  addEventButton: $("addEventButton"),
  maintenanceLogBody: $("maintenanceLogBody"),
  runSimulationButton: $("runSimulationButton"),

  stepResults: $("step-results"),
  daySlider: $("daySlider"),
  currentDateLabel: $("currentDateLabel"),
  currentDayLabel: $("currentDayLabel"),
  resultGrid: $("resultGrid"),
  activePatternMetric: $("activePatternMetric"),
  coveredCellsMetric: $("coveredCellsMetric"),
  effectiveUvMetric: $("effectiveUvMetric"),
  effectiveMoistureMetric: $("effectiveMoistureMetric"),
  simulationStatus: $("simulationStatus"),
};

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = "status";
  if (type) element.classList.add(type);
}

function unlock(element) {
  element.classList.remove("locked");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseIsoDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function addMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getDate();

  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();

  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function shiftOneYearBack(date) {
  const result = new Date(date);
  const month = result.getMonth();
  result.setFullYear(result.getFullYear() - 1);

  // Feb 29 -> Feb 28
  if (result.getMonth() !== month) {
    result.setDate(0);
  }

  return result;
}

function localTodayForTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) => Number(parts.find((p) => p.type === type).value);

  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    12,
    0,
    0
  );
}

function dateDifferenceInDays(start, end) {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86400000);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function selectedHorizonMonths() {
  return Number(
    document.querySelector('input[name="horizon"]:checked').value
  );
}

function makePeriod(start, months) {
  const nextBoundary = addMonths(start, months);
  return {
    start,
    end: addDays(nextBoundary, -1),
  };
}

async function searchLocation() {
  const query = els.locationInput.value.trim();

  if (query.length < 2) {
    els.locationResults.textContent = "Enter at least two characters.";
    return;
  }

  els.locationResults.textContent = "Searching…";

  try {
    const params = new URLSearchParams({
      name: query,
      count: "6",
      language: "en",
      format: "json",
    });

    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`
    );

    if (!response.ok) {
      throw new Error(`Location search returned ${response.status}.`);
    }

    const data = await response.json();
    renderLocationResults(data.results || []);
  } catch (error) {
    els.locationResults.textContent = `Location search failed: ${error.message}`;
  }
}

function renderLocationResults(results) {
  els.locationResults.innerHTML = "";

  if (!results.length) {
    els.locationResults.textContent = "No matching locations found.";
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "location-option";

    const place = [
      result.name,
      result.admin1,
      result.country,
    ].filter(Boolean).join(", ");

    button.innerHTML = `
      <span>${escapeHtml(place)}</span>
      <span>${escapeHtml(result.timezone || "")}</span>
    `;

    button.addEventListener("click", () => selectLocation(result));
    els.locationResults.appendChild(button);
  }
}

function selectLocation(result) {
  state.location = {
    name: result.name,
    admin1: result.admin1 || "",
    country: result.country || "",
    latitude: Number(result.latitude),
    longitude: Number(result.longitude),
    timezone: result.timezone || "auto",
  };

  const label = [
    state.location.name,
    state.location.admin1,
    state.location.country,
  ].filter(Boolean).join(", ");

  els.selectedLocation.textContent =
    `Selected: ${label} · ${state.location.latitude.toFixed(4)}, ` +
    `${state.location.longitude.toFixed(4)} · ${state.location.timezone}`;

  els.locationResults.innerHTML = "";
  unlock(els.stepTime);
}

async function loadEnvironment() {
  if (!state.location) return;

  setStatus(
    els.environmentStatus,
    "Loading historical environmental analogue…"
  );

  const horizonMonths = selectedHorizonMonths();

  state.simulationStart = localTodayForTimeZone(state.location.timezone);

  const simulationPeriod = makePeriod(
    state.simulationStart,
    horizonMonths
  );

  state.simulationEnd = simulationPeriod.end;

  state.historicalStart = shiftOneYearBack(state.simulationStart);

  const historicalPeriod = makePeriod(
    state.historicalStart,
    horizonMonths
  );

  state.historicalEnd = historicalPeriod.end;

  try {
    const params = new URLSearchParams({
      latitude: String(state.location.latitude),
      longitude: String(state.location.longitude),
      start_date: isoDate(state.historicalStart),
      end_date: isoDate(state.historicalEnd),
      hourly: [
        "uv_index",
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
      ].join(","),
      timezone: state.location.timezone,
    });

    const response = await fetch(
      `https://historical-forecast-api.open-meteo.com/v1/forecast?${params}`
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Weather request returned ${response.status}. ${body.slice(0, 160)}`
      );
    }

    const data = await response.json();

    if (!data.hourly || !data.hourly.time) {
      throw new Error("Weather response did not contain hourly data.");
    }

    state.dailyEnvironment = hourlyToDaily(data.hourly);

    if (!state.dailyEnvironment.length) {
      throw new Error("No daily environmental data could be calculated.");
    }

    renderEnvironmentSummary();
    configureEventDates();

    setStatus(
      els.environmentStatus,
      `Loaded ${state.dailyEnvironment.length} daily exposure steps.`,
      "success"
    );

    unlock(els.stepCalibration);
    unlock(els.stepMaintenance);

    await tryLoadDefaultCalibrationImages();

  } catch (error) {
    setStatus(
      els.environmentStatus,
      `Could not load weather: ${error.message}`,
      "error"
    );
  }
}

function hourlyToDaily(hourly) {
  const days = new Map();

  for (let i = 0; i < hourly.time.length; i += 1) {
    const dateKey = String(hourly.time[i]).slice(0, 10);

    if (!days.has(dateKey)) {
      days.set(dateKey, {
        historicalDate: dateKey,
        uvIncrement: 0,
        moistureIncrement: 0,
        precipitation: 0,
        emcSum: 0,
        emcCount: 0,
      });
    }

    const day = days.get(dateKey);

    const uv = Math.max(0, Number(hourly.uv_index?.[i]) || 0);
    const temperature = Number(hourly.temperature_2m?.[i]);
    const rh = Number(hourly.relative_humidity_2m?.[i]);
    const precipitation = Math.max(
      0,
      Number(hourly.precipitation?.[i]) || 0
    );

    day.uvIncrement += uv;
    day.precipitation += precipitation;

    if (Number.isFinite(temperature) && Number.isFinite(rh)) {
      const emc = woodEmc(temperature, rh);
      const moisturePressure = Math.max(
        emc - STARTING_TIMBER_MC,
        0
      );

      day.moistureIncrement += moisturePressure;
      day.emcSum += emc;
      day.emcCount += 1;
    }
  }

  const values = [...days.values()];

  return values.map((day, index) => ({
    ...day,
    simulationDate: isoDate(addDays(state.simulationStart, index)),
    meanEmc: day.emcCount ? day.emcSum / day.emcCount : 0,
  }));
}

function woodEmc(temperatureC, relativeHumidityPercent) {
  const T = Number(temperatureC);
  const h = clamp(Number(relativeHumidityPercent) / 100, 0, 0.999);

  const W = 349 + 1.29 * T + 0.0135 * T * T;
  const K = 0.805 + 0.000736 * T - 0.00000273 * T * T;
  const K1 = 6.27 - 0.00938 * T - 0.000303 * T * T;
  const K2 = 1.91 + 0.0407 * T - 0.000293 * T * T;

  const term1 = (K * h) / (1 - K * h);

  const term2 =
    (
      K1 * K * h +
      2 * K1 * K2 * K * K * h * h
    ) /
    (
      1 +
      K1 * K * h +
      K1 * K2 * K * K * h * h
    );

  return (1800 / W) * (term1 + term2);
}

function renderEnvironmentSummary() {
  const totalUv = state.dailyEnvironment.reduce(
    (sum, day) => sum + day.uvIncrement,
    0
  );

  const totalMoisture = state.dailyEnvironment.reduce(
    (sum, day) => sum + day.moistureIncrement,
    0
  );

  els.predictionPeriodMetric.textContent =
    `${formatDate(state.simulationStart)} → ${formatDate(state.simulationEnd)}`;

  els.historicalPeriodMetric.textContent =
    `${formatDate(state.historicalStart)} → ${formatDate(state.historicalEnd)}`;

  els.uvMetric.textContent = `${totalUv.toFixed(1)} UVI·h`;
  els.moistureMetric.textContent = `${totalMoisture.toFixed(1)} %·h`;

  els.environmentMetrics.classList.remove("hidden");
}

function configureEventDates() {
  els.eventDateInput.min = isoDate(state.simulationStart);
  els.eventDateInput.max = isoDate(state.simulationEnd);
  els.eventDateInput.value = isoDate(state.simulationStart);
}

async function tryLoadDefaultCalibrationImages() {
  const paths = [
    "./assets/t-01.png",
    "./assets/t-02.png",
  ];

  try {
    const [rgb0, rgb1] = await Promise.all(
      paths.map((path) => imageUrlToRgbGrid(path))
    );

    state.rgbT0 = rgb0;
    state.rgbT1 = rgb1;

    setStatus(
      els.calibrationStatus,
      "Loaded assets/t-01.png and assets/t-02.png automatically.",
      "success"
    );
  } catch {
    setStatus(
      els.calibrationStatus,
      "Add t-01.png and t-02.png to assets/, or choose both images above."
    );
  }
}

async function handleCalibrationUpload(which, file) {
  if (!file) return;

  try {
    const url = URL.createObjectURL(file);
    const grid = await imageUrlToRgbGrid(url);
    URL.revokeObjectURL(url);

    if (which === "t0") {
      state.rgbT0 = grid;
    } else {
      state.rgbT1 = grid;
    }

    if (state.rgbT0 && state.rgbT1) {
      setStatus(
        els.calibrationStatus,
        "Both RGB calibration images are ready.",
        "success"
      );
    } else {
      setStatus(
        els.calibrationStatus,
        "One calibration image loaded. Add the second image."
      );
    }
  } catch (error) {
    setStatus(
      els.calibrationStatus,
      `Could not read image: ${error.message}`,
      "error"
    );
  }
}

function imageUrlToRgbGrid(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        ctx.drawImage(image, 0, 0);

        const grid = new Array(CELL_COUNT);

        for (let row = 0; row < GRID_SIZE; row += 1) {
          for (let col = 0; col < GRID_SIZE; col += 1) {
            const x0 = Math.floor(col * canvas.width / GRID_SIZE);
            const x1 = Math.floor((col + 1) * canvas.width / GRID_SIZE);
            const y0 = Math.floor(row * canvas.height / GRID_SIZE);
            const y1 = Math.floor((row + 1) * canvas.height / GRID_SIZE);

            const width = Math.max(1, x1 - x0);
            const height = Math.max(1, y1 - y0);

            const pixels = ctx.getImageData(
              x0,
              y0,
              width,
              height
            ).data;

            let r = 0;
            let g = 0;
            let b = 0;
            const count = pixels.length / 4;

            for (let i = 0; i < pixels.length; i += 4) {
              r += pixels[i];
              g += pixels[i + 1];
              b += pixels[i + 2];
            }

            grid[row * GRID_SIZE + col] = [
              r / count,
              g / count,
              b / count,
            ];
          }
        }

        resolve(grid);
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(
      new Error(`Image could not be loaded from ${url}`)
    );

    image.src = url;
  });
}

function buildPatternGrid() {
  els.patternGrid.innerHTML = "";

  let dragging = false;
  let paintValue = 1;

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "pixel-cell";
    cell.dataset.index = String(index);
    cell.setAttribute("aria-label", `Coverage cell ${index + 1}`);

    const update = () => {
      cell.classList.toggle(
        "active",
        Boolean(state.draftPattern[index])
      );
    };

    cell.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      dragging = true;
      paintValue = state.draftPattern[index] ? 0 : 1;
      state.draftPattern[index] = paintValue;
      update();
      cell.setPointerCapture?.(event.pointerId);
    });

    cell.addEventListener("pointerenter", () => {
      if (!dragging) return;
      state.draftPattern[index] = paintValue;
      update();
    });

    cell.addEventListener("click", (event) => {
      // Keyboard activation still works.
      if (event.detail === 0) {
        state.draftPattern[index] = state.draftPattern[index] ? 0 : 1;
        update();
      }
    });

    window.addEventListener("pointerup", () => {
      dragging = false;
    }, { passive: true });

    els.patternGrid.appendChild(cell);
  }
}

function renderDraftPattern() {
  [...els.patternGrid.children].forEach((cell, index) => {
    cell.classList.toggle(
      "active",
      Boolean(state.draftPattern[index])
    );
  });
}

function clearPattern() {
  state.draftPattern.fill(0);
  renderDraftPattern();
}

function savePattern() {
  const name = els.patternNameInput.value.trim();

  if (!name) {
    alert("Give the pattern a name first.");
    return;
  }

  if (!state.draftPattern.some(Boolean)) {
    alert("Draw at least one covered cell.");
    return;
  }

  state.patterns.set(
    name,
    [...state.draftPattern]
  );

  renderPatternLists();

  els.patternNameInput.value =
    `Pattern ${String.fromCharCode(65 + state.patterns.size)}`;
}

function renderPatternLists() {
  els.savedPatternList.innerHTML = "";
  els.eventPatternInput.innerHTML = "";

  for (const [name] of state.patterns) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = name;

    chip.addEventListener("click", () => {
      state.draftPattern = [...state.patterns.get(name)];
      els.patternNameInput.value = name;
      renderDraftPattern();
    });

    els.savedPatternList.appendChild(chip);

    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.eventPatternInput.appendChild(option);
  }

  if (!state.patterns.size) {
    els.savedPatternList.textContent = "No saved patterns yet.";
  }
}

function syncEventActionUi() {
  const remove = els.eventActionInput.value === "remove";
  els.eventPatternField.classList.toggle("hidden", remove);
}

function addMaintenanceEvent() {
  if (!state.simulationStart || !state.simulationEnd) {
    alert("Load the environmental scenario first.");
    return;
  }

  const date = els.eventDateInput.value;
  const action = els.eventActionInput.value;

  if (!date) {
    alert("Choose an event date.");
    return;
  }

  let pattern = null;

  if (action !== "remove") {
    pattern = els.eventPatternInput.value;

    if (!pattern || !state.patterns.has(pattern)) {
      alert("Save and select a coverage pattern first.");
      return;
    }
  }

  const eventDate = parseIsoDate(date);
  const dayIndex = dateDifferenceInDays(
    state.simulationStart,
    eventDate
  );

  if (
    dayIndex < 0 ||
    dayIndex >= state.dailyEnvironment.length
  ) {
    alert("The event date must fall inside the prediction period.");
    return;
  }

  state.events.push({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    date,
    dayIndex,
    action,
    pattern,
  });

  state.events.sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) {
      return a.dayIndex - b.dayIndex;
    }
    return a.id.localeCompare(b.id);
  });

  renderMaintenanceLog();
}

function renderMaintenanceLog() {
  els.maintenanceLogBody.innerHTML = "";

  if (!state.events.length) {
    els.maintenanceLogBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">No maintenance events yet.</td>
      </tr>
    `;
    return;
  }

  for (const event of state.events) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHtml(event.date)}</td>
      <td>${escapeHtml(actionLabel(event.action))}</td>
      <td>${escapeHtml(event.pattern || "—")}</td>
      <td>
        <button class="delete-event" type="button">delete</button>
      </td>
    `;

    row.querySelector(".delete-event").addEventListener(
      "click",
      () => {
        state.events = state.events.filter(
          (item) => item.id !== event.id
        );
        renderMaintenanceLog();
      }
    );

    els.maintenanceLogBody.appendChild(row);
  }
}

function actionLabel(action) {
  if (action === "add") return "Add pattern";
  if (action === "replace") return "Replace pattern";
  return "Remove pattern";
}

function buildCoverageTimeline() {
  const days = state.dailyEnvironment.length;

  const coverageStates = new Array(days + 1);
  const activePatternStates = new Array(days + 1);

  let activePattern = null;

  const eventsByDay = new Map();

  for (const event of state.events) {
    if (!eventsByDay.has(event.dayIndex)) {
      eventsByDay.set(event.dayIndex, []);
    }
    eventsByDay.get(event.dayIndex).push(event);
  }

  for (let day = 0; day <= days; day += 1) {
    const events = eventsByDay.get(day) || [];

    for (const event of events) {
      if (event.action === "remove") {
        activePattern = null;
      } else {
        activePattern = event.pattern;
      }
    }

    activePatternStates[day] = activePattern;

    coverageStates[day] = activePattern
      ? [...state.patterns.get(activePattern)]
      : new Array(CELL_COUNT).fill(0);
  }

  return {
    coverageStates,
    activePatternStates,
  };
}

function runSimulation() {
  if (!state.dailyEnvironment.length) {
    alert("Load environmental data first.");
    return;
  }

  if (!state.rgbT0 || !state.rgbT1) {
    alert(
      "The RGB model needs both t-01 and t-02. " +
      "Add them to assets/ or choose them in step 03."
    );
    return;
  }

  const {
    coverageStates,
    activePatternStates,
  } = buildCoverageTimeline();

  state.coverageStates = coverageStates;
  state.activePatternStates = activePatternStates;

  const days = state.dailyEnvironment.length;

  state.effectiveUv = new Array(days + 1);
  state.effectiveMoisture = new Array(days + 1);

  state.effectiveUv[0] = new Array(CELL_COUNT).fill(0);
  state.effectiveMoisture[0] = new Array(CELL_COUNT).fill(0);

  for (let day = 1; day <= days; day += 1) {
    const environment = state.dailyEnvironment[day - 1];
    const coverage = coverageStates[day - 1];

    const uv = new Array(CELL_COUNT);
    const moisture = new Array(CELL_COUNT);

    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const coverageValue = coverage[cell];

      const uvMultiplier =
        1 -
        coverageValue *
        SUN_PROTECTION_EFFICIENCY;

      const moistureMultiplier =
        1 -
        coverageValue *
        MOISTURE_PROTECTION_EFFICIENCY;

      uv[cell] =
        state.effectiveUv[day - 1][cell] +
        environment.uvIncrement * uvMultiplier;

      moisture[cell] =
        state.effectiveMoisture[day - 1][cell] +
        environment.moistureIncrement * moistureMultiplier;
    }

    state.effectiveUv[day] = uv;
    state.effectiveMoisture[day] = moisture;
  }

  const rgbRate = state.rgbT0.map((rgb0, cell) => {
    const rgb1 = state.rgbT1[cell];

    return [
      (rgb1[0] - rgb0[0]) / CALIBRATION_UV_DOSE,
      (rgb1[1] - rgb0[1]) / CALIBRATION_UV_DOSE,
      (rgb1[2] - rgb0[2]) / CALIBRATION_UV_DOSE,
    ];
  });

  state.rgbStates = new Array(days + 1);

  for (let day = 0; day <= days; day += 1) {
    state.rgbStates[day] = state.rgbT1.map(
      (rgbToday, cell) => {
        const localUv = state.effectiveUv[day][cell];
        const rate = rgbRate[cell];

        return [
          clamp(
            rgbToday[0] +
            rate[0] *
            localUv *
            WEATHERING_RATE_SCALE,
            0,
            255
          ),
          clamp(
            rgbToday[1] +
            rate[1] *
            localUv *
            WEATHERING_RATE_SCALE,
            0,
            255
          ),
          clamp(
            rgbToday[2] +
            rate[2] *
            localUv *
            WEATHERING_RATE_SCALE,
            0,
            255
          ),
        ];
      }
    );
  }

  els.daySlider.max = String(days);
  els.daySlider.value = "0";

  unlock(els.stepResults);
  buildResultGrid();
  renderSimulationDay(0);

  setStatus(
    els.simulationStatus,
    `Simulation complete: ${days} daily exposure steps, ` +
    `${state.events.length} maintenance event(s).`,
    "success"
  );

  els.stepResults.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function buildResultGrid() {
  els.resultGrid.innerHTML = "";

  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const element = document.createElement("div");
    element.className = "pixel-cell";
    els.resultGrid.appendChild(element);
  }
}

function renderSimulationDay(day) {
  if (!state.rgbStates.length) return;

  day = clamp(
    Number(day),
    0,
    state.dailyEnvironment.length
  );

  const rgb = state.rgbStates[day];
  const coverage = state.coverageStates[day];
  const activePattern = state.activePatternStates[day];

  [...els.resultGrid.children].forEach(
    (element, cell) => {
      const [r, g, b] = rgb[cell];

      element.style.backgroundColor =
        `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

      element.classList.toggle(
        "covered",
        Boolean(coverage[cell])
      );
    }
  );

  const date =
    day === 0
      ? state.simulationStart
      : parseIsoDate(
          state.dailyEnvironment[
            Math.min(day - 1, state.dailyEnvironment.length - 1)
          ].simulationDate
        );

  els.currentDateLabel.textContent = formatDate(date);
  els.currentDayLabel.textContent =
    day === 0
      ? "t0"
      : `day ${day} / ${state.dailyEnvironment.length}`;

  els.activePatternMetric.textContent =
    activePattern || "None";

  els.coveredCellsMetric.textContent =
    `${coverage.filter(Boolean).length} / 100`;

  const meanUv = mean(state.effectiveUv[day]);
  const meanMoisture = mean(state.effectiveMoisture[day]);

  els.effectiveUvMetric.textContent =
    `${meanUv.toFixed(1)} UVI·h`;

  els.effectiveMoistureMetric.textContent =
    `${meanMoisture.toFixed(1)} %·h`;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initializeDemoPatterns() {
  // Reproducible geometric placeholders.
  const patternA = new Array(CELL_COUNT).fill(0);
  const patternB = new Array(CELL_COUNT).fill(0);
  const patternC = new Array(CELL_COUNT).fill(0);

  for (let row = 1; row <= 4; row += 1) {
    for (let col = 1; col <= 3; col += 1) {
      patternA[row * GRID_SIZE + col] = 1;
    }
  }
  for (let row = 5; row <= 7; row += 1) {
    for (let col = 6; col <= 8; col += 1) {
      patternA[row * GRID_SIZE + col] = 1;
    }
  }

  for (let row = 2; row <= 7; row += 1) {
    patternB[row * GRID_SIZE + 4] = 1;
    patternB[row * GRID_SIZE + 5] = 1;
  }
  for (let col = 2; col <= 7; col += 1) {
    patternB[4 * GRID_SIZE + col] = 1;
    patternB[5 * GRID_SIZE + col] = 1;
  }

  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      if ((row + col) % 4 === 0) {
        patternC[row * GRID_SIZE + col] = 1;
      }
    }
  }

  state.patterns.set("Pattern A", patternA);
  state.patterns.set("Pattern B", patternB);
  state.patterns.set("Pattern C", patternC);

  state.draftPattern = [...patternA];

  renderPatternLists();
  renderDraftPattern();
}

function bindEvents() {
  els.searchLocationButton.addEventListener(
    "click",
    searchLocation
  );

  els.locationInput.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter") {
        searchLocation();
      }
    }
  );

  els.loadEnvironmentButton.addEventListener(
    "click",
    loadEnvironment
  );

  els.imageT0Input.addEventListener(
    "change",
    () => handleCalibrationUpload(
      "t0",
      els.imageT0Input.files[0]
    )
  );

  els.imageT1Input.addEventListener(
    "change",
    () => handleCalibrationUpload(
      "t1",
      els.imageT1Input.files[0]
    )
  );

  els.clearPatternButton.addEventListener(
    "click",
    clearPattern
  );

  els.savePatternButton.addEventListener(
    "click",
    savePattern
  );

  els.eventActionInput.addEventListener(
    "change",
    syncEventActionUi
  );

  els.addEventButton.addEventListener(
    "click",
    addMaintenanceEvent
  );

  els.runSimulationButton.addEventListener(
    "click",
    runSimulation
  );

  els.daySlider.addEventListener(
    "input",
    () => renderSimulationDay(
      Number(els.daySlider.value)
    )
  );
}

function init() {
  buildPatternGrid();
  initializeDemoPatterns();
  syncEventActionUi();
  bindEvents();
}

init();
