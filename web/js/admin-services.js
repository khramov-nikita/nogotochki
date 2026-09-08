import {
  adminCreateService,
  adminDeleteService,
  adminListServices,
  adminUpdateService,
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
  optionalInteger,
  resetFormErrors,
  showFormError,
  takeFlash,
  viewFromQuery,
} from "./admin-common.js";
import { escapeHtml, formatServiceDuration, formatServicePrice } from "./format.js";

const LIST_PATH = "/admin/services";

function statusBadges(service) {
  const badges = [];
  if (!service.is_active) {
    badges.push(badgeMarkup("Отключена"));
  }
  if (!service.is_bookable) {
    badges.push(badgeMarkup("Не в записи", "booking-badge--cancelled"));
  }
  if (service.is_addon) {
    badges.push(badgeMarkup("Добавка", "booking-badge--cancelled"));
  }
  return badges.join("");
}

function listCard(service) {
  const off = service.is_active ? "" : " admin-card--off";
  const toggleLabel = service.is_active ? "Отключить" : "Включить";
  return `<article class="admin-card${off}">
    <div class="admin-card__head">
      <h2 class="heading-4">${escapeHtml(service.name)}</h2>
      <div class="admin-chips">${statusBadges(service)}</div>
    </div>
    <p class="meta">${escapeHtml(service.slug)}</p>
    <p class="meta">${escapeHtml(formatServicePrice(service))} · ${escapeHtml(formatServiceDuration(service) || "без длительности")}</p>
    <div class="admin-card__actions">
      <a class="button button--ghost button--small" href="${LIST_PATH}?id=${service.id}">Изменить</a>
      <button class="button button--text button--small" type="button" data-toggle="${service.id}">${toggleLabel}</button>
      <button class="button button--text button--small" type="button" data-delete="${service.id}">Удалить</button>
    </div>
  </article>`;
}

function listMarkup(services, flash) {
  const body = services.length
    ? `<div class="admin-list">${services.map(listCard).join("")}</div>`
    : emptyMarkup("Добавьте первую услугу в прайс студии.");
  return `
    <div class="admin-toolbar">
      <div class="booking-intro">
        <h1 class="heading-1">Услуги</h1>
        <p class="body-medium">Весь прайс студии, включая сертификат и отключённые позиции.</p>
      </div>
      <a class="button button--primary button--large" href="${LIST_PATH}?new=1">Добавить</a>
    </div>
    ${flashMarkup(flash)}
    <p class="error" id="list-error"></p>
    ${body}
  `;
}

function formMarkup(service) {
  const isNew = !service;
  const title = isNew ? "Новая услуга" : "Услуга";
  const intro = isNew
    ? "Название, цена и длительность проверяются на сервере."
    : "Сохраните изменения или отключите позицию, не удаляя историю записей.";
  const durationMin = service?.duration_min_minutes ?? "";
  const durationMax = service?.duration_max_minutes ?? "";
  return `
    <div class="booking-intro">
      <h1 class="heading-1">${title}</h1>
      <p class="body-medium">${intro}</p>
    </div>
    <form class="admin-form" id="service-form" novalidate>
      ${alertMarkup()}
      ${fieldMarkup({
        name: "slug",
        label: "Ключ (slug)",
        value: service?.slug || "",
        required: true,
        extra: 'pattern="[a-z0-9_]{2,64}" placeholder="manicure_gel"',
      })}
      ${fieldMarkup({ name: "name", label: "Название", value: service?.name || "", required: true })}
      ${fieldMarkup({
        name: "price_rub",
        label: "Цена, ₽",
        type: "number",
        value: service?.price_rub ?? "",
        required: true,
        extra: 'min="1" step="1"',
      })}
      <div class="admin-pair">
        ${fieldMarkup({
          name: "duration_min_minutes",
          label: "Длительность от, мин",
          type: "number",
          value: durationMin,
          extra: 'min="1" step="1"',
        })}
        ${fieldMarkup({
          name: "duration_max_minutes",
          label: "Длительность до, мин",
          type: "number",
          value: durationMax,
          extra: 'min="1" step="1"',
        })}
      </div>
      ${fieldMarkup({
        name: "price_rub_alt",
        label: "Вторая цена, ₽",
        type: "number",
        value: service?.price_rub_alt ?? "",
        extra: 'min="1" step="1"',
      })}
      ${fieldMarkup({
        name: "validity_months",
        label: "Срок сертификата, мес.",
        type: "number",
        value: service?.validity_months ?? "",
        extra: 'min="1" step="1"',
      })}
      <div class="admin-flags">
        ${flagMarkup({ name: "is_addon", label: "Добавка к сеансу", checked: Boolean(service?.is_addon) })}
        ${flagMarkup({
          name: "is_bookable",
          label: "Можно записать в слот",
          checked: service ? Boolean(service.is_bookable) : true,
        })}
        ${flagMarkup({
          name: "is_active",
          label: "Включена",
          checked: service ? Boolean(service.is_active) : true,
        })}
      </div>
      <div class="admin-form-actions">
        <a class="button button--ghost button--large" href="${LIST_PATH}">Назад</a>
        <button class="button button--primary button--large" type="submit">${isNew ? "Создать" : "Сохранить"}</button>
        ${isNew ? "" : `<button class="button button--text button--large" type="button" id="form-delete">Удалить</button>`}
      </div>
    </form>
  `;
}

function payloadFromForm(form) {
  const data = new FormData(form);
  const priceAlt = optionalInteger(data.get("price_rub_alt"));
  const validity = optionalInteger(data.get("validity_months"));
  const durationMin = optionalInteger(data.get("duration_min_minutes"));
  const durationMax = optionalInteger(data.get("duration_max_minutes"));
  return {
    slug: String(data.get("slug") || "").trim(),
    name: String(data.get("name") || "").trim(),
    price_rub: optionalInteger(data.get("price_rub")),
    duration_min_minutes: durationMin,
    duration_max_minutes: durationMax,
    price_rub_alt: priceAlt,
    validity_months: validity,
    is_addon: checkedFlag(form, "is_addon"),
    is_bookable: checkedFlag(form, "is_bookable"),
    is_active: checkedFlag(form, "is_active"),
  };
}

async function init() {
  const root = document.getElementById("admin-root");
  const overlay = document.getElementById("delete-overlay");
  const view = viewFromQuery();
  const flash = takeFlash();

  let services = [];
  try {
    services = await adminListServices();
  } catch (error) {
    root.innerHTML = listMarkup([], flash);
    const err = document.getElementById("list-error");
    if (err) {
      err.textContent = error.message || "Не удалось загрузить услуги";
    }
    return;
  }

  const modal = bindDeleteModal({
    overlay,
    title: () => "Удалить услугу?",
    body: (item) =>
      `«${item.name}». Если на неё уже есть записи, сервер отключит её, а не удалит из базы.`,
    onConfirm: async (id, { close }) => {
      const result = await adminDeleteService(id);
      close();
      if (result.deleted) {
        goToList(LIST_PATH, { message: "Услуга удалена." });
        return;
      }
      goToList(LIST_PATH, {
        message: result.message || "Услуга отключена, потому что на неё есть записи.",
        kind: "warning",
      });
    },
  });

  if (view.mode === "list") {
    root.innerHTML = listMarkup(services, flash);
    root.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.getAttribute("data-toggle"));
        const row = services.find((item) => item.id === id);
        button.disabled = true;
        try {
          await adminUpdateService(id, { is_active: row?.is_active ? 0 : 1 });
          goToList(LIST_PATH, {
            message: row?.is_active ? "Услуга отключена." : "Услуга включена.",
          });
        } catch (error) {
          button.disabled = false;
          const err = document.getElementById("list-error");
          if (err) {
            err.textContent = error.message || "Не удалось изменить услугу";
          }
        }
      });
    });
    root.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.getAttribute("data-delete"));
        const row = services.find((item) => item.id === id);
        if (row) {
          modal.open(row);
        }
      });
    });
    return;
  }

  const current = view.mode === "edit" ? services.find((row) => row.id === view.id) : null;
  if (view.mode === "edit" && !current) {
    root.innerHTML = listMarkup(services, flash);
    const err = document.getElementById("list-error");
    if (err) {
      err.textContent = "Услуга не найдена";
    }
    return;
  }

  root.innerHTML = formMarkup(current);
  const form = document.getElementById("service-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    resetFormErrors(form);
    const payload = payloadFromForm(form);
    try {
      if (current) {
        await adminUpdateService(current.id, payload);
        goToList(LIST_PATH, { message: "Услуга сохранена." });
      } else {
        await adminCreateService(payload);
        goToList(LIST_PATH, { message: "Услуга создана." });
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
