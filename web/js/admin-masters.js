import {
  adminCreateMaster,
  adminDeleteMaster,
  adminListMasters,
  adminListServices,
  adminUpdateMaster,
} from "./api.js";
import {
  alertMarkup,
  badgeMarkup,
  bindDeleteModal,
  checkedFlag,
  emptyMarkup,
  fieldMarkup,
  flagMarkup,
  flashMarkup,
  goToList,
  resetFormErrors,
  showFormError,
  takeFlash,
  viewFromQuery,
} from "./admin-common.js";
import { escapeHtml, masterName, weekdayLabel } from "./format.js";

const LIST_PATH = "/admin/masters";

function serviceNameMap(services) {
  const map = new Map();
  services.forEach((row) => map.set(row.id, row.name));
  return map;
}

function serviceChips(master, names) {
  const ids = Array.isArray(master.service_ids) ? master.service_ids : [];
  if (!ids.length) {
    return `<p class="meta meta-muted">Услуги не отмечены</p>`;
  }
  return `<div class="admin-chips">${ids
    .map((id) => `<span class="admin-chip">${escapeHtml(names.get(id) || `Услуга ${id}`)}</span>`)
    .join("")}</div>`;
}

function scheduleText(master) {
  const rows = Array.isArray(master.schedule) ? master.schedule : [];
  if (!rows.length) {
    return "График не задан";
  }
  return rows
    .map((row) => `${weekdayLabel(row.weekday)} ${row.start_time}–${row.end_time}`)
    .join(", ");
}

function listCard(master, names) {
  const off = master.is_active ? "" : " admin-card--off";
  const toggleLabel = master.is_active ? "Отключить" : "Включить";
  const badge = master.is_active ? "" : badgeMarkup("Отключён");
  return `<article class="admin-card${off}">
    <div class="admin-card__head">
      <h2 class="heading-4">${escapeHtml(masterName(master))}</h2>
      ${badge}
    </div>
    <p class="body-small">${escapeHtml(master.specialization_label || "")}</p>
    ${serviceChips(master, names)}
    <p class="meta">${escapeHtml(scheduleText(master))}</p>
    <div class="admin-card__actions">
      <a class="button button--ghost button--small" href="${LIST_PATH}?id=${master.id}">Изменить</a>
      <button class="button button--text button--small" type="button" data-toggle="${master.id}">${toggleLabel}</button>
      <button class="button button--text button--small" type="button" data-delete="${master.id}">Удалить</button>
    </div>
  </article>`;
}

function listMarkup(masters, services, flash) {
  const names = serviceNameMap(services);
  const body = masters.length
    ? `<div class="admin-list">${masters.map((row) => listCard(row, names)).join("")}</div>`
    : emptyMarkup("Добавьте мастера и отметьте услуги, которые он выполняет.");
  return `
    <div class="admin-toolbar">
      <div class="booking-intro">
        <h1 class="heading-1">Мастера</h1>
        <p class="body-medium">Все мастера студии, включая отключённых. Клиент видит только активных и только под свой набор услуг.</p>
      </div>
      <a class="button button--primary button--large" href="${LIST_PATH}?new=1">Добавить</a>
    </div>
    ${flashMarkup(flash)}
    <p class="error" id="list-error"></p>
    ${body}
  `;
}

function weekdayOptions(selected) {
  return [1, 2, 3, 4, 5, 6, 7]
    .map((day) => {
      const current = Number(selected) === day ? " selected" : "";
      return `<option value="${day}"${current}>${escapeHtml(weekdayLabel(day))}</option>`;
    })
    .join("");
}

function scheduleRowMarkup(row = {}) {
  return `<div class="admin-schedule__row">
    <div class="field">
      <label class="label-caps">День</label>
      <select class="input" name="weekday">${weekdayOptions(row.weekday || 1)}</select>
    </div>
    <div class="field">
      <label class="label-caps">С</label>
      <input class="input" type="time" name="start_time" value="${escapeHtml(row.start_time || "10:00")}" />
    </div>
    <div class="field">
      <label class="label-caps">До</label>
      <input class="input" type="time" name="end_time" value="${escapeHtml(row.end_time || "18:00")}" />
    </div>
    <button class="button button--text button--small" type="button" data-remove-window>Убрать</button>
  </div>`;
}

function bookableServices(services) {
  return services.filter((row) => row.is_bookable);
}

function serviceFlags(services, selectedIds) {
  const selected = new Set(selectedIds || []);
  const rows = bookableServices(services);
  if (!rows.length) {
    return `<p class="meta meta-muted">Нет записываемых услуг, которые можно привязать.</p>`;
  }
  return `<div class="admin-flags">${rows
    .map((row) => {
      const label = row.is_active ? row.name : `${row.name} (отключена)`;
      return flagMarkup({
        name: "service_ids",
        label,
        checked: selected.has(row.id),
      }).replace('name="service_ids"', `name="service_ids" value="${row.id}"`);
    })
    .join("")}</div>`;
}

function formMarkup(master, services) {
  const isNew = !master;
  const title = isNew ? "Новый мастер" : "Мастер";
  const schedule = Array.isArray(master?.schedule) && master.schedule.length ? master.schedule : [{}];
  return `
    <div class="booking-intro">
      <h1 class="heading-1">${title}</h1>
      <p class="body-medium">Имя можно не заполнять — на экране будет «Мастер студии». Отметьте услуги, которые мастер выполняет.</p>
    </div>
    <form class="admin-form" id="master-form" novalidate>
      ${alertMarkup()}
      ${fieldMarkup({ name: "display_name", label: "Имя (необязательно)", value: master?.display_name || "" })}
      ${fieldMarkup({
        name: "specialization_label",
        label: "Специализация",
        value: master?.specialization_label || "",
        required: true,
      })}
      <div class="field">
        <p class="label-caps">Услуги</p>
        ${serviceFlags(services, master?.service_ids)}
      </div>
      <div class="field">
        <p class="label-caps">График</p>
        <div class="admin-schedule" id="schedule-rows">
          ${schedule.map((row) => scheduleRowMarkup(row)).join("")}
        </div>
        <button class="button button--text button--small" type="button" id="add-window">Добавить окно</button>
      </div>
      ${
        isNew
          ? ""
          : `<div class="admin-flags">${flagMarkup({
              name: "is_active",
              label: "Включён",
              checked: Boolean(master.is_active),
            })}</div>`
      }
      <div class="admin-form-actions">
        <a class="button button--ghost button--large" href="${LIST_PATH}">Назад</a>
        <button class="button button--primary button--large" type="submit">${isNew ? "Создать" : "Сохранить"}</button>
        ${isNew ? "" : `<button class="button button--text button--large" type="button" id="form-delete">Удалить</button>`}
      </div>
    </form>
  `;
}

function hmValue(value) {
  const raw = String(value || "").trim();
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

function payloadFromForm(form, { includeActive }) {
  const data = new FormData(form);
  const serviceIds = [...form.querySelectorAll('input[name="service_ids"]:checked')].map((input) =>
    Number(input.value),
  );
  const schedule = [];
  form.querySelectorAll(".admin-schedule__row").forEach((row) => {
    const weekday = Number(row.querySelector('[name="weekday"]')?.value);
    const startTime = hmValue(row.querySelector('[name="start_time"]')?.value);
    const endTime = hmValue(row.querySelector('[name="end_time"]')?.value);
    if (!weekday || !startTime || !endTime) {
      return;
    }
    schedule.push({ weekday, start_time: startTime, end_time: endTime });
  });
  const payload = {
    display_name: String(data.get("display_name") || "").trim(),
    specialization_label: String(data.get("specialization_label") || "").trim(),
    service_ids: serviceIds,
    schedule,
  };
  if (includeActive) {
    payload.is_active = checkedFlag(form, "is_active");
  }
  return payload;
}

function bindSchedule(root) {
  const box = root.querySelector("#schedule-rows");
  root.querySelector("#add-window")?.addEventListener("click", () => {
    box.insertAdjacentHTML("beforeend", scheduleRowMarkup());
  });
  box.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-window]");
    if (!button) {
      return;
    }
    const row = button.closest(".admin-schedule__row");
    if (box.querySelectorAll(".admin-schedule__row").length > 1) {
      row.remove();
    } else {
      row.querySelector('[name="start_time"]').value = "";
      row.querySelector('[name="end_time"]').value = "";
    }
  });
}

async function init() {
  const root = document.getElementById("admin-root");
  const overlay = document.getElementById("delete-overlay");
  const view = viewFromQuery();
  const flash = takeFlash();

  let masters = [];
  let services = [];
  try {
    [masters, services] = await Promise.all([adminListMasters(), adminListServices()]);
  } catch (error) {
    root.innerHTML = listMarkup([], [], flash);
    const err = document.getElementById("list-error");
    if (err) {
      err.textContent = error.message || "Не удалось загрузить мастеров";
    }
    return;
  }

  const modal = bindDeleteModal({
    overlay,
    title: () => "Удалить мастера?",
    body: (item) =>
      `«${masterName(item)}». Если на него уже есть записи, сервер отключит строку, а не удалит её из базы.`,
    onConfirm: async (id, { close }) => {
      const result = await adminDeleteMaster(id);
      close();
      if (result.deleted) {
        goToList(LIST_PATH, { message: "Мастер удалён." });
        return;
      }
      goToList(LIST_PATH, {
        message: result.message || "Мастер отключён, потому что на него есть записи.",
        kind: "warning",
      });
    },
  });

  if (view.mode === "list") {
    root.innerHTML = listMarkup(masters, services, flash);
    root.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.getAttribute("data-toggle"));
        const row = masters.find((item) => item.id === id);
        button.disabled = true;
        try {
          await adminUpdateMaster(id, { is_active: row?.is_active ? 0 : 1 });
          goToList(LIST_PATH, {
            message: row?.is_active ? "Мастер отключён." : "Мастер включён.",
          });
        } catch (error) {
          button.disabled = false;
          const err = document.getElementById("list-error");
          if (err) {
            err.textContent = error.message || "Не удалось изменить мастера";
          }
        }
      });
    });
    root.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.getAttribute("data-delete"));
        const row = masters.find((item) => item.id === id);
        if (row) {
          modal.open(row);
        }
      });
    });
    return;
  }

  const current = view.mode === "edit" ? masters.find((row) => row.id === view.id) : null;
  if (view.mode === "edit" && !current) {
    root.innerHTML = listMarkup(masters, services, flash);
    const err = document.getElementById("list-error");
    if (err) {
      err.textContent = "Мастер не найден";
    }
    return;
  }

  root.innerHTML = formMarkup(current, services);
  bindSchedule(root);
  const form = document.getElementById("master-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetFormErrors(form);
    const payload = payloadFromForm(form, { includeActive: Boolean(current) });
    try {
      if (current) {
        await adminUpdateMaster(current.id, payload);
        goToList(LIST_PATH, { message: "Мастер сохранён." });
      } else {
        await adminCreateMaster(payload);
        goToList(LIST_PATH, { message: "Мастер создан." });
      }
    } catch (error) {
      showFormError(form, error);
    }
  });

  document.getElementById("form-delete")?.addEventListener("click", () => {
    modal.open(current);
  });
}

init();
