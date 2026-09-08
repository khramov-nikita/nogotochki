import crypto from "node:crypto";
import { getDb, runInTransaction } from "../db/connection.js";
import { HttpError } from "../http/errors.js";
import { assertSlotStillFree } from "./availability.js";
import {
  assertMasterOffers,
  loadBookableServices,
  serializeMaster,
  serializeService,
  visitDurationMinutes,
  visitPriceRub,
} from "./catalog.js";
import { purgeExpiredHolds } from "./cleanup.js";
import { getStudioSettings } from "./settings.js";
import { addMinutesIso, nowUtcIso } from "./time.js";
import {
  parseHoldToken,
  parseId,
  parseOptionalToken,
  parseServiceIds,
  parseUtcInstant,
  requireBodyObject,
} from "./validate.js";
import { resolveOverlapOverride } from "./roles.js";

function createHoldToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getHoldServices(db, holdId) {
  return db
    .prepare(
      `
      SELECT s.id, s.slug, s.name, s.description, s.price_rub, s.price_rub_alt,
             s.duration_min_minutes, s.duration_max_minutes, s.is_addon, s.is_bookable,
             s.validity_months, s.image_path, s.sort_order
      FROM booking_hold_services bhs
      JOIN services s ON s.id = bhs.service_id
      WHERE bhs.hold_id = ?
      ORDER BY bhs.sort_order, s.id
      `,
    )
    .all(holdId);
}

function serializeHold(db, hold) {
  const master = db
    .prepare(
      `
      SELECT id, display_name, specialization_label, portrait_path, cover_path
      FROM masters
      WHERE id = ?
      `,
    )
    .get(hold.master_id);
  const services = getHoldServices(db, hold.id);
  return {
    hold_token: hold.hold_token,
    master: serializeMaster(master, services.map((row) => row.id)),
    services: services.map(serializeService),
    starts_at: hold.starts_at,
    ends_at: hold.ends_at,
    expires_at: hold.expires_at,
    total_price_rub: visitPriceRub(services),
    duration_minutes: visitDurationMinutes(services),
  };
}

export function attachHoldToClient(db, holdToken, clientId) {
  if (!holdToken) {
    return;
  }
  purgeExpiredHolds(db);
  const hold = db.prepare("SELECT * FROM booking_holds WHERE hold_token = ?").get(holdToken);
  if (!hold) {
    return;
  }
  if (hold.expires_at <= nowUtcIso()) {
    return;
  }
  if (hold.client_id && hold.client_id !== clientId) {
    return;
  }
  db.prepare("UPDATE booking_holds SET client_id = ?, updated_at = ? WHERE id = ?").run(
    clientId,
    nowUtcIso(),
    hold.id,
  );
}

export function createHold(body, clientId = null, actor = null) {
  const payload = requireBodyObject(body);
  const masterId = parseId(payload.master_id, "master_id");
  const serviceIds = parseServiceIds(payload.service_ids);
  const startsAt = parseUtcInstant(payload.starts_at);
  const reuseToken = parseOptionalToken(payload.hold_token);
  const overlapOverride = resolveOverlapOverride(actor, payload.overlap_override);
  const db = getDb();

  return runInTransaction(db, () => {
    purgeExpiredHolds(db);
    const services = loadBookableServices(db, serviceIds);
    const master = db.prepare("SELECT id, is_active FROM masters WHERE id = ?").get(masterId);
    if (!master) {
      throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
    }
    if (master.is_active !== 1) {
      throw new HttpError(400, "VALIDATION_ERROR", "Мастер сейчас не принимает записи");
    }
    assertMasterOffers(db, masterId, serviceIds);

    const slot = assertSlotStillFree(db, {
      masterId,
      serviceIds,
      startsAt,
      excludeHoldToken: reuseToken,
      ignoreOccupyingAppointments: overlapOverride === 1,
    });

    const now = nowUtcIso();
    const settings = getStudioSettings(db);
    const duration = visitDurationMinutes(services);
    const endsAt = addMinutesIso(startsAt, duration);
    if (endsAt !== slot.ends_at) {
      throw new HttpError(409, "SLOT_TAKEN", "Это время уже занято");
    }
    const expiresAt = addMinutesIso(now, settings.reserve_minutes);
    const token = reuseToken || createHoldToken();

    if (reuseToken) {
      const existing = db.prepare("SELECT id FROM booking_holds WHERE hold_token = ?").get(token);
      if (existing) {
        db.prepare("DELETE FROM booking_holds WHERE id = ?").run(existing.id);
      }
    }

    const inserted = db
      .prepare(
        `
        INSERT INTO booking_holds (
          hold_token, client_id, master_id, starts_at, ends_at, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(token, clientId, masterId, startsAt, endsAt, expiresAt, now, now);
    const holdId = Number(inserted.lastInsertRowid);

    const insertService = db.prepare(
      "INSERT INTO booking_hold_services (hold_id, service_id, sort_order) VALUES (?, ?, ?)",
    );
    serviceIds.forEach((serviceId, index) => {
      insertService.run(holdId, serviceId, index + 1);
    });

    const hold = db.prepare("SELECT * FROM booking_holds WHERE id = ?").get(holdId);
    return serializeHold(db, hold);
  });
}

function requireLiveHold(db, token) {
  purgeExpiredHolds(db);
  const hold = db.prepare("SELECT * FROM booking_holds WHERE hold_token = ?").get(token);
  if (!hold) {
    throw new HttpError(409, "HOLD_EXPIRED", "Резерв истек или не найден");
  }
  if (hold.expires_at <= nowUtcIso()) {
    db.prepare("DELETE FROM booking_holds WHERE id = ?").run(hold.id);
    throw new HttpError(409, "HOLD_EXPIRED", "Резерв истек");
  }
  return hold;
}

export function getHold(token) {
  const holdToken = parseHoldToken(token);
  const db = getDb();
  const hold = requireLiveHold(db, holdToken);
  return serializeHold(db, hold);
}

export function deleteHold(token) {
  const holdToken = parseHoldToken(token);
  const db = getDb();
  const result = db.prepare("DELETE FROM booking_holds WHERE hold_token = ?").run(holdToken);
  if (result.changes === 0) {
    throw new HttpError(409, "HOLD_EXPIRED", "Резерв истек или не найден");
  }
}

export function consumeHoldForAppointment(db, holdToken, clientId, overlapOverride = 0) {
  const hold = requireLiveHold(db, holdToken);
  if (hold.client_id && hold.client_id !== clientId) {
    throw new HttpError(403, "FORBIDDEN", "Этот резерв принадлежит другому клиенту");
  }
  const services = getHoldServices(db, hold.id);
  const serviceIds = services.map((row) => row.id);
  const slot = assertSlotStillFree(db, {
    masterId: hold.master_id,
    serviceIds,
    startsAt: hold.starts_at,
    excludeHoldToken: hold.hold_token,
    ignoreOccupyingAppointments: overlapOverride === 1,
  });
  return { hold, services, serviceIds, slot };
}
