import { getServices } from "./api.js";
import { renderStepper } from "./booking-stepper.js";
import { escapeHtml, formatServiceDuration, formatServicePrice, formatVisitSummary } from "./format.js";
import { loadDraft, parseQuerySelection, saveDraft } from "./store.js";

function selectedIds(root) {
  return [...root.querySelectorAll('input[name="service_ids"]:checked')].map((input) => Number(input.value));
}

function serviceRow(service, checked) {
  const addonClass = service.is_addon ? " booking-service--addon" : "";
  return `<label class="booking-service${addonClass}">
    <span class="booking-check">
      <input type="checkbox" name="service_ids" value="${service.id}" ${checked ? "checked" : ""} />
      <span class="booking-check__box" aria-hidden="true">
        <span class="icon icon--check"></span>
      </span>
      <span class="body-medium">${escapeHtml(service.name)}</span>
    </span>
    <span class="booking-service-meta">
      <span class="price">${escapeHtml(formatServicePrice(service))}</span>
      <span class="meta meta-muted">${escapeHtml(formatServiceDuration(service))}</span>
    </span>
  </label>`;
}

function syncCta(services) {
  const ids = new Set(selectedIds(document));
  const selected = services.filter((row) => ids.has(row.id));
  const hasMain = selected.some((row) => !row.is_addon);
  const hasAddonOnly = selected.length > 0 && !hasMain;
  const alertEl = document.getElementById("form-alert");
  const nextBtn = document.getElementById("next-btn");
  const nextHint = document.getElementById("next-hint");
  const summary = document.getElementById("summary-value");

  summary.textContent = formatVisitSummary(selected);
  alertEl.classList.toggle("is-visible", hasAddonOnly);
  nextBtn.disabled = !hasMain;

  if (!selected.length) {
    nextHint.textContent = "Выберите услугу";
  } else if (hasAddonOnly) {
    nextHint.textContent = "Добавьте основную услугу";
  } else {
    nextHint.textContent = "";
  }

  saveDraft({ serviceIds: selected.map((row) => row.id) });
}

async function init() {
  document.getElementById("booking-stepper").innerHTML = renderStepper(1);

  const query = parseQuerySelection();
  if (query.serviceIds.length || query.masterId) {
    saveDraft({
      ...(query.serviceIds.length ? { serviceIds: query.serviceIds } : {}),
      ...(query.masterId ? { masterId: query.masterId } : {}),
    });
  }

  const draft = loadDraft();
  const errorEl = document.getElementById("services-error");
  let services = [];

  try {
    services = (await getServices()).filter((row) => row.is_bookable && row.is_active !== false);
  } catch (error) {
    errorEl.textContent = error.message || "Не удалось загрузить услуги";
    return;
  }

  const preselected = new Set(draft.serviceIds || []);
  const mains = services.filter((row) => !row.is_addon);
  const addons = services.filter((row) => row.is_addon);

  document.getElementById("services-main").innerHTML = mains.map((row) => serviceRow(row, preselected.has(row.id))).join("");

  const addonBlock = document.getElementById("addon-block");
  if (addons.length) {
    addonBlock.hidden = false;
    document.getElementById("services-addon").innerHTML = addons
      .map((row) => serviceRow(row, preselected.has(row.id)))
      .join("");
  }

  document.querySelector(".booking-column").addEventListener("change", (event) => {
    if (event.target.matches('input[name="service_ids"]')) {
      syncCta(services);
    }
  });

  document.getElementById("next-btn").addEventListener("click", () => {
    const ids = selectedIds(document);
    const selected = services.filter((row) => ids.includes(row.id));
    if (!selected.some((row) => !row.is_addon)) {
      return;
    }
    saveDraft({ serviceIds: ids });
    window.location.href = "booking-master.html";
  });

  syncCta(services);
}

init();
