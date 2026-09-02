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

const MOSCOW_TZ = "Europe/Moscow";

export function todayYmd(timeZone = MOSCOW_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ymdFromInstant(iso, timeZone = MOSCOW_TZ) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatLocalHm(iso, timeZone = MOSCOW_TZ) {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatCountdown(expiresAt) {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) {
    return "00:00";
  }
  const total = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function addDaysYmd(ymd, days) {
  const [year, month, day] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day + Number(days)));
  return date.toISOString().slice(0, 10);
}

export function formatMonthTitle(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex, 1, 12));
  const raw = date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const cleaned = (raw || "").replace(/\sг\.?$/, "");
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "";
}

export function formatDayMonth(ymd) {
  const [year, month, day] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function formatDayMonthYear(ymd) {
  const [year, month, day] = String(ymd)
    .split("-")
    .map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const raw = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (raw || "").replace(/\sг\.?$/, "");
}

export function formatVisitDateTime(iso) {
  const ymd = ymdFromInstant(iso);
  if (!ymd) {
    return "—";
  }
  return `${formatDayMonthYear(ymd)}, ${formatLocalHm(iso)}`;
}

const STATUS_LABELS = {
  pending_prepayment: "ожидает предоплату",
  confirmed: "подтверждена",
  cancelled: "отменена",
  rescheduled: "перенесена",
  expired: "истекла",
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || "—";
}

export function statusBadgeLabel(status) {
  const label = statusLabel(status);
  if (!label || label === "—") {
    return label;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function statusBadgeClass(status) {
  if (status === "pending_prepayment") {
    return "booking-badge--pending";
  }
  if (status === "confirmed") {
    return "booking-badge--confirmed";
  }
  if (status === "cancelled") {
    return "booking-badge--cancelled";
  }
  if (status === "expired") {
    return "booking-badge--expired";
  }
  if (status === "rescheduled") {
    return "booking-badge--rescheduled";
  }
  return "";
}

export function formatDurationMinutes(minutes) {
  if (minutes == null) {
    return "";
  }
  return formatServiceDuration({
    duration_min_minutes: minutes,
    duration_max_minutes: minutes,
  });
}

export function formatVisitSummary(services) {
  const selected = (services || []).filter(Boolean);
  if (!selected.length) {
    return "—";
  }

  const price = selected.reduce((sum, row) => sum + Number(row.price_rub || 0), 0);
  const mains = selected.filter((row) => !row.is_addon);
  const addons = selected.filter((row) => row.is_addon);
  const parts = [];

  if (mains.length) {
    const durationMin = mains.reduce(
      (sum, row) => sum + (row.duration_min_minutes ?? row.duration_max_minutes ?? 0),
      0,
    );
    const durationMax = mains.reduce(
      (sum, row) => sum + (row.duration_max_minutes ?? row.duration_min_minutes ?? 0),
      0,
    );
    parts.push(
      formatServiceDuration({
        duration_min_minutes: durationMin,
        duration_max_minutes: durationMax,
      }),
    );
  }

  addons.forEach((row) => {
    const duration = formatServiceDuration(row);
    if (duration) {
      parts.push(duration);
    }
  });

  const durationLabel = parts.filter(Boolean).join(" ");
  return durationLabel ? `${formatPrice(price)} · ${durationLabel}` : formatPrice(price);
}
