import { getDb } from "../db/connection.js";
import { HttpError } from "../http/errors.js";
import {
  assertMasterOffers,
  loadBookableServices,
  visitDurationMinutes,
} from "./catalog.js";
import { purgeExpiredHolds } from "./cleanup.js";
import { getStudioSettings } from "./settings.js";
import {
  addDaysYmd,
  addMinutesIso,
  hmInTimeZone,
  isoWeekday,
  nowUtcIso,
  ymdInTimeZone,
  zonedLocalToUtcIso,
} from "./time.js";

export function subtractIntervals(windows, busy) {
  let result = windows.map((window) => ({ start: window.start, end: window.end }));
  for (const block of busy) {
    const next = [];
    for (const window of result) {
      if (window.end <= block.start || window.start >= block.end) {
        next.push(window);
        continue;
      }
      if (window.start < block.start) {
        next.push({ start: window.start, end: Math.min(window.end, block.start) });
      }
      if (window.end > block.end) {
        next.push({ start: Math.max(window.start, block.end), end: window.end });
      }
    }
    result = next.filter((window) => window.end > window.start);
  }
  return result;
}

export function sliceSlotStarts(free, durationMs, stepMs) {
  const slots = [];
  for (const interval of free) {
    let start = interval.start;
    while (start + durationMs <= interval.end) {
      slots.push({ start, end: start + durationMs });
      start += stepMs;
    }
  }
  return slots;
}

function toMs(iso) {
  return Date.parse(iso);
}

function overlapsDay(startsAt, endsAt, dayStartIso, dayEndIso) {
  return startsAt < dayEndIso && endsAt > dayStartIso;
}

export function getAvailability(db, input) {
  const {
    masterId,
    localDate,
    serviceIds,
    excludeHoldToken = null,
    excludeAppointmentId = null,
    ignoreOccupyingAppointments = false,
    now = new Date(),
  } = input;

  purgeExpiredHolds(db);
  const settings = getStudioSettings(db);
  const timezone = settings.timezone;
  const nowIso = nowUtcIso(now);
  const services = loadBookableServices(db, serviceIds);
  const durationMinutes = visitDurationMinutes(services);

  const master = db
    .prepare("SELECT id, is_active FROM masters WHERE id = ?")
    .get(masterId);
  if (!master) {
    throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
  }

  const empty = {
    timezone,
    date: localDate,
    duration_minutes: durationMinutes,
    slots: [],
  };

  if (master.is_active !== 1) {
    return empty;
  }

  assertMasterOffers(db, masterId, serviceIds);

  const today = ymdInTimeZone(now, timezone);
  if (localDate < today) {
    return empty;
  }
  const horizonEnd = addDaysYmd(today, settings.calendar_horizon_days);
  if (localDate > horizonEnd) {
    return empty;
  }

  const closed = db
    .prepare(
      `
      SELECT id FROM studio_closures
      WHERE starts_on <= ? AND ends_on >= ?
      LIMIT 1
      `,
    )
    .get(localDate, localDate);
  if (closed) {
    return empty;
  }

  const dayStartIso = zonedLocalToUtcIso(localDate, "00:00", timezone);
  const dayEndIso = zonedLocalToUtcIso(addDaysYmd(localDate, 1), "00:00", timezone);
  const earliestIso = addMinutesIso(nowIso, settings.min_lead_minutes);
  const earliestMs = Math.max(toMs(dayStartIso), toMs(earliestIso));

  const weekday = isoWeekday(localDate);
  const schedule = db
    .prepare(
      `
      SELECT start_time, end_time
      FROM master_schedule
      WHERE master_id = ? AND weekday = ?
      ORDER BY start_time
      `,
    )
    .all(masterId, weekday);

  const windows = [];
  for (const row of schedule) {
    let startMs = toMs(zonedLocalToUtcIso(localDate, row.start_time, timezone));
    const endMs = toMs(zonedLocalToUtcIso(localDate, row.end_time, timezone));
    startMs = Math.max(startMs, earliestMs);
    if (endMs > startMs) {
      windows.push({ start: startMs, end: endMs });
    }
  }
  if (windows.length === 0) {
    return empty;
  }

  const busy = [];

  if (!ignoreOccupyingAppointments) {
    const appointments = db
      .prepare(
        `
        SELECT id, starts_at, ends_at
        FROM appointments
        WHERE master_id = ?
          AND status IN ('pending_prepayment', 'confirmed', 'rescheduled')
          AND starts_at < ?
          AND ends_at > ?
        `,
      )
      .all(masterId, dayEndIso, dayStartIso);

    for (const row of appointments) {
      if (excludeAppointmentId && row.id === excludeAppointmentId) {
        continue;
      }
      if (overlapsDay(row.starts_at, row.ends_at, dayStartIso, dayEndIso)) {
        busy.push({ start: toMs(row.starts_at), end: toMs(row.ends_at) });
      }
    }
  }

  const holds = db
    .prepare(
      `
      SELECT hold_token, starts_at, ends_at
      FROM booking_holds
      WHERE master_id = ?
        AND expires_at > ?
        AND starts_at < ?
        AND ends_at > ?
      `,
    )
    .all(masterId, nowIso, dayEndIso, dayStartIso);

  for (const row of holds) {
    if (excludeHoldToken && row.hold_token === excludeHoldToken) {
      continue;
    }
    busy.push({ start: toMs(row.starts_at), end: toMs(row.ends_at) });
  }

  const blocks = db
    .prepare(
      `
      SELECT starts_at, ends_at
      FROM master_time_blocks
      WHERE master_id = ?
        AND starts_at < ?
        AND ends_at > ?
      `,
    )
    .all(masterId, dayEndIso, dayStartIso);

  for (const row of blocks) {
    busy.push({ start: toMs(row.starts_at), end: toMs(row.ends_at) });
  }

  const free = subtractIntervals(windows, busy);
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = settings.slot_step_minutes * 60 * 1000;
  const slots = sliceSlotStarts(free, durationMs, stepMs).map((slot) => {
    const startsAt = nowUtcIso(new Date(slot.start));
    const endsAt = nowUtcIso(new Date(slot.end));
    return {
      starts_at: startsAt,
      ends_at: endsAt,
      starts_local: hmInTimeZone(new Date(slot.start), timezone),
    };
  });

  return {
    timezone,
    date: localDate,
    duration_minutes: durationMinutes,
    slots,
  };
}

export function findAvailabilityForRequest(query, masterId) {
  const db = getDb();
  return getAvailability(db, {
    masterId,
    localDate: query.localDate,
    serviceIds: query.serviceIds,
    excludeHoldToken: query.excludeHoldToken,
    excludeAppointmentId: query.excludeAppointmentId,
  });
}

export const SLOT_TAKEN_MESSAGE = "Это время уже занято";
export const NEAREST_SLOT_LIMIT = 5;

export function listNearestSlots(db, params) {
  const {
    masterId,
    serviceIds,
    afterStartsAt,
    excludeHoldToken = null,
    excludeAppointmentId = null,
    now = new Date(),
    limit = NEAREST_SLOT_LIMIT,
  } = params;
  const settings = getStudioSettings(db);
  const timezone = settings.timezone;
  const today = ymdInTimeZone(now, timezone);
  let ymd = ymdInTimeZone(new Date(afterStartsAt), timezone);
  if (ymd < today) {
    ymd = today;
  }
  const horizonEnd = addDaysYmd(today, settings.calendar_horizon_days);
  const collected = [];

  while (ymd <= horizonEnd && collected.length < limit) {
    const availability = getAvailability(db, {
      masterId,
      localDate: ymd,
      serviceIds,
      excludeHoldToken,
      excludeAppointmentId,
      now,
    });
    for (const slot of availability.slots) {
      if (slot.starts_at > afterStartsAt) {
        collected.push(slot);
        if (collected.length >= limit) {
          break;
        }
      }
    }
    ymd = addDaysYmd(ymd, 1);
  }

  return collected;
}

export function slotTakenError(db, params) {
  const slots = listNearestSlots(db, {
    masterId: params.masterId,
    serviceIds: params.serviceIds,
    afterStartsAt: params.startsAt,
    excludeHoldToken: params.excludeHoldToken,
    excludeAppointmentId: params.excludeAppointmentId,
    now: params.now,
  });
  return new HttpError(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE, { slots });
}

export function assertSlotStillFree(db, params) {
  const {
    masterId,
    serviceIds,
    startsAt,
    excludeHoldToken,
    excludeAppointmentId,
    ignoreOccupyingAppointments = false,
    now,
  } = params;
  const settings = getStudioSettings(db);
  const localDate = ymdInTimeZone(new Date(startsAt), settings.timezone);
  const availability = getAvailability(db, {
    masterId,
    localDate,
    serviceIds,
    excludeHoldToken,
    excludeAppointmentId,
    ignoreOccupyingAppointments,
    now,
  });
  const slot = availability.slots.find((item) => item.starts_at === startsAt);
  if (!slot) {
    throw slotTakenError(db, params);
  }
  return slot;
}
