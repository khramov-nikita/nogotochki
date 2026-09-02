import {
  escapeHtml,
  formatDurationMinutes,
  formatPrice,
  formatServiceDuration,
  formatVisitDateTime,
  formatVisitSummary,
  masterName,
} from "./format.js";

function visitDuration(visit) {
  return visit?.duration_minutes ?? visit?.duration_max_minutes ?? null;
}

function serviceNames(services) {
  return (services || []).map((row) => row.name).filter(Boolean).join(", ") || "—";
}

function servicesCostLabel(services) {
  const selected = (services || []).filter(Boolean);
  if (!selected.length) {
    return "—";
  }
  if (selected.length === 1) {
    const duration = formatServiceDuration(selected[0]);
    const price = formatPrice(selected[0].price_rub);
    return duration ? `${price} · ${duration}` : price;
  }
  return selected
    .map((row) => {
      const duration = formatServiceDuration(row);
      const price = formatPrice(row.price_rub);
      return duration ? `${price} · ${duration}` : price;
    })
    .join(", ");
}

function editLink(href) {
  return `<a class="visit-edit" href="${escapeHtml(href)}">Изменить</a>`;
}

export function visitSummaryMarkup(visit, { editLinks = false, address = null, note = null } = {}) {
  const services = visit?.services || [];
  const duration = visitDuration(visit);
  const total = duration
    ? `${formatPrice(visit.total_price_rub)} · ${formatDurationMinutes(duration)}`
    : formatPrice(visit?.total_price_rub);
  const cost = services.length ? servicesCostLabel(services) : formatVisitSummary(services);
  const noteText = note || "Предоплату принимает студия, на сайте оплаты нет.";
  const addressRow = address
    ? `<div class="visit-row">
        <span class="meta visit-row__label">Адрес студии</span>
        <span class="meta visit-row__value">${escapeHtml(address)}</span>
      </div>`
    : "";

  return `<div class="visit-summary">
    <div class="visit-group">
      <div class="visit-row">
        <span class="meta visit-row__label">Услуга</span>
        <span class="meta visit-row__value">${escapeHtml(serviceNames(services))}</span>
      </div>
      <div class="visit-row">
        <span class="meta visit-row__label">Стоимость и длительность</span>
        <span class="meta visit-row__value">${escapeHtml(cost)}</span>
      </div>
      ${editLinks ? editLink("booking.html") : ""}
    </div>
    <hr class="divider" />
    <div class="visit-group">
      <div class="visit-row">
        <span class="meta visit-row__label">Мастер</span>
        <span class="meta visit-row__value">${escapeHtml(masterName(visit?.master))}</span>
      </div>
      <div class="visit-row">
        <span class="meta visit-row__label">Специализация</span>
        <span class="meta visit-row__value">${escapeHtml(visit?.master?.specialization_label || "—")}</span>
      </div>
      ${editLinks ? editLink("booking-master.html") : ""}
    </div>
    <hr class="divider" />
    <div class="visit-group">
      <div class="visit-row">
        <span class="meta visit-row__label">Дата и время</span>
        <span class="meta visit-row__value">${escapeHtml(formatVisitDateTime(visit?.starts_at))}</span>
      </div>
      ${editLinks ? editLink("booking-datetime.html") : ""}
    </div>
    ${addressRow}
    <div class="visit-row visit-row--total">
      <span class="meta visit-row__label">Итого</span>
      <span class="meta visit-row__value">${escapeHtml(total)}</span>
    </div>
    <p class="meta visit-note">${escapeHtml(noteText)}</p>
  </div>`;
}
