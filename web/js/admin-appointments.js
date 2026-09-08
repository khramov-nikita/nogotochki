import {
  adminCancelAppointment,
  adminConfirmAppointment,
  adminCreateAppointment,
  adminCreateTimeBlock,
  adminDeleteTimeBlock,
  adminListAppointments,
  adminListMasters,
  adminListServices,
  adminRescheduleAppointment,
  ApiError,
  getAppointment,
  getAvailability,
} from "./api.js";
import {
  alertMarkup,
  badgeMarkup,
  bindDeleteModal,
  emptyMarkup,
  fieldMarkup,
  flashMarkup,
  goToList,
  resetFormErrors,
  selectMarkup,
  showFormError,
  takeFlash,
  textareaMarkup,
} from "./admin-common.js";
import { visitSummaryMarkup } from "./visit-summary.js";
import {
  addDaysYmd,
  escapeHtml,
  formatDayMonthYear,
  formatLocalHm,
  formatVisitDateTime,
  masterName,
  statusBadgeClass,
  statusBadgeLabel,
  todayYmd,
  ymdFromInstant,
} from "./format.js";

const LIST_PATH = "/admin";
const WEEKDAYS_MON = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const KIND_LABELS = {
  break: "Перерыв",
  day_off: "Выходной",
  vacation: "Отпуск",
};

const state = {
  date: todayYmd(),
  masterId: null,
  masters: [],
  services: [],
  cancelId: null,
  overlap: null,
};

function params() {
  return new URLSearchParams(location.search);
}

function viewFromPage() {
  const query = params();
  if (query.has("new")) {
    return { mode: "new" };
  }
  if (query.has("block")) {
    return { mode: "block" };
  }
  const reschedule = Number(query.get("reschedule"));
  if (Number.isInteger(reschedule) && reschedule > 0) {
    return { mode: "reschedule", id: reschedule };
  }
  const id = Number(query.get("id"));
  if (Number.isInteger(id) && id > 0) {
    return { mode: "details", id };
  }
  return { mode: "list" };
}

function readListFilters() {
  const query = params();
  const date = query.get("date");
  state.date = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayYmd();
  const masterId = Number(query.get("master_id"));
  state.masterId = Number.isInteger(masterId) && masterId > 0 ? masterId : null;
}

function listHref(extra = {}) {
  const next = new URLSearchParams();
  const date = extra.date ?? state.date;
  const masterId = extra.masterId !== undefined ? extra.masterId : state.masterId;
  if (date) {
    next.set("date", date);
  }
  if (masterId) {
    next.set("master_id", String(masterId));
  }
  const query = next.toString();
  return query ? `${LIST_PATH}?${query}` : LIST_PATH;
}

function actorLabel(actor) {
  if (!actor) {
    return "—";
  }
  return actor.display_name?.trim() || actor.email || "—";
}

function serviceNames(services) {
  return (services || []).map((row) => row.name).filter(Boolean).join(", ") || "—";
}

function clientLabel(client) {
  if (!client) {
    return "—";
  }
  return client.display_name?.trim() || client.email || "—";
}

function appointmentBadge(appointment) {
  const bits = [badgeMarkup(statusBadgeLabel(appointment.status), statusBadgeClass(appointment.status))];
  if (appointment.overlapping) {
    bits.push(badgeMarkup("Два визита", "booking-badge--pending"));
  }
  return `<div class="admin-chips">${bits.join("")}</div>`;
}

function calendarMarkup() {
  return `<div class="booking-calendar" id="calendar">
    <div class="booking-calendar-head">
      <button class="calendar-nav" type="button" id="month-prev" aria-label="Предыдущий месяц">
        <span class="icon icon--chevron-left" aria-hidden="true"></span>
      </button>
      <p class="heading-4 booking-calendar-title" id="month-title"></p>
      <button class="calendar-nav" type="button" id="month-next" aria-label="Следующий месяц">
        <span class="icon icon--chevron-right" aria-hidden="true"></span>
      </button>
    </div>
    <div class="booking-calendar-week" aria-hidden="true">
      ${WEEKDAYS_MON.map((day) => `<span class="meta booking-calendar-weekday">${day}</span>`).join("")}
    </div>
    <div class="booking-calendar-grid" id="calendar-grid"></div>
  </div>
  <div class="booking-slots" id="slots-block"></div>`;
}

function listCard(appointment) {
  const cancelled = appointment.status === "cancelled";
  const extra = [
    cancelled ? " admin-card--cancelled" : "",
    appointment.overlapping ? " admin-overlap" : "",
  ].join("");
  const actions = [
    `<a class="button button--text button--small" href="${LIST_PATH}?id=${appointment.id}&date=${encodeURIComponent(state.date)}${state.masterId ? `&master_id=${state.masterId}` : ""}">Подробнее</a>`,
  ];
  if (appointment.status === "pending_prepayment" || appointment.status === "rescheduled") {
    actions.push(
      `<button class="button button--ghost button--small" type="button" data-confirm="${appointment.id}">Подтвердить предоплату</button>`,
    );
  }
  if (appointment.status === "pending_prepayment" || appointment.status === "confirmed" || appointment.status === "rescheduled") {
    actions.push(
      `<a class="button button--ghost button--small" href="${LIST_PATH}?reschedule=${appointment.id}&date=${encodeURIComponent(state.date)}">Перенести</a>`,
    );
    actions.push(
      `<button class="button button--text button--small" type="button" data-cancel="${appointment.id}">Отменить</button>`,
    );
  }
  return `<article class="appointment-card admin-card${extra}">
    <h2 class="heading-4">${escapeHtml(formatLocalHm(appointment.starts_at))}</h2>
    <p class="body-small">${escapeHtml(clientLabel(appointment.client))}</p>
    <p class="meta">${escapeHtml(masterName(appointment.master))} · ${escapeHtml(serviceNames(appointment.services))}</p>
    ${appointmentBadge(appointment)}
    <div class="appointment-card__actions">${actions.join("")}</div>
  </article>`;
}

function blockCard(block) {
  const range =
    block.kind === "break"
      ? `${formatLocalHm(block.starts_at)}–${formatLocalHm(block.ends_at)}`
      : formatVisitDateTime(block.starts_at);
  return `<article class="admin-card">
    <h2 class="heading-4">${escapeHtml(KIND_LABELS[block.kind] || block.kind)}</h2>
    <p class="body-small">${escapeHtml(masterName(block.master))}</p>
    <p class="meta">${escapeHtml(range)}</p>
    <div class="admin-chips">${badgeMarkup("Блокировка")}</div>
    <div class="admin-card__actions">
      <button class="button button--text button--small" type="button" data-unblock="${block.id}">Снять</button>
    </div>
  </article>`;
}

function listMarkup(data, flash) {
  const masterOptions = [
    { value: "", label: "Все мастера" },
    ...state.masters.map((row) => ({ value: String(row.id), label: masterName(row) })),
  ];
  const visits = data.appointments || [];
  const blocks = data.time_blocks || [];
  const body =
    visits.length || blocks.length
      ? `<div class="admin-list admin-list--day">
          ${visits.map(listCard).join("")}
          ${blocks.map(blockCard).join("")}
        </div>`
      : emptyMarkup("На этот день записей нет.");
  return `
    <div class="admin-toolbar">
      <div class="booking-intro">
        <h1 class="heading-1">Записи</h1>
        <p class="body-medium">Визиты ${escapeHtml(formatDayMonthYear(state.date))}. Время — часовой пояс студии.</p>
      </div>
      <div class="admin-card__actions">
        <a class="button button--ghost button--large" href="${listHref({})}&block=1">Заблокировать время</a>
        <a class="button button--primary button--large" href="${listHref({})}&new=1">Новая запись</a>
      </div>
    </div>
    ${flashMarkup(flash)}
    <p class="error" id="list-error"></p>
    <div class="admin-daybar">
      <div class="admin-date-nav">
        <button class="calendar-nav" type="button" id="day-prev" aria-label="Предыдущий день">
          <span class="icon icon--chevron-left" aria-hidden="true"></span>
        </button>
        <input class="input" id="day-input" type="date" value="${escapeHtml(state.date)}" />
        <button class="calendar-nav" type="button" id="day-next" aria-label="Следующий день">
          <span class="icon icon--chevron-right" aria-hidden="true"></span>
        </button>
      </div>
      ${selectMarkup({
        name: "master_filter",
        label: "Мастер",
        value: state.masterId ? String(state.masterId) : "",
        options: masterOptions,
      })}
    </div>
    ${body}
  `;
}

function detailsMarkup(appointment, flash) {
  const address =
    appointment.status === "confirmed" && appointment.exact_address ? appointment.exact_address : null;
  const cancelMeta =
    appointment.status === "cancelled"
      ? `<p class="meta">Отменил: ${escapeHtml(actorLabel(appointment.cancelled_by))}. Причина: ${escapeHtml(appointment.cancel_reason || "—")}</p>`
      : "";
  const moveMeta =
    appointment.previous_starts_at
      ? `<p class="meta">Перенос: ${escapeHtml(formatVisitDateTime(appointment.previous_starts_at))} → ${escapeHtml(formatVisitDateTime(appointment.starts_at))}. Кто: ${escapeHtml(actorLabel(appointment.rescheduled_by))}</p>`
      : "";
  const actions = [];
  if (appointment.status === "pending_prepayment" || appointment.status === "rescheduled") {
    actions.push(
      `<button class="button button--primary button--large" type="button" data-confirm="${appointment.id}">Подтвердить предоплату</button>`,
    );
  }
  if (appointment.status === "pending_prepayment" || appointment.status === "confirmed" || appointment.status === "rescheduled") {
    actions.push(
      `<a class="button button--ghost button--large" href="${LIST_PATH}?reschedule=${appointment.id}&date=${encodeURIComponent(state.date)}">Перенести</a>`,
    );
    actions.push(
      `<button class="button button--danger button--large" type="button" data-cancel="${appointment.id}">Отменить</button>`,
    );
  }
  return `
    <div class="booking-intro">
      <h1 class="heading-1">Запись</h1>
      <p class="body-medium">${escapeHtml(clientLabel(appointment.client))}</p>
    </div>
    ${flashMarkup(flash)}
    ${appointmentBadge(appointment)}
    ${alertMarkup()}
    <p class="error" id="list-error"></p>
    ${visitSummaryMarkup(appointment, { address })}
    ${cancelMeta}
    ${moveMeta}
    <div class="admin-form-actions">
      <a class="button button--ghost button--large" href="${listHref()}">Назад</a>
      ${actions.join("")}
    </div>
  `;
}

function createMarkup() {
  const masterOptions = [
    { value: "", label: "Выберите мастера" },
    ...state.masters.filter((row) => row.is_active).map((row) => ({
      value: String(row.id),
      label: masterName(row),
    })),
  ];
  return `
    <div class="booking-intro">
      <h1 class="heading-1">Новая запись</h1>
      <p class="body-medium">Существующий клиент по почте. Если слот занят, сервер предупредит и запросит подтверждение.</p>
    </div>
    <form class="admin-form" id="create-form">
      ${alertMarkup()}
      ${fieldMarkup({ name: "client_email", label: "Почта клиента", type: "email", required: true })}
      ${selectMarkup({ name: "master_id", label: "Мастер", options: masterOptions, required: true })}
      <fieldset class="admin-flags">
        <legend class="label-caps">Услуги</legend>
        <div id="service-flags"></div>
      </fieldset>
      ${fieldMarkup({ name: "date", label: "Дата", type: "date", value: state.date, required: true })}
      <div id="slots-block"></div>
      <input type="hidden" name="starts_at" id="starts_at" />
      <div class="admin-form-actions">
        <a class="button button--ghost button--large" href="${listHref()}">Назад</a>
        <button class="button button--primary button--large" type="submit" id="create-submit" disabled>Создать запись</button>
      </div>
    </form>
  `;
}

function rescheduleMarkup(appointment) {
  return `
    <div class="booking-intro">
      <h1 class="heading-1">Перенос записи</h1>
      <p class="body-medium">Та же запись, другое время. Клиент получит одно уведомление о переносе.</p>
    </div>
    ${appointmentBadge(appointment)}
    <p class="meta">Сейчас: ${escapeHtml(formatVisitDateTime(appointment.starts_at))} · ${escapeHtml(clientLabel(appointment.client))}</p>
    ${alertMarkup()}
    <p class="error" id="list-error"></p>
    ${calendarMarkup()}
    <div class="admin-form-actions">
      <a class="button button--ghost button--large" href="${LIST_PATH}?id=${appointment.id}&date=${encodeURIComponent(state.date)}">Назад</a>
      <button class="button button--primary button--large" type="button" id="reschedule-submit" disabled>Подтвердить перенос</button>
    </div>
  `;
}

function blockMarkup() {
  const masterOptions = state.masters.map((row) => ({
    value: String(row.id),
    label: masterName(row),
  }));
  return `
    <div class="booking-intro">
      <h1 class="heading-1">Блокировка времени</h1>
      <p class="body-medium">Перерыв, выходной или отпуск. Мастер остаётся в списке, закрытые часы не показываются клиенту.</p>
    </div>
    <form class="admin-form" id="block-form">
      ${alertMarkup()}
      ${selectMarkup({
        name: "master_id",
        label: "Мастер",
        options: masterOptions,
        value: state.masterId ? String(state.masterId) : masterOptions[0]?.value || "",
        required: true,
      })}
      ${selectMarkup({
        name: "kind",
        label: "Вид",
        options: [
          { value: "break", label: "Перерыв" },
          { value: "day_off", label: "Выходной" },
          { value: "vacation", label: "Отпуск" },
        ],
        required: true,
      })}
      <div class="admin-kind-fields" data-kind="break">
        ${fieldMarkup({ name: "date", label: "Дата", type: "date", value: state.date, required: true })}
        <div class="admin-pair">
          ${fieldMarkup({ name: "start_time", label: "Начало", type: "time", value: "13:00" })}
          ${fieldMarkup({ name: "end_time", label: "Конец", type: "time", value: "14:00" })}
        </div>
      </div>
      <div class="admin-kind-fields" data-kind="day_off" hidden>
        ${fieldMarkup({ name: "day_off_date", label: "Дата", type: "date", value: state.date })}
      </div>
      <div class="admin-kind-fields" data-kind="vacation" hidden>
        <div class="admin-pair">
          ${fieldMarkup({ name: "starts_on", label: "С", type: "date", value: state.date })}
          ${fieldMarkup({ name: "ends_on", label: "По", type: "date", value: state.date })}
        </div>
      </div>
      ${textareaMarkup({ name: "reason", label: "Комментарий", rows: 2 })}
      <div class="admin-form-actions">
        <a class="button button--ghost button--large" href="${listHref()}">Назад</a>
        <button class="button button--primary button--large" type="submit">Заблокировать</button>
      </div>
    </form>
  `;
}

function setListError(message) {
  const node = document.getElementById("list-error");
  if (node) {
    node.textContent = message || "";
  }
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
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function bindCancelModal() {
  const overlay = document.getElementById("cancel-overlay");
  const reason = document.getElementById("cancel-reason");
  const warning = document.getElementById("cancel-warning");
  const confirmBtn = document.getElementById("cancel-confirm");

  function close() {
    overlay.hidden = true;
    state.cancelId = null;
    reason.value = "";
    warning.hidden = true;
    confirmBtn.disabled = false;
  }

  overlay.querySelectorAll("[data-cancel-dismiss]").forEach((button) => {
    button.addEventListener("click", close);
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  confirmBtn.addEventListener("click", async () => {
    const text = reason.value.trim();
    if (!text) {
      warning.hidden = false;
      warning.querySelector("p").textContent = "Укажите причину отмены";
      return;
    }
    confirmBtn.disabled = true;
    try {
      await adminCancelAppointment(state.cancelId, text);
      close();
      goToList(listHref(), { message: "Запись отменена. Слот свободен." });
    } catch (error) {
      confirmBtn.disabled = false;
      warning.hidden = false;
      warning.querySelector("p").textContent = error.message || "Не удалось отменить";
    }
  });

  return {
    open(id) {
      state.cancelId = id;
      reason.value = "";
      warning.hidden = true;
      overlay.hidden = false;
    },
  };
}

function bindOverlapModal() {
  const overlay = document.getElementById("overlap-overlay");
  const confirmBtn = document.getElementById("overlap-confirm");
  const body = document.getElementById("overlap-body");

  function close() {
    overlay.hidden = true;
    confirmBtn.disabled = false;
  }

  overlay.querySelectorAll("[data-overlap-dismiss]").forEach((button) => {
    button.addEventListener("click", close);
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  confirmBtn.addEventListener("click", async () => {
    if (!state.overlap) {
      return;
    }
    confirmBtn.disabled = true;
    try {
      await state.overlap.submit(true);
      close();
    } catch (error) {
      confirmBtn.disabled = false;
      document.querySelector("#overlap-warning p").textContent = error.message || "Не удалось сохранить";
    }
  });

  return {
    open(message, submit) {
      state.overlap = { submit };
      body.textContent = message || "На это время уже есть запись. Создать вторую поверх занятого слота?";
      document.querySelector("#overlap-warning p").textContent = message || "Это время уже занято";
      overlay.hidden = false;
    },
  };
}

async function confirmVisit(id) {
  try {
    await adminConfirmAppointment(id);
    goToList(listHref(), { message: "Предоплата подтверждена." });
  } catch (error) {
    setListError(error.message || "Не удалось подтвердить запись");
  }
}

function bindListActions(cancelModal, blockModal, visits, blocks) {
  document.getElementById("day-prev")?.addEventListener("click", () => {
    goToList(listHref({ date: addDaysYmd(state.date, -1) }));
  });
  document.getElementById("day-next")?.addEventListener("click", () => {
    goToList(listHref({ date: addDaysYmd(state.date, 1) }));
  });
  document.getElementById("day-input")?.addEventListener("change", (event) => {
    const value = event.target.value;
    if (value) {
      goToList(listHref({ date: value }));
    }
  });
  document.getElementById("master_filter")?.addEventListener("change", (event) => {
    const value = Number(event.target.value);
    goToList(listHref({ masterId: Number.isInteger(value) && value > 0 ? value : null }));
  });
  document.querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", () => confirmVisit(Number(button.getAttribute("data-confirm"))));
  });
  document.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelModal.open(Number(button.getAttribute("data-cancel"))));
  });
  document.querySelectorAll("[data-unblock]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.getAttribute("data-unblock"));
      const row = blocks.find((item) => item.id === id);
      if (row) {
        blockModal.open(row);
      }
    });
  });
}

function selectedServiceIds(form) {
  return [...form.querySelectorAll('input[name="service_ids"]:checked')]
    .map((input) => Number(input.value))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function renderServiceFlags(masterId) {
  const root = document.getElementById("service-flags");
  if (!root) {
    return;
  }
  const master = state.masters.find((row) => row.id === masterId);
  const allowed = new Set(master?.service_ids || []);
  const rows = state.services.filter((row) => row.is_bookable && row.is_active !== false && allowed.has(row.id));
  if (!rows.length) {
    root.innerHTML = `<p class="meta">У мастера нет записываемых услуг.</p>`;
    return;
  }
  root.innerHTML = rows
    .map(
      (row) => `<label class="admin-flag">
        <span class="booking-check">
          <input type="checkbox" name="service_ids" value="${row.id}" />
          <span class="booking-check__box" aria-hidden="true"><span class="icon icon--check"></span></span>
          <span class="body-medium">${escapeHtml(row.name)}</span>
        </span>
      </label>`,
    )
    .join("");
}

function slotButton(slot, { selected = false, busy = false } = {}) {
  const classes = ["time-slot"];
  if (selected) {
    classes.push("time-slot--selected");
  }
  if (busy) {
    classes.push("time-slot--busy");
  }
  return `<button class="${classes.join(" ")}" type="button" data-starts-at="${escapeHtml(slot.starts_at)}" data-busy="${busy ? "1" : "0"}">${escapeHtml(slot.starts_local || formatLocalHm(slot.starts_at))}</button>`;
}

async function loadCreateSlots(form, overlapModal) {
  const box = document.getElementById("slots-block");
  const submit = document.getElementById("create-submit");
  const starts = document.getElementById("starts_at");
  const masterId = Number(form.master_id.value);
  const date = form.date.value;
  const serviceIds = selectedServiceIds(form);
  starts.value = "";
  submit.disabled = true;
  if (!masterId || !date || !serviceIds.length) {
    box.innerHTML = `<p class="meta">Выберите мастера, услуги и дату — появятся окна.</p>`;
    return;
  }
  box.innerHTML = `<p class="meta" role="status">Загрузка окон…</p>`;
  try {
    const [availability, day] = await Promise.all([
      getAvailability(masterId, { date, serviceIds }),
      adminListAppointments({ date, masterId }),
    ]);
    const free = availability.slots || [];
    const busy = (day.appointments || []).filter(
      (row) =>
        row.status === "pending_prepayment" || row.status === "confirmed" || row.status === "rescheduled",
    );
    if (!free.length && !busy.length) {
      box.innerHTML = `<p class="meta">На эту дату свободных и занятых окон нет.</p>`;
      return;
    }
    box.innerHTML = `
      ${free.length ? `<p class="label-caps">Свободно</p><div class="booking-slots-grid" id="free-slots">${free.map((slot) => slotButton(slot)).join("")}</div>` : ""}
      ${busy.length ? `<p class="label-caps">Занято</p><div class="booking-slots-grid" id="busy-slots">${busy.map((row) => slotButton({ starts_at: row.starts_at }, { busy: true })).join("")}</div>` : ""}
    `;
    box.querySelectorAll(".time-slot").forEach((button) => {
      button.addEventListener("click", () => {
        box.querySelectorAll(".time-slot").forEach((node) => node.classList.remove("time-slot--selected"));
        button.classList.add("time-slot--selected");
        starts.value = button.getAttribute("data-starts-at") || "";
        submit.disabled = !starts.value;
      });
    });
  } catch (error) {
    box.innerHTML = "";
    showFormError(form, error);
  }
}

async function submitCreate(form, overlapModal, overlapOverride) {
  const payload = {
    client_email: String(form.client_email.value || "").trim(),
    master_id: Number(form.master_id.value),
    service_ids: selectedServiceIds(form),
    starts_at: form.starts_at.value,
  };
  if (overlapOverride) {
    payload.overlap_override = true;
  }
  const created = await adminCreateAppointment(payload);
  goToList(listHref({ date: form.date.value || state.date, masterId: payload.master_id }), {
    message: created.appointment?.overlapping
      ? "Запись создана поверх занятого времени."
      : "Запись создана.",
  });
}

function bindCreateForm(overlapModal) {
  const form = document.getElementById("create-form");
  const reload = () => loadCreateSlots(form, overlapModal);
  form.master_id.addEventListener("change", () => {
    renderServiceFlags(Number(form.master_id.value));
    reload();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "service_ids" || event.target.name === "date") {
      reload();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetFormErrors(form);
    try {
      await submitCreate(form, overlapModal, false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
        overlapModal.open(error.message, async (confirmed) => {
          if (!confirmed) {
            return;
          }
          await submitCreate(form, overlapModal, true);
        });
        return;
      }
      showFormError(form, error);
    }
  });
  renderServiceFlags(Number(form.master_id.value));
  reload();
}

function bindReschedule(appointment, overlapModal) {
  const picker = {
    viewYear: 0,
    viewMonth: 0,
    selectedYmd: "",
    selectedStartsAt: "",
    slots: [],
  };
  const today = todayYmd();
  const currentYmd = ymdFromInstant(appointment.starts_at) || today;
  picker.selectedYmd = currentYmd >= today ? currentYmd : today;
  const parts = parseYmd(picker.selectedYmd);
  picker.viewYear = parts.year;
  picker.viewMonth = parts.month - 1;
  const serviceIds = (appointment.services || []).map((row) => row.id);
  const submit = document.getElementById("reschedule-submit");

  function syncSubmit() {
    submit.disabled = !picker.selectedStartsAt || picker.selectedStartsAt === appointment.starts_at;
  }

  function renderMonth() {
    const title = document.getElementById("month-title");
    const grid = document.getElementById("calendar-grid");
    const date = new Date(Date.UTC(picker.viewYear, picker.viewMonth, 1, 12));
    title.textContent = date.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
    const first = ymdInMonth(picker.viewYear, picker.viewMonth, 1);
    const pad = weekdayMonIndex(first);
    const count = daysInMonth(picker.viewYear, picker.viewMonth);
    const cells = [];
    for (let i = 0; i < pad; i += 1) {
      cells.push(`<div class="cal-day cal-day--pad" aria-hidden="true"></div>`);
    }
    for (let day = 1; day <= count; day += 1) {
      const ymd = ymdInMonth(picker.viewYear, picker.viewMonth, day);
      const selected = ymd === picker.selectedYmd;
      const unavailable = ymd < today;
      const classes = ["cal-day"];
      if (selected) {
        classes.push("cal-day--selected");
      } else if (unavailable) {
        classes.push("cal-day--unavailable");
      }
      cells.push(
        `<button class="${classes.join(" ")}" type="button" data-date="${ymd}" ${unavailable ? "disabled" : ""}>${day}</button>`,
      );
    }
    grid.innerHTML = cells.join("");
  }

  async function loadDay() {
    const box = document.getElementById("slots-block");
    box.innerHTML = `<p class="meta" role="status">Загрузка окон…</p>`;
    try {
      const data = await getAvailability(appointment.master.id, {
        date: picker.selectedYmd,
        serviceIds,
        excludeAppointmentId: appointment.id,
      });
      picker.slots = data.slots || [];
      if (!picker.slots.length) {
        box.innerHTML = `<p class="meta">На эту дату свободных окон нет. Можно выбрать занятый слот после предупреждения — укажите другое время из календаря или дату с окнами.</p>`;
        return;
      }
      box.innerHTML = `<p class="label-caps">Свободное время</p><div class="booking-slots-grid">${picker.slots
        .map((slot) => slotButton(slot, { selected: slot.starts_at === picker.selectedStartsAt }))
        .join("")}</div>`;
      box.querySelectorAll(".time-slot").forEach((button) => {
        button.addEventListener("click", () => {
          picker.selectedStartsAt = button.getAttribute("data-starts-at") || "";
          loadDay();
          syncSubmit();
        });
      });
    } catch (error) {
      box.innerHTML = "";
      setListError(error.message || "Не удалось загрузить окна");
    }
  }

  document.getElementById("month-prev").addEventListener("click", () => {
    if (picker.viewMonth === 0) {
      picker.viewYear -= 1;
      picker.viewMonth = 11;
    } else {
      picker.viewMonth -= 1;
    }
    renderMonth();
  });
  document.getElementById("month-next").addEventListener("click", () => {
    if (picker.viewMonth === 11) {
      picker.viewYear += 1;
      picker.viewMonth = 0;
    } else {
      picker.viewMonth += 1;
    }
    renderMonth();
  });
  document.getElementById("calendar-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button || button.disabled) {
      return;
    }
    picker.selectedYmd = button.dataset.date;
    picker.selectedStartsAt = "";
    renderMonth();
    loadDay();
    syncSubmit();
  });
  submit.addEventListener("click", async () => {
    setListError("");
    try {
      await adminRescheduleAppointment(appointment.id, { starts_at: picker.selectedStartsAt });
      goToList(listHref(), { message: "Запись перенесена." });
    } catch (error) {
      if (error instanceof ApiError && error.code === "SLOT_TAKEN") {
        overlapModal.open(error.message, async () => {
          await adminRescheduleAppointment(appointment.id, {
            starts_at: picker.selectedStartsAt,
            overlap_override: true,
          });
          goToList(listHref(), { message: "Запись перенесена поверх занятого времени." });
        });
        return;
      }
      setListError(error.message || "Не удалось перенести запись");
    }
  });
  renderMonth();
  loadDay();
  syncSubmit();
}

function bindBlockForm() {
  const form = document.getElementById("block-form");
  const kind = form.kind;
  function syncKind() {
    form.querySelectorAll("[data-kind]").forEach((node) => {
      node.hidden = node.getAttribute("data-kind") !== kind.value;
    });
  }
  kind.addEventListener("change", syncKind);
  syncKind();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetFormErrors(form);
    const payload = {
      master_id: Number(form.master_id.value),
      kind: kind.value,
      reason: String(form.reason.value || "").trim() || null,
    };
    if (kind.value === "break") {
      payload.date = form.date.value;
      payload.start_time = form.start_time.value;
      payload.end_time = form.end_time.value;
    } else if (kind.value === "day_off") {
      payload.date = form.day_off_date.value;
    } else {
      payload.starts_on = form.starts_on.value;
      payload.ends_on = form.ends_on.value;
    }
    try {
      await adminCreateTimeBlock(payload);
      goToList(listHref({ date: payload.date || payload.starts_on || state.date, masterId: payload.master_id }), {
        message: "Время заблокировано. Клиенту эти часы больше не предлагаются.",
      });
    } catch (error) {
      showFormError(form, error);
    }
  });
}

async function init() {
  const root = document.getElementById("admin-root");
  const flash = takeFlash();
  readListFilters();
  const cancelModal = bindCancelModal();
  const overlapModal = bindOverlapModal();
  const blockModal = bindDeleteModal({
    overlay: document.getElementById("delete-overlay"),
    title: () => "Снять блокировку?",
    body: (item) => `${KIND_LABELS[item.kind] || "Блокировка"} · ${masterName(item.master)}`,
    onConfirm: async (id, { close }) => {
      await adminDeleteTimeBlock(id);
      close();
      goToList(listHref(), { message: "Блокировка снята." });
    },
  });

  try {
    const [masters, services] = await Promise.all([adminListMasters(), adminListServices()]);
    state.masters = masters;
    state.services = services;
  } catch (error) {
    root.innerHTML = `<div class="booking-intro"><h1 class="heading-1">Записи</h1></div><p class="error">${escapeHtml(error.message || "Не удалось загрузить справочники")}</p>`;
    return;
  }

  const view = viewFromPage();

  if (view.mode === "new") {
    root.innerHTML = createMarkup();
    bindCreateForm(overlapModal);
    return;
  }

  if (view.mode === "block") {
    root.innerHTML = blockMarkup();
    bindBlockForm();
    return;
  }

  if (view.mode === "reschedule") {
    try {
      const body = await getAppointment(view.id);
      root.innerHTML = rescheduleMarkup(body.appointment);
      bindReschedule(body.appointment, overlapModal);
    } catch (error) {
      root.innerHTML = detailsMarkup({ status: "cancelled", services: [], master: {} }, flash);
      setListError(error.message || "Запись не найдена");
    }
    return;
  }

  if (view.mode === "details") {
    try {
      const body = await getAppointment(view.id);
      root.innerHTML = detailsMarkup(body.appointment, flash);
      document.querySelector("[data-confirm]")?.addEventListener("click", () =>
        confirmVisit(body.appointment.id),
      );
      document.querySelector("[data-cancel]")?.addEventListener("click", () =>
        cancelModal.open(body.appointment.id),
      );
    } catch (error) {
      root.innerHTML = `<div class="booking-intro"><h1 class="heading-1">Запись</h1></div><p class="error">${escapeHtml(error.message || "Запись не найдена")}</p><a class="button button--ghost button--large" href="${listHref()}">Назад</a>`;
    }
    return;
  }

  try {
    const data = await adminListAppointments({
      date: state.date,
      masterId: state.masterId,
    });
    root.innerHTML = listMarkup(data, flash);
    bindListActions(cancelModal, blockModal, data.appointments || [], data.time_blocks || []);
  } catch (error) {
    root.innerHTML = listMarkup({ appointments: [], time_blocks: [] }, flash);
    setListError(error.message || "Не удалось загрузить записи");
    bindListActions(cancelModal, blockModal, [], []);
  }
}

init();
