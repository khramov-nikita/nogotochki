import { ApiError, createHold, deleteHold, getAvailability, getHold, getServices } from "./api.js";
import { renderStepper } from "./booking-stepper.js";
import {
  addDaysYmd,
  escapeHtml,
  formatCountdown,
  formatDayMonth,
  formatDurationMinutes,
  formatLocalHm,
  formatMonthTitle,
  todayYmd,
  ymdFromInstant,
} from "./format.js";
import { loadDraft, saveDraft } from "./store.js";

const HORIZON_DAYS = 56;
const WEEKDAYS_MON = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const INTRO_DEFAULT =
  "Выберите день и свободное время под длительность визита{duration}. Слот резервируется на ограниченное время. Предоплату принимает студия, на сайте оплаты нет.";
const INTRO_EMPTY =
  "На выбранную дату свободных окон нет. Можно выбрать другой день или вернуться к мастеру. Предоплату принимает студия, на сайте оплаты нет.";

const state = {
  masterId: null,
  serviceIds: [],
  viewYear: 0,
  viewMonth: 0,
  selectedYmd: "",
  cache: new Map(),
  slotsStatus: "loading",
  slots: [],
  durationMinutes: null,
  selectedStartsAt: null,
  selectedEndsAt: null,
  hold: null,
  nearest: null,
  slotError: "",
  monthToken: 0,
  dayToken: 0,
  holdRequest: 0,
  timerId: null,
};

function hasMainService(services, serviceIds) {
  const selected = new Set(serviceIds || []);
  return services.some((row) => selected.has(row.id) && row.is_bookable && !row.is_addon);
}

function horizonEnd() {
  return addDaysYmd(todayYmd(), HORIZON_DAYS);
}

function parseYmd(ymd) {
  const [year, month, day] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  return { year, month, day };
}

function weekdayMonIndex(ymd) {
  const { year, month, day } = parseYmd(ymd);
  const utcDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (utcDay + 6) % 7;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function ymdInMonth(year, monthIndex, day) {
  const month = String(monthIndex + 1).padStart(2, "0");
  return `${year}-${month}-${String(day).padStart(2, "0")}`;
}

function isInHorizon(ymd) {
  const today = todayYmd();
  return ymd >= today && ymd <= horizonEnd();
}

function slotLabel(slot) {
  return slot.starts_local || formatLocalHm(slot.starts_at);
}

function holdIsLive(hold) {
  if (!hold?.expires_at) {
    return false;
  }
  return new Date(hold.expires_at).getTime() > Date.now();
}

function errorEl() {
  return document.getElementById("datetime-error");
}

function setPageError(message) {
  errorEl().textContent = message || "";
}

function currentHoldToken() {
  return state.hold?.hold_token || loadDraft().holdToken || null;
}

async function fetchDay(ymd) {
  return getAvailability(state.masterId, {
    date: ymd,
    serviceIds: state.serviceIds,
    excludeHoldToken: currentHoldToken(),
  });
}

function rememberDuration(data) {
  if (data?.duration_minutes != null) {
    state.durationMinutes = data.duration_minutes;
  }
}

function updateIntro(empty) {
  const intro = document.getElementById("datetime-intro");
  if (empty) {
    intro.textContent = INTRO_EMPTY;
    return;
  }
  const duration = formatDurationMinutes(state.durationMinutes);
  intro.textContent = INTRO_DEFAULT.replace("{duration}", duration ? ` — ${duration}` : "");
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function syncNext() {
  const nextBtn = document.getElementById("next-btn");
  const nextHint = document.getElementById("next-hint");
  const live = holdIsLive(state.hold);
  nextBtn.disabled = !live;
  nextHint.textContent = live ? "" : "Выберите время";
}

async function dropHold() {
  const token = currentHoldToken();
  stopTimer();
  state.hold = null;
  saveDraft({ holdToken: null, startsAt: null });
  if (!token) {
    return;
  }
  try {
    await deleteHold(token);
  } catch {
    /* истёкший или чужой токен не блокирует смену дня */
  }
}

function startTimer() {
  stopTimer();
  const timer = document.getElementById("hold-timer");
  const value = document.getElementById("timer-value");
  if (!timer || !value || !holdIsLive(state.hold)) {
    timer?.setAttribute("hidden", "");
    syncNext();
    return;
  }
  timer.removeAttribute("hidden");
  const tick = () => {
    if (!holdIsLive(state.hold)) {
      stopTimer();
      state.hold = null;
      state.selectedStartsAt = null;
      state.selectedEndsAt = null;
      saveDraft({ holdToken: null, startsAt: null });
      timer.setAttribute("hidden", "");
      renderSlots();
      syncNext();
      return;
    }
    value.textContent = formatCountdown(state.hold.expires_at);
  };
  tick();
  state.timerId = setInterval(tick, 1000);
  syncNext();
}

function applyHold(hold) {
  state.hold = hold;
  state.selectedStartsAt = hold.starts_at;
  state.selectedEndsAt = hold.ends_at;
  if (hold.duration_minutes != null) {
    state.durationMinutes = hold.duration_minutes;
  }
  saveDraft({
    date: state.selectedYmd,
    startsAt: hold.starts_at,
    holdToken: hold.hold_token,
  });
  startTimer();
}

function monthBounds() {
  const today = todayYmd();
  const end = horizonEnd();
  const prevMonth = state.viewMonth === 0 ? 11 : state.viewMonth - 1;
  const prevYear = state.viewMonth === 0 ? state.viewYear - 1 : state.viewYear;
  const prevLast = ymdInMonth(prevYear, prevMonth, daysInMonth(prevYear, prevMonth));
  const nextFirst = ymdInMonth(
    state.viewMonth === 11 ? state.viewYear + 1 : state.viewYear,
    state.viewMonth === 11 ? 0 : state.viewMonth + 1,
    1,
  );
  return {
    canPrev: prevLast >= today,
    canNext: nextFirst <= end,
  };
}

function renderCalendar() {
  const root = document.getElementById("calendar");
  const grid = document.getElementById("calendar-grid");
  const title = document.getElementById("month-title");
  const prev = document.getElementById("month-prev");
  const next = document.getElementById("month-next");
  root.hidden = false;
  title.textContent = formatMonthTitle(state.viewYear, state.viewMonth);

  const { canPrev, canNext } = monthBounds();
  prev.disabled = !canPrev;
  next.disabled = !canNext;

  const firstYmd = ymdInMonth(state.viewYear, state.viewMonth, 1);
  const pad = weekdayMonIndex(firstYmd);
  const count = daysInMonth(state.viewYear, state.viewMonth);
  const cells = [];

  for (let i = 0; i < pad; i += 1) {
    cells.push(`<div class="cal-day cal-day--pad" aria-hidden="true"></div>`);
  }

  for (let day = 1; day <= count; day += 1) {
    const ymd = ymdInMonth(state.viewYear, state.viewMonth, day);
    const cached = state.cache.get(ymd);
    const available = isInHorizon(ymd) && Boolean(cached?.slots?.length);
    const selected = ymd === state.selectedYmd;
    const classes = ["cal-day"];
    if (selected) {
      classes.push("cal-day--selected");
    } else if (!available) {
      classes.push("cal-day--unavailable");
    }
    const disabled = available ? "" : "disabled";
    const label = selected ? `Выбран ${day} ${WEEKDAYS_MON[weekdayMonIndex(ymd)]}` : String(day);
    cells.push(
      `<button class="${classes.join(" ")}" type="button" data-date="${ymd}" ${disabled} aria-pressed="${selected}" aria-label="${escapeHtml(label)}">${day}</button>`,
    );
  }

  grid.innerHTML = cells.join("");
}

function renderSlots() {
  const root = document.getElementById("slots-block");
  const emptyDay = state.slotsStatus === "ready" && state.slots.length === 0;
  updateIntro(emptyDay);

  if (state.slotsStatus === "loading") {
    root.innerHTML = `<div class="booking-slots-loading" role="status" aria-live="polite">
      <span class="booking-spinner" aria-hidden="true"></span>
    </div>`;
    return;
  }

  if (emptyDay) {
    const nearest = state.nearest;
    const nearestText = nearest
      ? `Ближайшее окно — ${formatDayMonth(nearest.ymd)}, ${escapeHtml(slotLabel(nearest.slot))}`
      : "";
    const otherDateDisabled = nearest ? "" : "disabled";
    root.innerHTML = `<div class="booking-empty">
      <h2 class="heading-3">Нет свободного времени</h2>
      <p class="body-medium">У этого мастера на выбранную дату окон нет. Выберите другую дату или мастера.</p>
      <p class="meta booking-empty-nearest" ${nearest ? "" : "hidden"}>${nearestText}</p>
      <div class="booking-empty-actions">
        <button class="button button--primary button--large" type="button" id="other-date-btn" ${otherDateDisabled}>Другая дата</button>
        <a class="button button--ghost button--large" href="booking-master.html">Другой мастер</a>
      </div>
    </div>`;
    return;
  }

  const chips = state.slots
    .map((slot) => {
      const selected = slot.starts_at === state.selectedStartsAt;
      const label = slotLabel(slot);
      return `<button class="time-slot${selected ? " time-slot--selected" : ""}" type="button" data-starts-at="${escapeHtml(slot.starts_at)}" data-ends-at="${escapeHtml(slot.ends_at || "")}">${escapeHtml(label)}</button>`;
    })
    .join("");

  const until = state.selectedEndsAt ? `Визит до ${formatLocalHm(state.selectedEndsAt)}` : "";
  const live = holdIsLive(state.hold);
  const countdown = live ? formatCountdown(state.hold.expires_at) : "00:00";

  root.innerHTML = `<p class="label-caps">Свободное время</p>
    <div class="booking-slots-grid">${chips}</div>
    <p class="meta booking-visit-until" ${until ? "" : "hidden"}>${escapeHtml(until)}</p>
    <p class="error" id="slot-error">${escapeHtml(state.slotError)}</p>
    <div class="booking-timer" id="hold-timer" ${live ? "" : "hidden"}>
      <span class="icon icon--clock" aria-hidden="true"></span>
      <p class="meta">Слот зарезервирован  ·  <span id="timer-value">${countdown}</span></p>
    </div>`;

  if (live) {
    startTimer();
  }
}

async function findNearest(afterYmd) {
  const end = horizonEnd();
  let cursor = addDaysYmd(afterYmd, 1);
  while (cursor <= end) {
    let data = state.cache.get(cursor);
    if (!data) {
      try {
        data = await fetchDay(cursor);
        state.cache.set(cursor, data);
        rememberDuration(data);
      } catch {
        data = { slots: [] };
        state.cache.set(cursor, data);
      }
    }
    if (data.slots?.length) {
      return { ymd: cursor, slot: data.slots[0] };
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return null;
}

function slotStillPresent(startsAt, slots) {
  return Boolean(startsAt) && slots.some((slot) => slot.starts_at === startsAt);
}

async function loadSelectedDay({ spinner = true } = {}) {
  const token = ++state.dayToken;
  const ymd = state.selectedYmd;
  if (spinner) {
    state.slotsStatus = "loading";
    state.nearest = null;
    renderSlots();
  }
  try {
    const data = await fetchDay(ymd);
    if (token !== state.dayToken) {
      return;
    }
    state.cache.set(ymd, data);
    rememberDuration(data);
    state.slots = data.slots || [];
    state.slotsStatus = "ready";
    if (!slotStillPresent(state.selectedStartsAt, state.slots)) {
      state.selectedStartsAt = null;
      state.selectedEndsAt = null;
      if (state.hold) {
        await dropHold();
      }
    }
    if (!state.slots.length) {
      state.nearest = await findNearest(ymd);
      if (token !== state.dayToken) {
        return;
      }
    } else {
      state.nearest = null;
    }
    renderCalendar();
    renderSlots();
    syncNext();
  } catch (error) {
    if (token !== state.dayToken) {
      return;
    }
    state.slotsStatus = "ready";
    state.slots = [];
    setPageError(error.message || "Не удалось загрузить окна");
    renderCalendar();
    renderSlots();
    syncNext();
  }
}

async function loadMonth() {
  const token = ++state.monthToken;
  const count = daysInMonth(state.viewYear, state.viewMonth);
  const dates = [];
  for (let day = 1; day <= count; day += 1) {
    const ymd = ymdInMonth(state.viewYear, state.viewMonth, day);
    if (isInHorizon(ymd) && !state.cache.has(ymd)) {
      dates.push(ymd);
    }
  }
  try {
    const results = await Promise.all(
      dates.map(async (ymd) => {
        const data = await fetchDay(ymd);
        return { ymd, data };
      }),
    );
    if (token !== state.monthToken) {
      return;
    }
    results.forEach(({ ymd, data }) => {
      state.cache.set(ymd, data);
      rememberDuration(data);
    });
  } catch (error) {
    if (token !== state.monthToken) {
      return;
    }
    setPageError(error.message || "Не удалось загрузить календарь");
  }
  if (token !== state.monthToken) {
    return;
  }
  renderCalendar();
}

async function selectDay(ymd) {
  if (!isInHorizon(ymd)) {
    return;
  }
  const { year, month } = parseYmd(ymd);
  const monthChanged = year !== state.viewYear || month - 1 !== state.viewMonth;
  state.viewYear = year;
  state.viewMonth = month - 1;
  state.selectedYmd = ymd;
  state.slotError = "";
  setPageError("");
  saveDraft({ date: ymd });
  renderCalendar();
  if (monthChanged) {
    await loadMonth();
  }
  await loadSelectedDay({ spinner: true });
}

async function holdSlot(startsAt, endsAt) {
  const request = ++state.holdRequest;
  state.selectedStartsAt = startsAt;
  state.selectedEndsAt = endsAt;
  state.slotError = "";
  setPageError("");
  renderSlots();
  const payload = {
    master_id: state.masterId,
    service_ids: state.serviceIds,
    starts_at: startsAt,
  };
  const existing = currentHoldToken();
  if (existing) {
    payload.hold_token = existing;
  }
  try {
    const body = await createHold(payload);
    if (request !== state.holdRequest) {
      return;
    }
    applyHold(body.hold);
    renderSlots();
  } catch (error) {
    if (request !== state.holdRequest) {
      return;
    }
    state.selectedStartsAt = state.hold?.starts_at || null;
    state.selectedEndsAt = state.hold?.ends_at || null;
    const message = error instanceof ApiError ? error.message : "Не удалось зарезервировать слот";
    state.slotError = message;
    if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
      state.cache.delete(state.selectedYmd);
      await loadSelectedDay({ spinner: true });
      const slotError = document.getElementById("slot-error");
      if (slotError) {
        slotError.textContent = message;
      } else {
        setPageError(message);
      }
      return;
    }
    renderSlots();
  }
}

function bind() {
  document.getElementById("month-prev").addEventListener("click", async () => {
    if (monthBounds().canPrev === false) {
      return;
    }
    if (state.viewMonth === 0) {
      state.viewYear -= 1;
      state.viewMonth = 11;
    } else {
      state.viewMonth -= 1;
    }
    renderCalendar();
    await loadMonth();
  });

  document.getElementById("month-next").addEventListener("click", async () => {
    if (monthBounds().canNext === false) {
      return;
    }
    if (state.viewMonth === 11) {
      state.viewYear += 1;
      state.viewMonth = 0;
    } else {
      state.viewMonth += 1;
    }
    renderCalendar();
    await loadMonth();
  });

  document.getElementById("calendar-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button || button.disabled) {
      return;
    }
    selectDay(button.dataset.date);
  });

  document.getElementById("slots-block").addEventListener("click", (event) => {
    const otherDate = event.target.closest("#other-date-btn");
    if (otherDate && state.nearest) {
      selectDay(state.nearest.ymd);
      return;
    }
    const chip = event.target.closest(".time-slot");
    if (!chip) {
      return;
    }
    holdSlot(chip.dataset.startsAt, chip.dataset.endsAt);
  });

  document.getElementById("next-btn").addEventListener("click", () => {
    if (!holdIsLive(state.hold)) {
      return;
    }
    window.location.href = "booking-review.html";
  });
}

async function restoreHold(draft) {
  if (!draft.holdToken) {
    return;
  }
  try {
    const body = await getHold(draft.holdToken);
    const hold = body.hold;
    const holdDate = ymdFromInstant(hold.starts_at);
    if (holdDate) {
      state.selectedYmd = holdDate;
      const { year, month } = parseYmd(holdDate);
      state.viewYear = year;
      state.viewMonth = month - 1;
    }
    applyHold(hold);
  } catch {
    saveDraft({ holdToken: null, startsAt: null });
  }
}

async function init() {
  document.getElementById("booking-stepper").innerHTML = renderStepper(3);

  const draft = loadDraft();
  const serviceIds = Array.isArray(draft.serviceIds) ? draft.serviceIds : [];
  const masterId = Number(draft.masterId);

  let services = [];
  try {
    services = await getServices();
  } catch (error) {
    setPageError(error.message || "Не удалось загрузить услуги");
    return;
  }

  if (!hasMainService(services, serviceIds)) {
    window.location.replace("booking.html");
    return;
  }
  if (!Number.isInteger(masterId) || masterId <= 0) {
    window.location.replace("booking-master.html");
    return;
  }

  state.masterId = masterId;
  state.serviceIds = serviceIds;

  const today = todayYmd();
  const end = horizonEnd();
  let selected = draft.date && draft.date >= today && draft.date <= end ? draft.date : today;
  state.selectedYmd = selected;
  const parts = parseYmd(selected);
  state.viewYear = parts.year;
  state.viewMonth = parts.month - 1;
  state.selectedStartsAt = draft.startsAt || null;

  bind();
  await restoreHold(draft);
  saveDraft({ date: state.selectedYmd, masterId, serviceIds });
  renderCalendar();
  state.slotsStatus = "loading";
  renderSlots();
  await loadMonth();
  await loadSelectedDay({ spinner: true });
}

init();
