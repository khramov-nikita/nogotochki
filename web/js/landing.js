import { getMasters, getServices } from "./api.js";
import { escapeHtml, formatServiceDuration, formatServicePrice, masterName } from "./format.js";

function serviceCard(service) {
  const duration = formatServiceDuration(service);
  const durationHtml = duration
    ? `<div class="duration">
        <span class="duration-icon" aria-hidden="true"></span>
        <p class="meta meta-muted">${escapeHtml(duration)}</p>
      </div>`
    : "";
  const description = service.description
    ? `<p class="body-small">${escapeHtml(service.description)}</p>`
    : "";
  const href = service.is_bookable
    ? `booking.html?service_ids=${encodeURIComponent(service.id)}`
    : "index.html#services";
  const label = service.is_bookable ? "Записаться" : "Условия в студии";

  return `<article class="service-card">
    <h3 class="heading-4">${escapeHtml(service.name)}</h3>
    ${description}
    <div class="service-meta">
      <p class="price">${escapeHtml(formatServicePrice(service))}</p>
      ${durationHtml}
    </div>
    <a class="button button--ghost button--small" href="${href}">${escapeHtml(label)}</a>
  </article>`;
}

function masterCard(master) {
  const portrait = master.portrait_path
    ? `<img class="portrait" src="${escapeHtml(master.portrait_path)}" alt="" />`
    : `<div class="portrait portrait--empty" aria-hidden="true"></div>`;

  return `<article class="master-card">
    ${portrait}
    <h3 class="heading-4">${escapeHtml(masterName(master))}</h3>
    <p class="body-small">${escapeHtml(master.specialization_label || "")}</p>
    <p class="meta meta-muted">Приём только по записи</p>
    <a class="button button--ghost button--medium" href="booking.html?master_id=${encodeURIComponent(master.id)}">Записаться к мастеру</a>
  </article>`;
}

async function fillList(grid, errorEl, loader, renderItem) {
  try {
    const rows = await loader();
    grid.innerHTML = rows.map(renderItem).join("");
  } catch (error) {
    errorEl.textContent = error.message || "Не удалось загрузить данные";
  }
}

const servicesGrid = document.getElementById("services-grid");
const mastersGrid = document.getElementById("masters-grid");
const servicesError = document.getElementById("services-error");
const mastersError = document.getElementById("masters-error");

fillList(servicesGrid, servicesError, getServices, serviceCard);
fillList(mastersGrid, mastersError, getMasters, masterCard);
