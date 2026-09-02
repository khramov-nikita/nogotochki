export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function masterName(master) {
  const name = master?.display_name?.trim();
  return name || "Мастер студии";
}

export function formatPrice(rub) {
  if (rub == null) {
    return "—";
  }
  return `${Number(rub).toLocaleString("ru-RU")} ₽`;
}

export function formatServicePrice(service) {
  if (service.price_rub_alt != null) {
    return `${formatPrice(service.price_rub)} или ${formatPrice(service.price_rub_alt)}`;
  }
  return formatPrice(service.price_rub);
}

function formatHours(minutes) {
  const hours = minutes / 60;
  if (hours === 1) {
    return "1 час";
  }
  const label = Number.isInteger(hours) ? String(hours) : String(hours).replace(".", ",");
  return `${label} часа`;
}

export function formatServiceDuration(service) {
  if (service.validity_months != null) {
    const months = Number(service.validity_months);
    if (months === 1) {
      return "1 месяц";
    }
    if (months >= 2 && months <= 4) {
      return `${months} месяца`;
    }
    return `${months} месяцев`;
  }

  const min = service.duration_min_minutes;
  const max = service.duration_max_minutes;
  if (min == null && max == null) {
    return "";
  }

  if (min != null && max != null && min !== max) {
    const prefix = service.is_addon ? "+" : "";
    return `${prefix}${min}–${max} мин`;
  }

  const minutes = max ?? min;
  if (minutes % 60 === 0 || (minutes % 30 === 0 && minutes >= 90)) {
    return formatHours(minutes);
  }
  if (minutes === 1) {
    return "1 минута";
  }
  if (minutes >= 2 && minutes <= 4) {
    return `${minutes} минуты`;
  }
  return `${minutes} минут`;
}
