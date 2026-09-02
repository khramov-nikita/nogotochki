import { ApiError, listAppointments } from "./api.js";
import {
  escapeHtml,
  formatDurationMinutes,
  formatPrice,
  formatVisitDateTime,
  masterName,
  statusBadgeClass,
  statusBadgeLabel,
} from "./format.js";
import { requireClient } from "./require-client.js";

const INTRO = {
  active:
    "Предстоящие визиты. Отмена и перенос — в деталях записи, звонить не нужно.",
  empty:
    "После входа с лендинга, если записей ещё нет. Выберите услуги и свободное время — запись займёт пару минут.",
  history:
    "Прошедшие, отменённые и истёкшие визиты. Можно записаться снова с теми же услугами.",
};

function tabFromQuery() {
  const tab = new URLSearchParams(location.search).get("tab");
  return tab === "history" ? "history" : "active";
}

function setTabQuery(tab) {
  const url = new URL(location.href);
  if (tab === "history") {
    url.searchParams.set("tab", "history");
  } else {
    url.searchParams.delete("tab");
  }
  history.replaceState({}, "", url);
}

function visitDuration(appointment) {
  return appointment?.duration_max_minutes ?? appointment?.duration_min_minutes ?? null;
}

function serviceNames(services) {
  return (services || []).map((row) => row.name).filter(Boolean).join(", ") || "—";
}

function badgeMarkup(status) {
  const extra = statusBadgeClass(status);
  return `<div class="booking-badge ${extra}">
    <span class="booking-badge__dot" aria-hidden="true"></span>
    <span class="meta">${escapeHtml(statusBadgeLabel(status))}</span>
  </div>`;
}

function cardNote(appointment, tab) {
  if (tab !== "active") {
    return "";
  }
  if (appointment.status === "confirmed") {
    return "Адрес студии — в деталях записи.";
  }
  if (appointment.status === "pending_prepayment") {
    return "Точный адрес появится после подтверждения.";
  }
  return "";
}

function bookAgainHref(appointment) {
  const ids = (appointment.services || [])
    .map((row) => row.id)
    .filter((id) => Number.isInteger(id) && id > 0);
  const params = new URLSearchParams();
  if (ids.length) {
    params.set("service_ids", ids.join(","));
  }
  if (appointment.master?.id) {
    params.set("master_id", String(appointment.master.id));
  }
  const query = params.toString();
  return query ? `booking.html?${query}` : "booking.html";
}

function cardMarkup(appointment, { nearest = false, tab = "active" } = {}) {
  const duration = formatDurationMinutes(visitDuration(appointment));
  const meta = [masterName(appointment.master), duration, formatPrice(appointment.total_price_rub)]
    .filter(Boolean)
    .join(" · ");
  const note = cardNote(appointment, tab);
  const nearestClass = nearest ? " appointment-card--nearest" : "";
  let actions = "";
  if (tab === "history") {
    actions = `<a class="button button--ghost button--small" href="${escapeHtml(bookAgainHref(appointment))}">Записаться снова</a>`;
  } else {
    const buttons = [
      `<a class="button button--text button--small" href="cabinet-appointment.html?id=${appointment.id}">Подробнее</a>`,
    ];
    if (appointment.can_reschedule) {
      buttons.push(
        `<a class="button button--ghost button--small" href="cabinet-reschedule.html?id=${appointment.id}">Перенести</a>`,
      );
    }
    if (appointment.can_cancel) {
      buttons.push(
        `<a class="button button--ghost button--small" href="cabinet-appointment.html?id=${appointment.id}&cancel=1">Отменить</a>`,
      );
    }
    actions = buttons.join("");
  }

  return `<article class="appointment-card${nearestClass}">
    <div class="appointment-card__head">
      <h2 class="heading-4">${escapeHtml(formatVisitDateTime(appointment.starts_at))}</h2>
      ${badgeMarkup(appointment.status)}
    </div>
    <p class="body-small">${escapeHtml(serviceNames(appointment.services))}</p>
    <p class="meta">${escapeHtml(meta)}</p>
    ${note ? `<p class="meta meta-muted">${escapeHtml(note)}</p>` : ""}
    <div class="appointment-card__actions">${actions}</div>
  </article>`;
}

function emptyActiveMarkup() {
  return `<div class="cabinet-empty">
    <h2 class="heading-1">В кабинете пока нет записей</h2>
    <p class="body-large">Когда появится визит, он будет здесь. Можно записаться сейчас.</p>
    <a class="button button--primary button--large" href="booking.html">Записаться</a>
  </div>`;
}

function emptyHistoryMarkup() {
  return `<div class="cabinet-empty">
    <h2 class="heading-3">В истории пока нет записей</h2>
    <p class="body-medium">Отменённые, истёкшие и прошедшие визиты появятся здесь.</p>
  </div>`;
}

function syncTabs(tab) {
  document.querySelectorAll(".cabinet-tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("cabinet-tab--active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById("cabinet-intro").textContent = INTRO[tab];
}

function setError(message) {
  document.getElementById("cabinet-error").textContent = message || "";
}

async function render(tab) {
  const root = document.getElementById("cabinet-content");
  setError("");
  syncTabs(tab);
  root.innerHTML = `<p class="meta" role="status">Загрузка…</p>`;
  try {
    const appointments = await listAppointments(tab);
    if (tab === "active" && !appointments.length) {
      document.getElementById("cabinet-intro").textContent = INTRO.empty;
      root.innerHTML = emptyActiveMarkup();
      return;
    }
    if (!appointments.length) {
      root.innerHTML = emptyHistoryMarkup();
      return;
    }
    root.innerHTML = `<div class="cabinet-list">${appointments
      .map((row, index) => cardMarkup(row, { nearest: tab === "active" && index === 0, tab }))
      .join("")}</div>`;
  } catch (error) {
    root.innerHTML = "";
    setError(error instanceof ApiError ? error.message : "Не удалось загрузить записи");
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

  let tab = tabFromQuery();
  document.querySelectorAll(".cabinet-tab").forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab === "history" ? "history" : "active";
      setTabQuery(tab);
      render(tab);
    });
  });
  await render(tab);
}

init();
