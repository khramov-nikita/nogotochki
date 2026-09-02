import { ApiError, getAppointment, getAvailability, rescheduleAppointment } from "./api.js";
import {
  addDaysYmd,
  escapeHtml,
  formatDayMonth,
  formatLocalHm,
  formatMonthTitle,
  statusBadgeClass,
  statusBadgeLabel,
  todayYmd,
  ymdFromInstant,
} from "./format.js";
import { requireClient } from "./require-client.js";

const HORIZON_DAYS = 56;
const WEEKDAYS_MON = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const INTRO_DEFAULT =
  "Услуги и мастер остаются прежними. Выберите другой день или время. Предоплату принимает студия, на сайте оплаты нет.";
const INTRO_EMPTY =
  "На выбранную дату свободных окон нет. Можно выбрать другой день. Предоплату принимает студия, на сайте оплаты нет.";
const INTRO_SUCCESS = "Новое время сохранено. Старый слот освободился.";

const state = {
  appointment: null,
  masterId: null,
  serviceIds: [],
  currentStartsAt: null,
  currentEndsAt: null,
  viewYear: 0,
  viewMonth: 0,
  selectedYmd: "",
  cache: new Map(),
  slotsStatus: "loading",
  slots: [],
  durationMinutes: null,
  selectedStartsAt: null,
  selectedEndsAt: null,
  nearest: null,
  slotError: "",
  success: false,
  slotTaken: null,
  confirming: false,
  monthToken: 0,
  dayToken: 0,
};

function appointmentId() {
  const raw = Number(new URLSearchParams(location.search).get("id"));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
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

function setPageError(message) {
  document.getElementById("reschedule-error").textContent = message || "";
}

function setBanners(html) {
  document.getElementById("reschedule-banners").innerHTML = html || "";
}

function warningBanner(message) {
  return `<div class="banner banner--warning">
    <span class="icon icon--alert" aria-hidden="true"></span>
    <p class="body-small">${escapeHtml(message)}</p>
  </div>`;
}

function successBanner() {
  return `<div class="banner banner--success">
    <span class="icon icon--check" aria-hidden="true"></span>
    <p class="body-small">Запись перенесена</p>
  </div>`;
}

function renderBadge(status) {
  const badge = document.getElementById("reschedule-badge");
  badge.className = `booking-badge ${statusBadgeClass(status)}`;
  badge.innerHTML = `<span class="booking-badge__dot" aria-hidden="true"></span>
    <span class="meta">${escapeHtml(statusBadgeLabel(status))}</span>`;
  badge.hidden = false;
}

function updateIntro(empty) {
  const intro = document.getElementById("reschedule-intro");
  if (state.success) {
    intro.textContent = INTRO_SUCCESS;
    return;
  }
  if (empty) {
    intro.textContent = INTRO_EMPTY;
    return;
  }
  intro.textContent = INTRO_DEFAULT;
}

function confirmEnabled() {
  return (
    !state.success &&
    !state.confirming &&
    Boolean(state.appointment?.can_reschedule) &&
    Boolean(state.selectedStartsAt) &&
    state.selectedStartsAt !== state.currentStartsAt &&
    !state.slotTaken
  );
}

function syncNext() {
  const nextBtn = document.getElementById("confirm-btn");
  const nextHint = document.getElementById("next-hint");
  if (!nextBtn) {
    return;
  }
  if (state.success) {
    nextBtn.hidden = true;
    if (nextHint) {
      nextHint.textContent = "";
    }
    return;
  }
  nextBtn.hidden = false;
  nextBtn.disabled = !confirmEnabled();
  nextBtn.textContent = state.confirming ? "Переносим…" : "Подтвердить перенос";
  if (nextHint) {
    nextHint.textContent = nextBtn.disabled && !state.confirming ? "Выберите другое время" : "";
  }
}

async function fetchDay(ymd) {
  return getAvailability(state.masterId, {
    date: ymd,
    serviceIds: state.serviceIds,
    excludeAppointmentId: state.appointment.id,
  });
}

function rememberDuration(data) {
  if (data?.duration_minutes != null) {
    state.durationMinutes = data.duration_minutes;
  }
}

function currentSlotForDay(ymd) {
  if (!state.currentStartsAt || ymdFromInstant(state.currentStartsAt) !== ymd) {
    return null;
  }
  return {
    starts_at: state.currentStartsAt,
    ends_at: state.currentEndsAt,
    starts_local: formatLocalHm(state.currentStartsAt),
    current: true,
  };
}

function mergedSlots(ymd, slots) {
  const list = [...(slots || [])];
  const current = currentSlotForDay(ymd);
  if (current && !list.some((slot) => slot.starts_at === current.starts_at)) {
    list.push(current);
  }
  return list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
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
    const hasCurrent = Boolean(currentSlotForDay(ymd));
    const available = isInHorizon(ymd) && (Boolean(cached?.slots?.length) || hasCurrent);
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

function renderTaken() {
  const root = document.getElementById("reschedule-taken");
  if (!state.slotTaken) {
    root.innerHTML = "";
    root.hidden = true;
    return;
  }
  const slots = state.slotTaken.slots || [];
  const chips = slots
    .map((slot) => {
      const current = slot.starts_at === state.currentStartsAt;
      const selected = slot.starts_at === state.selectedStartsAt;
      const classes = ["time-slot"];
      if (current) {
        classes.push("time-slot--current");
      } else if (selected) {
        classes.push("time-slot--selected");
      }
      const disabled = current ? "disabled" : "";
      return `<button class="${classes.join(" ")}" type="button" data-starts-at="${escapeHtml(slot.starts_at)}" data-ends-at="${escapeHtml(slot.ends_at || "")}" ${disabled}>${escapeHtml(slotLabel(slot))}</button>`;
    })
    .join("");
  root.hidden = false;
  root.innerHTML = `${chips ? `<div class="booking-slots-grid">${chips}</div>` : ""}`;
}

function renderSlots() {
  const root = document.getElementById("slots-block");
  const displaySlots = mergedSlots(state.selectedYmd, state.slots);
  const emptyDay = state.slotsStatus === "ready" && displaySlots.length === 0;
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
      <p class="body-medium">У этого мастера на выбранную дату окон нет. Выберите другую дату.</p>
      <p class="meta booking-empty-nearest" ${nearest ? "" : "hidden"}>${nearestText}</p>
      <div class="booking-empty-actions">
        <button class="button button--primary button--large" type="button" id="other-date-btn" ${otherDateDisabled}>Другая дата</button>
      </div>
    </div>`;
    return;
  }

  const chips = displaySlots
    .map((slot) => {
      const current = slot.current || slot.starts_at === state.currentStartsAt;
      const selected = !current && slot.starts_at === state.selectedStartsAt;
      const classes = ["time-slot"];
      if (current) {
        classes.push("time-slot--current");
      } else if (selected) {
        classes.push("time-slot--selected");
      }
      const disabled = current ? "disabled" : "";
      return `<button class="${classes.join(" ")}" type="button" data-starts-at="${escapeHtml(slot.starts_at)}" data-ends-at="${escapeHtml(slot.ends_at || "")}" ${disabled}>${escapeHtml(slotLabel(slot))}</button>`;
    })
    .join("");

  const until = state.selectedEndsAt ? `Визит до ${formatLocalHm(state.selectedEndsAt)}` : "";

  root.innerHTML = `<p class="label-caps">Свободное время</p>
    <div class="booking-slots-grid">${chips}</div>
    <p class="meta booking-visit-until" ${until ? "" : "hidden"}>${escapeHtml(until)}</p>
    <p class="error" id="slot-error">${escapeHtml(state.slotError)}</p>`;
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
    if (!state.slots.length && !currentSlotForDay(ymd)) {
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
  state.slotTaken = null;
  setPageError("");
  renderTaken();
  renderCalendar();
  if (monthChanged) {
    await loadMonth();
  }
  await loadSelectedDay({ spinner: true });
}

function selectSlot(startsAt, endsAt) {
  if (!startsAt || startsAt === state.currentStartsAt) {
    return;
  }
  state.selectedStartsAt = startsAt;
  state.selectedEndsAt = endsAt || null;
  state.slotError = "";
  state.slotTaken = null;
  setPageError("");
  renderTaken();
  renderSlots();
  syncNext();
}

function applyAppointment(appointment) {
  state.appointment = appointment;
  state.masterId = appointment.master?.id;
  state.serviceIds = (appointment.services || []).map((row) => row.id);
  state.currentStartsAt = appointment.starts_at;
  state.currentEndsAt = appointment.ends_at;
  state.durationMinutes = appointment.duration_max_minutes ?? appointment.duration_min_minutes ?? null;
  const back = document.getElementById("reschedule-back");
  if (back) {
    back.href = `cabinet-appointment.html?id=${appointment.id}`;
  }
  renderBadge(appointment.status);
}

function renderSuccessCta() {
  const cta = document.getElementById("reschedule-cta");
  cta.innerHTML = `<a class="button button--ghost button--large" href="cabinet-appointment.html?id=${state.appointment.id}">Назад</a>
    <a class="button button--primary button--large" href="cabinet.html">В кабинет</a>`;
}

async function confirmMove() {
  if (!confirmEnabled()) {
    return;
  }
  state.confirming = true;
  setPageError("");
  setBanners("");
  syncNext();
  try {
    const body = await rescheduleAppointment(state.appointment.id, {
      starts_at: state.selectedStartsAt,
    });
    state.success = true;
    state.confirming = false;
    state.slotTaken = null;
    applyAppointment(body.appointment);
    state.selectedStartsAt = null;
    state.selectedEndsAt = null;
    state.cache.clear();
    setBanners(successBanner());
    renderTaken();
    renderSuccessCta();
    updateIntro(false);
  } catch (error) {
    state.confirming = false;
    const message = error instanceof ApiError ? error.message : "Не удалось перенести запись";
    if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
      state.slotTaken = {
        message,
        slots: Array.isArray(error.body?.slots) ? error.body.slots : [],
      };
      setBanners(warningBanner(message));
      renderTaken();
      state.cache.delete(state.selectedYmd);
      await loadSelectedDay({ spinner: false });
      syncNext();
      return;
    }
    setBanners(warningBanner(message));
    syncNext();
    return;
  }
  try {
    await loadMonth();
    await loadSelectedDay({ spinner: true });
  } catch (error) {
    setPageError(error instanceof ApiError ? error.message : "Не удалось обновить слоты");
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
    if (!chip || chip.disabled) {
      return;
    }
    selectSlot(chip.dataset.startsAt, chip.dataset.endsAt);
  });

  document.getElementById("reschedule-taken").addEventListener("click", (event) => {
    const chip = event.target.closest(".time-slot");
    if (!chip || chip.disabled) {
      return;
    }
    selectSlot(chip.dataset.startsAt, chip.dataset.endsAt);
  });

  document.getElementById("confirm-btn").addEventListener("click", confirmMove);
}

async function init() {
  let client;
  try {
    client = await requireClient();
  } catch (error) {
    setPageError(error instanceof ApiError ? error.message : "Не удалось проверить вход");
    return;
  }
  if (!client) {
    return;
  }

  const id = appointmentId();
  if (!id) {
    setPageError("Запись не найдена");
    return;
  }

  try {
    const body = await getAppointment(id);
    applyAppointment(body.appointment);
  } catch (error) {
    setPageError(error instanceof ApiError ? error.message : "Не удалось загрузить запись");
    return;
  }

  if (!state.masterId || !state.serviceIds.length) {
    setPageError("Нельзя перенести запись без мастера и услуг");
    return;
  }

  const today = todayYmd();
  const end = horizonEnd();
  const currentYmd = ymdFromInstant(state.currentStartsAt);
  let selected = currentYmd && currentYmd >= today && currentYmd <= end ? currentYmd : today;
  state.selectedYmd = selected;
  const parts = parseYmd(selected);
  state.viewYear = parts.year;
  state.viewMonth = parts.month - 1;

  bind();
  renderCalendar();
  state.slotsStatus = "loading";
  renderSlots();
  syncNext();
  await loadMonth();
  await loadSelectedDay({ spinner: true });
}

init();
