import { ApiError, createAppointment, createHold, getAvailability, getHold, getMe } from "./api.js";
import { renderStepper } from "./booking-stepper.js";
import {
  escapeHtml,
  formatCountdown,
  formatDayMonth,
  formatLocalHm,
  ymdFromInstant,
} from "./format.js";
import { loadDraft, saveAppointmentId, saveDraft, clearDraft } from "./store.js";
import { visitSummaryMarkup } from "./visit-summary.js";

const INTRO_GUEST =
  "Состав визита, мастер и слот. Чтобы подтвердить запись, войдите или зарегистрируйтесь. Предоплату принимает студия, на сайте оплаты нет.";
const INTRO_SESSION =
  "Проверьте состав визита. Предоплату принимает студия — сайт только резервирует слот. Точный адрес появится в кабинете после подтверждения.";
const BANNER_GUEST =
  "Чтобы подтвердить запись, войдите или зарегистрируйтесь. Предоплату принимает студия, на сайте оплаты нет.";
const BANNER_SESSION = "Резерв слота истекает. Завершите проверку, пока время ещё удерживается.";

const state = {
  hold: null,
  client: null,
  slotTaken: null,
  pageError: "",
  confirming: false,
  timerId: null,
  expired: false,
};

function holdIsLive(hold) {
  if (!hold?.expires_at) {
    return false;
  }
  return new Date(hold.expires_at).getTime() > Date.now();
}

function remainingMs(expiresAt) {
  return new Date(expiresAt).getTime() - Date.now();
}

function slotLabel(slot) {
  const time = slot.starts_local || formatLocalHm(slot.starts_at);
  const ymd = ymdFromInstant(slot.starts_at);
  const holdYmd = ymdFromInstant(state.hold?.starts_at);
  if (ymd && holdYmd && ymd !== holdYmd) {
    return `${formatDayMonth(ymd)}, ${time}`;
  }
  return time;
}

function confirmEnabled() {
  return Boolean(state.client) && holdIsLive(state.hold) && !state.slotTaken && !state.expired && !state.confirming;
}

function setPageError(message) {
  state.pageError = message || "";
  const el = document.getElementById("review-error");
  if (el) {
    el.textContent = state.pageError;
  }
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function renderBanner() {
  const root = document.getElementById("review-banner");
  if (state.slotTaken) {
    root.innerHTML = `<div class="banner banner--taken">
      <span class="icon icon--alert" aria-hidden="true"></span>
      <p class="body-small">${escapeHtml(state.slotTaken.message)}</p>
    </div>`;
    return;
  }
  if (!state.client) {
    root.innerHTML = `<div class="banner">
      <span class="icon icon--info" aria-hidden="true"></span>
      <p class="body-small">${escapeHtml(BANNER_GUEST)}</p>
    </div>
    <div class="booking-auth-links">
      <a class="button button--text" href="auth.html?next=booking-review.html">Войти</a>
      <a class="button button--text" href="register.html?next=booking-review.html">Регистрация</a>
    </div>`;
    return;
  }
  root.innerHTML = `<div class="banner banner--warning">
    <span class="icon icon--alert" aria-hidden="true"></span>
    <p class="body-small">${escapeHtml(BANNER_SESSION)}</p>
  </div>`;
}

function renderTaken() {
  const root = document.getElementById("review-taken");
  if (!state.slotTaken) {
    root.innerHTML = "";
    root.hidden = true;
    return;
  }
  const slots = state.slotTaken.slots || [];
  const chips = slots
    .map(
      (slot) =>
        `<button class="time-slot" type="button" data-starts-at="${escapeHtml(slot.starts_at)}">${escapeHtml(slotLabel(slot))}</button>`,
    )
    .join("");
  root.hidden = false;
  root.innerHTML = `${
    chips ? `<div class="booking-slots-grid">${chips}</div>` : ""
  }
    <a class="button button--ghost button--large" href="booking-datetime.html">Другое время</a>`;
}

function renderSummary() {
  const root = document.getElementById("review-summary");
  if (!state.hold) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = visitSummaryMarkup(state.hold, { editLinks: true });
}

function renderTimer() {
  const timer = document.getElementById("hold-timer");
  const value = document.getElementById("timer-value");
  const live = holdIsLive(state.hold) && !state.slotTaken;
  if (!timer || !value) {
    return;
  }
  if (!live) {
    timer.setAttribute("hidden", "");
    timer.classList.remove("booking-timer--critical");
    return;
  }
  timer.removeAttribute("hidden");
  value.textContent = formatCountdown(state.hold.expires_at);
  timer.classList.toggle("booking-timer--critical", remainingMs(state.hold.expires_at) < 60_000);
}

function renderCta() {
  const button = document.getElementById("confirm-btn");
  button.disabled = !confirmEnabled();
  button.textContent = state.confirming ? "Подтверждаем…" : "Подтвердить запись";
}

function render() {
  document.getElementById("review-intro").textContent = state.client ? INTRO_SESSION : INTRO_GUEST;
  const errorEl = document.getElementById("review-error");
  if (errorEl) {
    errorEl.textContent = state.pageError;
  }
  renderBanner();
  renderTaken();
  renderSummary();
  renderTimer();
  renderCta();
}

async function handleExpiry() {
  stopTimer();
  state.expired = true;
  renderTimer();
  renderCta();
  const token = state.hold?.hold_token || loadDraft().holdToken;
  if (!token) {
    return;
  }
  try {
    const body = await getHold(token);
    if (holdIsLive(body.hold)) {
      state.hold = body.hold;
      state.expired = false;
      saveDraft({
        holdToken: body.hold.hold_token,
        startsAt: body.hold.starts_at,
        date: ymdFromInstant(body.hold.starts_at),
      });
      startTimer();
      render();
      return;
    }
  } catch (error) {
    setPageError(error.message || "Резерв истек");
    saveDraft({ holdToken: null, startsAt: null });
    state.hold = state.hold ? { ...state.hold, expires_at: new Date(0).toISOString() } : null;
    render();
  }
}

function startTimer() {
  stopTimer();
  if (!holdIsLive(state.hold) || state.slotTaken) {
    renderTimer();
    renderCta();
    return;
  }
  const tick = () => {
    if (!holdIsLive(state.hold)) {
      handleExpiry();
      return;
    }
    renderTimer();
    renderCta();
  };
  tick();
  state.timerId = setInterval(tick, 1000);
}

async function applyHold(hold) {
  state.hold = hold;
  state.slotTaken = null;
  state.expired = false;
  state.pageError = "";
  saveDraft({
    holdToken: hold.hold_token,
    startsAt: hold.starts_at,
    date: ymdFromInstant(hold.starts_at),
    masterId: hold.master?.id || loadDraft().masterId,
    serviceIds: (hold.services || []).map((row) => row.id),
  });
  render();
  startTimer();
}

function showSlotTaken(error) {
  stopTimer();
  const slots = Array.isArray(error.body?.slots) ? error.body.slots : [];
  state.slotTaken = {
    message: error.message,
    slots,
  };
  state.pageError = "";
  state.expired = false;
  render();
}

/** Если холд уже стёрт, а слот занят чужой записью — показать SlotTaken (S3), не «резерв истёк». */
async function slotTakenAfterHoldGone(hold) {
  const masterId = hold?.master?.id;
  const startsAt = hold?.starts_at;
  const serviceIds = (hold?.services || []).map((row) => row.id);
  if (!masterId || !startsAt || !serviceIds.length) {
    return null;
  }
  const date = ymdFromInstant(startsAt);
  const body = await getAvailability(masterId, { date, serviceIds });
  const slots = body.slots || [];
  if (slots.some((slot) => slot.starts_at === startsAt)) {
    return null;
  }
  const nearby = slots.filter((slot) => slot.starts_at > startsAt).slice(0, 5);
  return new ApiError(409, {
    error: { code: "SLOT_TAKEN", message: "Это время уже занято" },
    slots: nearby.length ? nearby : slots.slice(0, 5),
  });
}

async function reholdSlot(startsAt) {
  const draft = loadDraft();
  const masterId = state.hold?.master?.id || draft.masterId;
  const serviceIds = (state.hold?.services || []).map((row) => row.id);
  const ids = serviceIds.length ? serviceIds : draft.serviceIds;
  if (!masterId || !ids?.length || !startsAt) {
    return;
  }
  const payload = {
    master_id: masterId,
    service_ids: ids,
    starts_at: startsAt,
  };
  const token = state.hold?.hold_token || draft.holdToken;
  if (token) {
    payload.hold_token = token;
  }
  try {
    const body = await createHold(payload);
    await applyHold(body.hold);
  } catch (error) {
    if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
      showSlotTaken(error);
      return;
    }
    setPageError(error.message || "Не удалось зарезервировать слот");
    renderCta();
  }
}

async function confirm() {
  if (!confirmEnabled()) {
    return;
  }
  const token = state.hold?.hold_token;
  if (!token) {
    return;
  }
  state.confirming = true;
  setPageError("");
  renderCta();
  try {
    const body = await createAppointment(token);
    const appointment = body.appointment;
    saveAppointmentId(appointment.id);
    clearDraft();
    window.location.href = "booking-done.html";
  } catch (error) {
    state.confirming = false;
    if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
      showSlotTaken(error);
      return;
    }
    if (error instanceof ApiError && error.code === "HOLD_EXPIRED") {
      try {
        const taken = await slotTakenAfterHoldGone(state.hold);
        if (taken) {
          saveDraft({ holdToken: null, startsAt: null });
          showSlotTaken(taken);
          return;
        }
      } catch {
        /* обычный истёкший резерв */
      }
      state.expired = true;
      saveDraft({ holdToken: null, startsAt: null });
      stopTimer();
      setPageError(error.message || "Не удалось подтвердить запись");
      render();
      return;
    }
    setPageError(error.message || "Не удалось подтвердить запись");
    render();
  }
}

function bind() {
  document.getElementById("confirm-btn").addEventListener("click", () => {
    confirm();
  });
  document.getElementById("review-taken").addEventListener("click", (event) => {
    const chip = event.target.closest(".time-slot");
    if (!chip) {
      return;
    }
    reholdSlot(chip.dataset.startsAt);
  });
}

async function loadClient() {
  try {
    const body = await getMe();
    state.client = body.client || null;
  } catch (error) {
    state.client = null;
    if (!(error instanceof ApiError && error.status === 401)) {
      setPageError(error.message || "Не удалось проверить вход");
    }
  }
}

async function init() {
  document.getElementById("booking-stepper").innerHTML = renderStepper(4);
  bind();

  const token = loadDraft().holdToken;
  if (!token) {
    window.location.replace("booking-datetime.html");
    return;
  }

  await loadClient();

  try {
    const body = await getHold(token);
    await applyHold(body.hold);
  } catch (error) {
    if (error instanceof ApiError && error.code === "HOLD_EXPIRED") {
      saveDraft({ holdToken: null, startsAt: null });
      window.location.replace("booking-datetime.html");
      return;
    }
    setPageError(error.message || "Не удалось загрузить резерв");
    render();
  }
}

init();
