import { getDb, runInTransaction } from "../db/connection.js";
import { HttpError, isAppointmentOverlap } from "../http/errors.js";
import { assertSlotStillFree, SLOT_TAKEN_MESSAGE, slotTakenError } from "./availability.js";
import {
  assertMasterOffers,
  loadBookableServices,
  serializeMaster,
  serializeService,
  visitDurationMinutes,
  visitPriceRub,
} from "./catalog.js";
import { addNotification, purgeExpiredHolds } from "./cleanup.js";
import {
  cancelledNotificationBody,
  overlappingNotificationBody,
  rescheduledNotificationBody,
  studioTimezone,
} from "./notifications.js";
import { consumeHoldForAppointment } from "./holds.js";
import {
  ROLE_ADMINISTRATOR,
  ROLE_CLIENT,
  ROLE_MASTER,
  hasRole,
  resolveOverlapOverride,
} from "./roles.js";
import { getStudioSettings } from "./settings.js";
import { listTimeBlocksForDay } from "./time-blocks.js";
import { nowUtcIso, ymdInTimeZone } from "./time.js";
import {
  parseEmail,
  parseId,
  parseLocalDate,
  parseOptionalToken,
  parseRequiredText,
  parseServiceIds,
  parseUtcInstant,
  requireBodyObject,
} from "./validate.js";

const ACTIVE_STATUSES = new Set(["pending_prepayment", "confirmed", "rescheduled"]);
const HISTORY_STATUSES = new Set(["cancelled", "expired"]);

function expireStaleAppointments(db) {
  const now = nowUtcIso();
  db.prepare(
    `
    UPDATE appointments
    SET status = 'expired', expired_at = ?, updated_at = ?
    WHERE status = 'pending_prepayment' AND starts_at <= ?
    `,
  ).run(now, now, now);
}

function appointmentServices(db, appointmentId) {
  return db
    .prepare(
      `
      SELECT s.id, s.slug, s.name, s.description,
             COALESCE(aps.price_rub, s.price_rub) AS price_rub,
             s.price_rub_alt,
             COALESCE(aps.duration_min_minutes, s.duration_min_minutes) AS duration_min_minutes,
             COALESCE(aps.duration_max_minutes, s.duration_max_minutes) AS duration_max_minutes,
             s.is_addon, s.is_bookable, s.is_active,
             s.validity_months, s.image_path, s.sort_order
      FROM appointment_services aps
      JOIN services s ON s.id = aps.service_id
      WHERE aps.appointment_id = ?
      ORDER BY aps.sort_order, s.id
      `,
    )
    .all(appointmentId);
}

function canMutate(appointment, settings, nowIso, kind) {
  if (!ACTIVE_STATUSES.has(appointment.status)) {
    return false;
  }
  if (appointment.ends_at <= nowIso || appointment.starts_at <= nowIso) {
    return false;
  }
  const hoursField = kind === "cancel" ? "cancel_min_hours_before" : "reschedule_min_hours_before";
  const minHours = settings[hoursField];
  if (minHours != null) {
    const remainingMs = Date.parse(appointment.starts_at) - Date.parse(nowIso);
    if (remainingMs < minHours * 60 * 60 * 1000) {
      return false;
    }
  }
  return true;
}

function canAdminMutate(appointment) {
  return ACTIVE_STATUSES.has(appointment.status);
}

function serializeClientRef(db, clientId) {
  if (!clientId) {
    return null;
  }
  const client = db.prepare("SELECT id, email, display_name FROM clients WHERE id = ?").get(clientId);
  if (!client) {
    return null;
  }
  return {
    id: client.id,
    email: client.email,
    display_name: client.display_name || null,
  };
}

function appointmentOverlapsPeer(db, appointment) {
  if (!ACTIVE_STATUSES.has(appointment.status)) {
    return false;
  }
  const peer = db
    .prepare(
      `
      SELECT id
      FROM appointments
      WHERE master_id = ?
        AND id != ?
        AND status IN ('pending_prepayment', 'confirmed', 'rescheduled')
        AND starts_at < ?
        AND ends_at > ?
      LIMIT 1
      `,
    )
    .get(appointment.master_id, appointment.id, appointment.ends_at, appointment.starts_at);
  return Boolean(peer);
}

function serializeAppointment(db, appointment, { includeClient = false, includeAddress = true } = {}) {
  const settings = getStudioSettings(db);
  const now = nowUtcIso();
  const services = appointmentServices(db, appointment.id);
  const master = db
    .prepare(
      `
      SELECT id, display_name, specialization_label, portrait_path, cover_path
      FROM masters
      WHERE id = ?
      `,
    )
    .get(appointment.master_id);

  const confirmed = appointment.status === "confirmed";
  const payload = {
    id: appointment.id,
    status: appointment.status,
    starts_at: appointment.starts_at,
    ends_at: appointment.ends_at,
    master: serializeMaster(
      master,
      services.map((row) => row.id),
    ),
    services: services.map(serializeService),
    total_price_rub: visitPriceRub(services),
    duration_min_minutes: services.reduce((sum, row) => sum + (row.duration_min_minutes || 0), 0),
    duration_max_minutes: visitDurationMinutes(services),
    can_cancel: canMutate(appointment, settings, now, "cancel"),
    can_reschedule: canMutate(appointment, settings, now, "reschedule"),
    created_at: appointment.created_at,
    confirmed_at: appointment.confirmed_at,
    cancelled_at: appointment.cancelled_at,
    rescheduled_at: appointment.rescheduled_at,
    expired_at: appointment.expired_at,
    overlap_override: appointment.overlap_override === 1,
    overlapping: appointmentOverlapsPeer(db, appointment),
    cancel_reason: appointment.cancel_reason || null,
    cancelled_by: serializeClientRef(db, appointment.cancelled_by_client_id),
    rescheduled_by: serializeClientRef(db, appointment.rescheduled_by_client_id),
    previous_starts_at: appointment.previous_starts_at || null,
    previous_ends_at: appointment.previous_ends_at || null,
    previous_master: (() => {
      if (!appointment.previous_master_id) {
        return null;
      }
      const previous = db
        .prepare(
          `
          SELECT id, display_name, specialization_label, portrait_path, cover_path
          FROM masters
          WHERE id = ?
          `,
        )
        .get(appointment.previous_master_id);
      return previous ? serializeMaster(previous, []) : null;
    })(),
  };

  if (includeAddress) {
    payload.exact_address = confirmed ? settings.exact_address || null : null;
  }

  if (includeClient) {
    const client = db
      .prepare("SELECT id, email, display_name FROM clients WHERE id = ?")
      .get(appointment.client_id);
    payload.client = {
      id: client.id,
      email: client.email,
      display_name: client.display_name || null,
    };
  }

  return payload;
}

function loadAppointment(db, id) {
  const row = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Запись не найдена");
  }
  return row;
}

function assertOwner(appointment, clientId) {
  if (appointment.client_id !== clientId) {
    throw new HttpError(403, "FORBIDDEN", "Это чужая запись");
  }
}

function canViewAppointment(appointment, actor) {
  if (hasRole(actor, ROLE_ADMINISTRATOR)) {
    return true;
  }
  if (hasRole(actor, ROLE_CLIENT) && appointment.client_id === actor.id) {
    return true;
  }
  if (hasRole(actor, ROLE_MASTER) && actor.master_id && appointment.master_id === actor.master_id) {
    return true;
  }
  return false;
}

function assertCanView(appointment, actor) {
  if (!canViewAppointment(appointment, actor)) {
    throw new HttpError(403, "FORBIDDEN", "Это чужая запись");
  }
}

function includeClientFor(actor) {
  return hasRole(actor, ROLE_ADMINISTRATOR) || hasRole(actor, ROLE_MASTER);
}

function appointmentVisibility(actor) {
  const seeAll = hasRole(actor, ROLE_ADMINISTRATOR);
  const ownClient = hasRole(actor, ROLE_CLIENT);
  const ownMaster = hasRole(actor, ROLE_MASTER) && actor.master_id != null;
  return { seeAll, ownClient, ownMaster, masterId: actor.master_id ?? null };
}

/** Единственный INSERT в appointments / appointment_services. */
export function insertAppointment(db, spec) {
  const now = spec.now ?? nowUtcIso();
  const status = spec.status ?? "pending_prepayment";
  const overlapOverride = spec.overlapOverride ?? 0;
  const result = db
    .prepare(
      `
      INSERT INTO appointments (
        client_id, master_id, starts_at, ends_at, status,
        created_at, updated_at, confirmed_at, cancelled_at, rescheduled_at, expired_at,
        overlap_override
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      spec.clientId,
      spec.masterId,
      spec.startsAt,
      spec.endsAt,
      status,
      now,
      now,
      spec.confirmedAt ?? (status === "confirmed" ? now : null),
      spec.cancelledAt ?? (status === "cancelled" ? now : null),
      spec.rescheduledAt ?? (status === "rescheduled" ? now : null),
      spec.expiredAt ?? (status === "expired" ? now : null),
      overlapOverride,
    );
  const appointmentId = Number(result.lastInsertRowid);
  const serviceIds = spec.serviceIds ?? (spec.serviceId != null ? [spec.serviceId] : []);
  const loadService = db.prepare(
    `
    SELECT price_rub, duration_min_minutes, duration_max_minutes
    FROM services
    WHERE id = ?
    `,
  );
  const insertService = db.prepare(
    `
    INSERT OR IGNORE INTO appointment_services (
      appointment_id, service_id, sort_order,
      price_rub, duration_min_minutes, duration_max_minutes
    )
    VALUES (?, ?, ?, ?, ?, ?)
    `,
  );
  serviceIds.forEach((serviceId, index) => {
    const service = loadService.get(serviceId);
    if (!service) {
      throw new HttpError(400, "VALIDATION_ERROR", "Услуга не найдена");
    }
    insertService.run(
      appointmentId,
      serviceId,
      index + 1,
      service.price_rub,
      service.duration_min_minutes,
      service.duration_max_minutes,
    );
  });
  return appointmentId;
}

export function rescheduleAppointment(db, spec) {
  const now = spec.now ?? nowUtcIso();
  db.prepare(
    `
    UPDATE appointments
    SET master_id = ?, starts_at = ?, ends_at = ?, status = 'rescheduled',
        rescheduled_at = ?, updated_at = ?, overlap_override = ?,
        previous_starts_at = ?, previous_ends_at = ?, previous_master_id = ?,
        rescheduled_by_client_id = ?
    WHERE id = ?
    `,
  ).run(
    spec.masterId,
    spec.startsAt,
    spec.endsAt,
    now,
    now,
    spec.overlapOverride ?? 0,
    spec.previousStartsAt ?? null,
    spec.previousEndsAt ?? null,
    spec.previousMasterId ?? null,
    spec.rescheduledByClientId ?? null,
    spec.id,
  );
}

export function cancelAppointment(db, spec) {
  const now = spec.now ?? nowUtcIso();
  db.prepare(
    `
    UPDATE appointments
    SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
        cancelled_by_client_id = ?, cancel_reason = ?
    WHERE id = ?
    `,
  ).run(now, now, spec.cancelledByClientId ?? null, spec.cancelReason ?? null, spec.id);
}

function overlapFromHold(db, holdToken) {
  const hold = db.prepare("SELECT * FROM booking_holds WHERE hold_token = ?").get(holdToken);
  if (!hold) {
    return new HttpError(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE, { slots: [] });
  }
  const serviceIds = db
    .prepare(
      `
      SELECT service_id FROM booking_hold_services
      WHERE hold_id = ?
      ORDER BY sort_order
      `,
    )
    .all(hold.id)
    .map((row) => row.service_id);
  return slotTakenError(db, {
    masterId: hold.master_id,
    serviceIds,
    startsAt: hold.starts_at,
    excludeHoldToken: holdToken,
  });
}

export function createAppointmentFromHold(body, clientId, actor = null) {
  const payload = requireBodyObject(body);
  const holdToken = parseOptionalToken(payload.hold_token);
  if (!holdToken) {
    throw new HttpError(400, "VALIDATION_ERROR", "Укажите hold_token");
  }
  const overlapOverride = resolveOverlapOverride(actor, payload.overlap_override);
  const db = getDb();

  try {
    return runInTransaction(db, () => {
      purgeExpiredHolds(db);
      expireStaleAppointments(db);
      const { hold, serviceIds } = consumeHoldForAppointment(
        db,
        holdToken,
        clientId,
        overlapOverride,
      );
      const appointmentId = insertAppointment(db, {
        clientId,
        masterId: hold.master_id,
        startsAt: hold.starts_at,
        endsAt: hold.ends_at,
        status: "pending_prepayment",
        overlapOverride,
        serviceIds,
      });
      db.prepare("DELETE FROM booking_holds WHERE id = ?").run(hold.id);
      const appointment = loadAppointment(db, appointmentId);
      return serializeAppointment(db, appointment);
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isAppointmentOverlap(error)) {
      throw overlapFromHold(db, holdToken);
    }
    throw error;
  }
}

export const createAppointment = createAppointmentFromHold;

function matchesScope(appointment, scope, nowIso) {
  if (!scope) {
    return true;
  }
  const upcoming = ACTIVE_STATUSES.has(appointment.status) && appointment.ends_at > nowIso;
  if (scope === "active") {
    return upcoming;
  }
  if (scope === "history") {
    return !upcoming;
  }
  throw new HttpError(400, "VALIDATION_ERROR", "scope должен быть active или history");
}

function listAppointmentsForActor(actor, scope) {
  const db = getDb();
  expireStaleAppointments(db);
  const now = nowUtcIso();
  const visibility = appointmentVisibility(actor);
  if (!visibility.seeAll && !visibility.ownClient && !visibility.ownMaster) {
    throw new HttpError(403, "FORBIDDEN", "Недостаточно прав");
  }

  let rows;
  if (visibility.seeAll) {
    rows = db.prepare("SELECT * FROM appointments ORDER BY starts_at").all();
  } else if (visibility.ownClient && visibility.ownMaster) {
    rows = db
      .prepare(
        `
        SELECT * FROM appointments
        WHERE client_id = ? OR master_id = ?
        ORDER BY starts_at
        `,
      )
      .all(actor.id, visibility.masterId);
  } else if (visibility.ownMaster) {
    rows = db
      .prepare(
        `
        SELECT * FROM appointments
        WHERE master_id = ?
        ORDER BY starts_at
        `,
      )
      .all(visibility.masterId);
  } else {
    rows = db
      .prepare(
        `
        SELECT * FROM appointments
        WHERE client_id = ?
        ORDER BY starts_at
        `,
      )
      .all(actor.id);
  }

  return rows
    .filter((row) => matchesScope(row, scope, now))
    .map((row) => serializeAppointment(db, row, { includeClient: includeClientFor(actor) }));
}

export function listOwnAppointments(actor, scope) {
  return listAppointmentsForActor(actor, scope);
}

export function getOwnAppointment(id, actor) {
  const db = getDb();
  expireStaleAppointments(db);
  const appointment = loadAppointment(db, id);
  assertCanView(appointment, actor);
  return serializeAppointment(db, appointment, { includeClient: includeClientFor(actor) });
}

export function cancelOwnAppointment(id, clientId) {
  const db = getDb();
  return runInTransaction(db, () => {
    expireStaleAppointments(db);
    const appointment = loadAppointment(db, id);
    assertOwner(appointment, clientId);
    const settings = getStudioSettings(db);
    if (!canMutate(appointment, settings, nowUtcIso(), "cancel")) {
      throw new HttpError(409, "CONFLICT", "Эту запись уже нельзя отменить");
    }
    cancelAppointment(db, { id, cancelledByClientId: clientId });
    return serializeAppointment(db, loadAppointment(db, id));
  });
}

export function rescheduleOwnAppointment(id, clientId, body, actor = null) {
  const payload = requireBodyObject(body);
  const startsAt = parseUtcInstant(payload.starts_at);
  const masterId = payload.master_id == null ? null : parseId(payload.master_id, "master_id");
  const overlapOverride = resolveOverlapOverride(actor, payload.overlap_override);
  const db = getDb();

  try {
    return runInTransaction(db, () => {
      purgeExpiredHolds(db);
      expireStaleAppointments(db);
      const appointment = loadAppointment(db, id);
      assertOwner(appointment, clientId);
      const settings = getStudioSettings(db);
      if (!canMutate(appointment, settings, nowUtcIso(), "reschedule")) {
        throw new HttpError(409, "CONFLICT", "Эту запись уже нельзя перенести");
      }

      const services = appointmentServices(db, appointment.id);
      const serviceIds = services.map((row) => row.id);
      const nextMasterId = masterId || appointment.master_id;
      const master = db.prepare("SELECT id, is_active FROM masters WHERE id = ?").get(nextMasterId);
      if (!master || master.is_active !== 1) {
        throw new HttpError(400, "VALIDATION_ERROR", "Мастер сейчас не принимает записи");
      }

      const slot = assertSlotStillFree(db, {
        masterId: nextMasterId,
        serviceIds,
        startsAt,
        excludeAppointmentId: appointment.id,
        ignoreOccupyingAppointments: overlapOverride === 1,
      });
      rescheduleAppointment(db, {
        id,
        masterId: nextMasterId,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        overlapOverride,
        previousStartsAt: appointment.starts_at,
        previousEndsAt: appointment.ends_at,
        previousMasterId: appointment.master_id,
        rescheduledByClientId: clientId,
      });
      return serializeAppointment(db, loadAppointment(db, id));
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isAppointmentOverlap(error)) {
      const appointment = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
      const serviceIds = appointment
        ? appointmentServices(db, appointment.id).map((row) => row.id)
        : [];
      throw slotTakenError(db, {
        masterId: masterId || appointment?.master_id,
        serviceIds,
        startsAt,
        excludeAppointmentId: id,
      });
    }
    throw error;
  }
}

export function listAllAppointments(scopeOrQuery = null) {
  const query =
    scopeOrQuery && typeof scopeOrQuery === "object" && !Array.isArray(scopeOrQuery)
      ? scopeOrQuery
      : { scope: scopeOrQuery };
  const db = getDb();
  expireStaleAppointments(db);
  const settings = getStudioSettings(db);
  const timezone = settings.timezone;
  const now = nowUtcIso();
  const date = query.date ? parseLocalDate(query.date, "date") : null;
  const masterId = query.masterId == null ? null : parseId(query.masterId, "master_id");
  const scope = date ? null : query.scope || null;

  let rows = db.prepare("SELECT * FROM appointments ORDER BY starts_at").all();
  if (date) {
    rows = rows.filter((row) => ymdInTimeZone(new Date(row.starts_at), timezone) === date);
  } else if (scope) {
    rows = rows.filter((row) => matchesScope(row, scope, now));
  }
  if (masterId) {
    rows = rows.filter((row) => row.master_id === masterId);
  }

  return {
    appointments: rows.map((row) => serializeAppointment(db, row, { includeClient: true })),
    time_blocks: date ? listTimeBlocksForDay(db, { date, masterId, timezone }) : [],
    timezone,
  };
}

function applyAdminSlot(db, spec) {
  const { masterId, serviceIds, startsAt, excludeAppointmentId, overlapOverride } = spec;
  const master = db.prepare("SELECT id, is_active FROM masters WHERE id = ?").get(masterId);
  if (!master) {
    throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
  }
  if (master.is_active !== 1) {
    throw new HttpError(400, "VALIDATION_ERROR", "Мастер сейчас не принимает записи");
  }
  assertMasterOffers(db, masterId, serviceIds);
  loadBookableServices(db, serviceIds);
  return assertSlotStillFree(db, {
    masterId,
    serviceIds,
    startsAt,
    excludeAppointmentId,
    ignoreOccupyingAppointments: overlapOverride === 1,
  });
}

export function createAdminAppointment(body, actor) {
  const payload = requireBodyObject(body);
  const email = parseEmail(payload.client_email);
  const masterId = parseId(payload.master_id, "master_id");
  const serviceIds = parseServiceIds(payload.service_ids);
  const startsAt = parseUtcInstant(payload.starts_at);
  const overlapOverride = resolveOverlapOverride(actor, payload.overlap_override);
  const db = getDb();

  try {
    return runInTransaction(db, () => {
      purgeExpiredHolds(db);
      expireStaleAppointments(db);
      const client = db.prepare("SELECT id FROM clients WHERE email = ?").get(email);
      if (!client) {
        throw new HttpError(400, "VALIDATION_ERROR", "Клиент с такой почтой не найден");
      }
      const slot = applyAdminSlot(db, {
        masterId,
        serviceIds,
        startsAt,
        overlapOverride,
      });
      const appointmentId = insertAppointment(db, {
        clientId: client.id,
        masterId,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        status: "pending_prepayment",
        overlapOverride,
        serviceIds,
      });
      if (overlapOverride === 1) {
        const peers = db
          .prepare(
            `
            SELECT id, client_id, starts_at
            FROM appointments
            WHERE master_id = ?
              AND id != ?
              AND status IN ('pending_prepayment', 'confirmed', 'rescheduled')
              AND starts_at < ?
              AND ends_at > ?
            `,
          )
          .all(masterId, appointmentId, slot.ends_at, slot.starts_at);
        const timezone = studioTimezone(db);
        for (const peer of peers) {
          if (peer.client_id === client.id) {
            continue;
          }
          addNotification(db, {
            clientId: peer.client_id,
            appointmentId: peer.id,
            type: "overlapping",
            body: overlappingNotificationBody(peer.starts_at, timezone),
          });
        }
      }
      return serializeAppointment(db, loadAppointment(db, appointmentId), { includeClient: true });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isAppointmentOverlap(error)) {
      throw slotTakenError(db, { masterId, serviceIds, startsAt });
    }
    throw error;
  }
}

export function cancelAdminAppointment(id, body, actor) {
  const payload = requireBodyObject(body);
  const reason = parseRequiredText(payload.reason, "reason", { max: 500 });
  const db = getDb();
  return runInTransaction(db, () => {
    expireStaleAppointments(db);
    const appointment = loadAppointment(db, id);
    if (!canAdminMutate(appointment)) {
      throw new HttpError(409, "CONFLICT", "Эту запись уже нельзя отменить");
    }
    cancelAppointment(db, {
      id,
      cancelledByClientId: actor.id,
      cancelReason: reason,
    });
    if (actor.id !== appointment.client_id) {
      addNotification(db, {
        clientId: appointment.client_id,
        appointmentId: id,
        type: "cancelled",
        body: cancelledNotificationBody(appointment.starts_at, studioTimezone(db)),
      });
    }
    return serializeAppointment(db, loadAppointment(db, id), { includeClient: true });
  });
}

export function rescheduleAdminAppointment(id, body, actor) {
  const payload = requireBodyObject(body);
  const startsAt = parseUtcInstant(payload.starts_at);
  const masterId = payload.master_id == null ? null : parseId(payload.master_id, "master_id");
  const overlapOverride = resolveOverlapOverride(actor, payload.overlap_override);
  const db = getDb();

  try {
    return runInTransaction(db, () => {
      purgeExpiredHolds(db);
      expireStaleAppointments(db);
      const appointment = loadAppointment(db, id);
      if (!canAdminMutate(appointment)) {
        throw new HttpError(409, "CONFLICT", "Эту запись уже нельзя перенести");
      }
      const services = appointmentServices(db, appointment.id);
      const serviceIds = services.map((row) => row.id);
      const nextMasterId = masterId || appointment.master_id;
      const slot = applyAdminSlot(db, {
        masterId: nextMasterId,
        serviceIds,
        startsAt,
        excludeAppointmentId: appointment.id,
        overlapOverride,
      });
      rescheduleAppointment(db, {
        id,
        masterId: nextMasterId,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        overlapOverride,
        previousStartsAt: appointment.starts_at,
        previousEndsAt: appointment.ends_at,
        previousMasterId: appointment.master_id,
        rescheduledByClientId: actor.id,
      });
      if (actor.id !== appointment.client_id) {
        addNotification(db, {
          clientId: appointment.client_id,
          appointmentId: id,
          type: "rescheduled",
          body: rescheduledNotificationBody(
            appointment.starts_at,
            slot.starts_at,
            studioTimezone(db),
          ),
        });
      }
      return serializeAppointment(db, loadAppointment(db, id), { includeClient: true });
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    if (isAppointmentOverlap(error)) {
      const appointment = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
      const serviceIds = appointment
        ? appointmentServices(db, appointment.id).map((row) => row.id)
        : [];
      throw slotTakenError(db, {
        masterId: masterId || appointment?.master_id,
        serviceIds,
        startsAt,
        excludeAppointmentId: id,
      });
    }
    throw error;
  }
}

export function confirmAppointment(id) {
  const db = getDb();
  return runInTransaction(db, () => {
    expireStaleAppointments(db);
    const appointment = loadAppointment(db, id);
    if (appointment.status !== "pending_prepayment" && appointment.status !== "rescheduled") {
      throw new HttpError(409, "CONFLICT", "Эту запись нельзя подтвердить");
    }
    const now = nowUtcIso();
    db.prepare(
      `
      UPDATE appointments
      SET status = 'confirmed', confirmed_at = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(now, now, id);
    return serializeAppointment(db, loadAppointment(db, id), { includeClient: true });
  });
}
