import { applyServerError, clearFormErrors, setAlert } from "./form.js";
import { escapeHtml } from "./format.js";

const FLASH_KEY = "nogotochki_admin_flash";

export function setFlash(message, kind = "success") {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, kind }));
}

export function takeFlash() {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function viewFromQuery() {
  const params = new URLSearchParams(location.search);
  if (params.has("new")) {
    return { mode: "new", id: null };
  }
  const id = Number(params.get("id"));
  if (Number.isInteger(id) && id > 0) {
    return { mode: "edit", id };
  }
  return { mode: "list", id: null };
}

export function goToList(path, flash) {
  if (flash?.message) {
    setFlash(flash.message, flash.kind || "success");
  }
  window.location.href = path;
}

export function flashMarkup(flash) {
  if (!flash?.message) {
    return "";
  }
  const extra = flash.kind === "warning" ? " banner--warning" : " banner--success";
  return `<div class="banner${extra}" id="admin-flash">
    <span class="icon icon--alert" aria-hidden="true"></span>
    <p class="body-small">${escapeHtml(flash.message)}</p>
  </div>`;
}

export function alertMarkup() {
  return `<div class="alert" id="form-alert">
    <span class="icon icon--alert" aria-hidden="true"></span>
    <p class="body-small"></p>
  </div>`;
}

export function emptyMarkup(text) {
  return `<div class="empty">
    <h2 class="heading-3">Пока пусто</h2>
    <p class="body-medium">${escapeHtml(text)}</p>
  </div>`;
}

export function fieldMarkup({ name, label, type = "text", value = "", required = false, extra = "" }) {
  const req = required ? " required" : "";
  return `<div class="field" data-field="${escapeHtml(name)}">
    <label class="label-caps" for="${escapeHtml(name)}">${escapeHtml(label)}</label>
    <input class="input" id="${escapeHtml(name)}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${req} ${extra} />
    <p class="field-error" data-error-for="${escapeHtml(name)}"></p>
  </div>`;
}

export function flagMarkup({ name, label, checked }) {
  return `<label class="admin-flag">
    <span class="booking-check">
      <input type="checkbox" name="${escapeHtml(name)}" ${checked ? "checked" : ""} />
      <span class="booking-check__box" aria-hidden="true">
        <span class="icon icon--check"></span>
      </span>
      <span class="body-medium">${escapeHtml(label)}</span>
    </span>
  </label>`;
}

export function badgeMarkup(label, extra = "booking-badge--cancelled") {
  return `<div class="booking-badge ${extra}">
    <span class="booking-badge__dot" aria-hidden="true"></span>
    <span class="meta">${escapeHtml(label)}</span>
  </div>`;
}

export function bindDeleteModal({ overlay, title, body, onConfirm }) {
  const titleEl = overlay.querySelector("#delete-title");
  const bodyEl = overlay.querySelector("#delete-body");
  const warning = overlay.querySelector("#delete-warning");
  const confirmBtn = overlay.querySelector("#delete-confirm");
  const dismissBtns = overlay.querySelectorAll("[data-delete-dismiss]");

  function close() {
    overlay.hidden = true;
    if (warning) {
      warning.hidden = true;
      warning.querySelector("p").textContent = "";
    }
    confirmBtn.disabled = false;
  }

  function open(item) {
    titleEl.textContent = title(item);
    bodyEl.textContent = body(item);
    if (warning) {
      warning.hidden = true;
    }
    overlay.hidden = false;
    overlay.dataset.id = String(item.id);
  }

  dismissBtns.forEach((button) => button.addEventListener("click", close));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      close();
    }
  });
  confirmBtn.addEventListener("click", async () => {
    const id = Number(overlay.dataset.id);
    confirmBtn.disabled = true;
    try {
      await onConfirm(id, { close, warning, confirmBtn });
    } catch (error) {
      confirmBtn.disabled = false;
      if (warning) {
        warning.hidden = false;
        warning.querySelector("p").textContent = error.message || "Не удалось удалить";
      }
    }
  });

  return { open, close };
}

export function showFormError(form, error) {
  applyServerError(form, form.querySelector("#form-alert"), error);
}

export function resetFormErrors(form) {
  clearFormErrors(form, form.querySelector("#form-alert"));
}

export function setFormAlert(form, message) {
  setAlert(form.querySelector("#form-alert"), message);
}

export function checkedFlag(form, name) {
  return form.querySelector(`input[name="${name}"]`)?.checked ? 1 : 0;
}

export function optionalInteger(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const number = Number(raw);
  return Number.isInteger(number) ? number : Number.NaN;
}
