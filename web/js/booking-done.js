import { ApiError, getAppointment } from "./api.js";
import { renderStepper } from "./booking-stepper.js";
import { escapeHtml, statusBadgeLabel } from "./format.js";
import { loadAppointmentId } from "./store.js";
import { visitSummaryMarkup } from "./visit-summary.js";

async function init() {
  document.getElementById("booking-stepper").innerHTML = renderStepper(5, { linkDone: false });

  const id = loadAppointmentId();
  if (!id) {
    window.location.replace("cabinet.html");
    return;
  }

  const errorEl = document.getElementById("done-error");
  const summaryEl = document.getElementById("done-summary");
  const badgeEl = document.getElementById("done-badge");

  try {
    const body = await getAppointment(id);
    const appointment = body.appointment;
    badgeEl.innerHTML = `<span class="booking-badge__dot" aria-hidden="true"></span>
      <span class="meta">${escapeHtml(statusBadgeLabel(appointment.status))}</span>`;
    badgeEl.hidden = false;
    summaryEl.innerHTML = visitSummaryMarkup(appointment, { editLinks: false });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Не удалось загрузить запись";
    errorEl.textContent = message;
  }
}

init();
