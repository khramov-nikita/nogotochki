import { getMasters, getServices } from "./api.js";
import { renderStepper } from "./booking-stepper.js";
import { escapeHtml, masterName } from "./format.js";
import { loadDraft, saveDraft } from "./store.js";

function hasMainService(services, serviceIds) {
  const selected = new Set(serviceIds || []);
  return services.some((row) => selected.has(row.id) && row.is_bookable && row.is_active !== false && !row.is_addon);
}

function masterRow(master, { selected, available }) {
  const disabled = !available;
  const checked = Boolean(selected) && !disabled;
  const stateClass = [
    checked ? "booking-master--selected" : "",
    disabled ? "booking-master--disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const portrait = master.portrait_path
    ? `<img class="portrait" src="${escapeHtml(master.portrait_path)}" alt="" />`
    : `<div class="portrait portrait--empty" aria-hidden="true"></div>`;
  const meta = disabled ? "Не выполняет выбранный набор" : "Приём только по записи";
  const label = checked ? "Выбран" : "Выбрать";

  return `<label class="booking-master ${stateClass}">
    <input type="radio" name="master_id" value="${master.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
    <span class="booking-radio-slot">
      <span class="booking-radio">
        <span class="booking-radio__control" aria-hidden="true"></span>
        <span class="body-medium">${label}</span>
      </span>
    </span>
    ${portrait}
    <span class="booking-master-card">
      <span class="heading-4">${escapeHtml(masterName(master))}</span>
      <span class="body-small">${escapeHtml(master.specialization_label || "")}</span>
      <span class="meta meta-muted">${escapeHtml(meta)}</span>
    </span>
  </label>`;
}

function syncCta(availableIds) {
  const selected = document.querySelector('input[name="master_id"]:checked');
  const nextBtn = document.getElementById("next-btn");
  const nextHint = document.getElementById("next-hint");
  const noneAvailable = availableIds.size === 0;
  const masterId = selected ? Number(selected.value) : null;
  const canContinue = Boolean(masterId) && availableIds.has(masterId);

  nextBtn.disabled = !canContinue;
  if (noneAvailable) {
    nextHint.textContent = "Измените услуги";
  } else if (!canContinue) {
    nextHint.textContent = "Выберите мастера";
  } else {
    nextHint.textContent = "";
  }

  document.querySelectorAll(".booking-master").forEach((row) => {
    const input = row.querySelector('input[name="master_id"]');
    const isSelected = input && !input.disabled && input.checked;
    row.classList.toggle("booking-master--selected", Boolean(isSelected));
    const label = row.querySelector(".booking-radio .body-medium");
    if (label && !row.classList.contains("booking-master--disabled")) {
      label.textContent = isSelected ? "Выбран" : "Выбрать";
    }
  });

  saveDraft({ masterId: canContinue ? masterId : null });
}

async function init() {
  document.getElementById("booking-stepper").innerHTML = renderStepper(2);

  const draft = loadDraft();
  const serviceIds = Array.isArray(draft.serviceIds) ? draft.serviceIds : [];
  const errorEl = document.getElementById("masters-error");

  let services = [];
  try {
    services = await getServices();
  } catch (error) {
    errorEl.textContent = error.message || "Не удалось загрузить услуги";
    return;
  }

  if (!hasMainService(services, serviceIds)) {
    window.location.replace("booking.html");
    return;
  }

  let allMasters = [];
  let capableMasters = [];
  try {
    [allMasters, capableMasters] = await Promise.all([getMasters(), getMasters(serviceIds)]);
  } catch (error) {
    errorEl.textContent = error.message || "Не удалось загрузить мастеров";
    return;
  }

  const availableIds = new Set(capableMasters.map((row) => row.id));
  const noneAvailable = availableIds.size === 0;
  let selectedId = Number(draft.masterId);
  if (!availableIds.has(selectedId)) {
    selectedId = noneAvailable ? null : capableMasters[0]?.id ?? null;
  }

  const intro = document.getElementById("master-intro");
  const banner = document.getElementById("no-master-banner");
  const backBtn = document.getElementById("back-btn");
  if (noneAvailable) {
    intro.textContent =
      "Ни один мастер из списка не принимает выбранный набор услуг. Вернитесь на шаг 1 и измените услуги.";
    banner.hidden = false;
    backBtn.textContent = "Изменить услуги";
  }

  document.getElementById("masters-list").innerHTML = allMasters
    .map((row) => masterRow(row, { selected: row.id === selectedId, available: availableIds.has(row.id) }))
    .join("");

  document.getElementById("masters-list").addEventListener("change", () => syncCta(availableIds));
  document.getElementById("next-btn").addEventListener("click", () => {
    const selected = document.querySelector('input[name="master_id"]:checked');
    const masterId = selected ? Number(selected.value) : null;
    if (!availableIds.has(masterId)) {
      return;
    }
    saveDraft({ masterId, serviceIds });
    window.location.href = "booking-datetime.html";
  });

  syncCta(availableIds);
}

init();
