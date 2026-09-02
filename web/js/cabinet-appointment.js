import { ApiError, cancelAppointment, getAppointment } from "./api.js";
import { escapeHtml, statusBadgeClass, statusBadgeLabel } from "./format.js";
import { requireClient } from "./require-client.js";
import { visitSummaryMarkup } from "./visit-summary.js";

const INTRO = {
  pending_prepayment: "Слот зарезервирован. Предоплату принимает студия, сайт оплату не принимает.",
  confirmed: "Запись подтверждена. Приходите в студию в выбранное время. Оплата на сайте не требуется.",
  rescheduled: "Новое время сохранено. Предоплату принимает студия, на сайте оплаты нет.",
  cancelled: "Запись отменена. Слот освободился.",
  expired: "Резерв истек. Можно записаться снова.",
};

const NOTE = {
  pending_prepayment: "Точного адреса ещё нет — он появится, когда студия подтвердит запись.",
  confirmed: "Точный адрес — строкой, без карты и телефона. Предоплату принимает студия.",
  rescheduled: "Предоплату принимает студия, на сайте оплаты нет.",
  cancelled: "Запись отменена. Предоплату уточняет студия по своим правилам.",
  expired: "Резерв истек. Можно записаться снова.",
};

const LATE_CANCEL = "До визита осталось мало времени. Отменить запись уже нельзя.";

const state = {
  appointment: null,
  cancelling: false,
};

function appointmentId() {
  const raw = Number(new URLSearchParams(location.search).get("id"));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

function openCancelRequested() {
  return new URLSearchParams(location.search).get("cancel") === "1";
}

function setError(message) {
  document.getElementById("details-error").textContent = message || "";
}

function setBanners(html) {
  document.getElementById("details-banners").innerHTML = html || "";
}

function warningBanner(message) {
  return `<div class="banner banner--warning">
    <span class="icon icon--alert" aria-hidden="true"></span>
    <p class="body-small">${escapeHtml(message)}</p>
  </div>`;
}

function closeModal() {
  document.getElementById("cancel-overlay").hidden = true;
}

function openModal() {
  const appointment = state.appointment;
  const canCancel = Boolean(appointment?.can_cancel);
  document.getElementById("cancel-warning").hidden = canCancel;
  document.getElementById("cancel-confirm").hidden = !canCancel;
  document.getElementById("cancel-body").hidden = !canCancel;
  if (!canCancel) {
    document.getElementById("cancel-warning").querySelector("p").textContent = LATE_CANCEL;
  }
  document.getElementById("cancel-overlay").hidden = false;
}

function render(appointment) {
  const intro = INTRO[appointment.status] || INTRO.pending_prepayment;
  document.getElementById("details-intro").textContent = intro;

  const badge = document.getElementById("details-badge");
  badge.className = `booking-badge ${statusBadgeClass(appointment.status)}`;
  badge.innerHTML = `<span class="booking-badge__dot" aria-hidden="true"></span>
    <span class="meta">${escapeHtml(statusBadgeLabel(appointment.status))}</span>`;
  badge.hidden = false;

  const address =
    appointment.status === "confirmed" && appointment.exact_address ? appointment.exact_address : null;
  const note = NOTE[appointment.status] || NOTE.pending_prepayment;
  document.getElementById("details-summary").innerHTML = visitSummaryMarkup(appointment, {
    editLinks: false,
    address,
    note,
  });

  const rules = document.getElementById("details-rules");
  rules.hidden = false;
  rules.querySelector("a").href = `cabinet-rules.html?from=${appointment.id}`;

  const cta = document.getElementById("details-cta");
  const actions = document.getElementById("details-actions");
  const bits = [];
  if (appointment.can_reschedule) {
    bits.push(
      `<a class="button button--ghost button--large" href="cabinet-reschedule.html?id=${appointment.id}">Перенести</a>`,
    );
  }
  const showCancel =
    appointment.status === "pending_prepayment" ||
    appointment.status === "confirmed" ||
    appointment.status === "rescheduled";
  if (showCancel) {
    bits.push(`<button class="button button--danger button--large" type="button" id="open-cancel">Отменить запись</button>`);
  }
  actions.innerHTML = bits.join("");
  cta.hidden = false;

  if (showCancel && !appointment.can_cancel) {
    setBanners(warningBanner(LATE_CANCEL));
  }

  document.getElementById("open-cancel")?.addEventListener("click", () => {
    openModal();
  });
}

async function confirmCancel() {
  const appointment = state.appointment;
  if (!appointment?.can_cancel || state.cancelling) {
    return;
  }
  const button = document.getElementById("cancel-confirm");
  state.cancelling = true;
  button.disabled = true;
  try {
    await cancelAppointment(appointment.id);
    window.location.replace("cabinet.html?tab=history");
  } catch (error) {
    state.cancelling = false;
    button.disabled = false;
    closeModal();
    const message = error instanceof ApiError ? error.message : "Не удалось отменить запись";
    setBanners(warningBanner(message));
  }
}

async function init() {
  let client;
  try {
    client = await requireClient();
  } catch (error) {
    setError(error instanceof ApiError ? error.message : "Не удалось проверить вход");
    return;
  }
  if (!client) {
    return;
  }

  const id = appointmentId();
  if (!id) {
    setError("Запись не найдена");
    return;
  }

  document.getElementById("cancel-dismiss").addEventListener("click", closeModal);
  document.getElementById("cancel-close-icon").addEventListener("click", closeModal);
  document.getElementById("cancel-overlay").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  });
  document.getElementById("cancel-confirm").addEventListener("click", confirmCancel);

  try {
    const body = await getAppointment(id);
    state.appointment = body.appointment;
    render(state.appointment);
    if (openCancelRequested()) {
      openModal();
    }
  } catch (error) {
    setError(error instanceof ApiError ? error.message : "Не удалось загрузить запись");
  }
}

init();
