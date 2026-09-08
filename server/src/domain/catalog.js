import { getDb } from "../db/connection.js";
import { HttpError } from "../http/errors.js";
import { parseServiceIds } from "./validate.js";

function asBool(value) {
  return value === 1;
}

export function serializeService(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || null,
    price_rub: row.price_rub,
    price_rub_alt: row.price_rub_alt ?? null,
    duration_min_minutes: row.duration_min_minutes ?? null,
    duration_max_minutes: row.duration_max_minutes ?? null,
    is_addon: asBool(row.is_addon),
    is_bookable: asBool(row.is_bookable),
    is_active: row.is_active == null ? true : asBool(row.is_active),
    validity_months: row.validity_months ?? null,
    image_path: row.image_path || null,
    sort_order: row.sort_order,
  };
}

export function serializeMaster(row, serviceIds) {
  return {
    id: row.id,
    display_name: row.display_name || null,
    specialization_label: row.specialization_label,
    portrait_path: row.portrait_path || null,
    cover_path: row.cover_path || null,
    service_ids: serviceIds,
  };
}

export function listServices() {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT id, slug, name, description, price_rub, price_rub_alt,
             duration_min_minutes, duration_max_minutes, is_addon, is_bookable,
             is_active, validity_months, image_path, sort_order
      FROM services
      WHERE is_active = 1
      ORDER BY sort_order, id
      `,
    )
    .all()
    .map(serializeService);
}

function masterServiceIds(db, masterId) {
  return db
    .prepare("SELECT service_id FROM master_services WHERE master_id = ? ORDER BY service_id")
    .all(masterId)
    .map((row) => row.service_id);
}

function mastersOfferingAll(db, serviceIds) {
  const placeholders = serviceIds.map(() => "?").join(", ");
  return new Set(
    db
      .prepare(
        `
        SELECT master_id
        FROM master_services
        WHERE service_id IN (${placeholders})
        GROUP BY master_id
        HAVING COUNT(DISTINCT service_id) = ?
        `,
      )
      .all(...serviceIds, serviceIds.length)
      .map((row) => row.master_id),
  );
}

export function loadBookableServices(db, serviceIds) {
  const rows = serviceIds.map((id) =>
    db
      .prepare(
        `
        SELECT id, slug, name, price_rub, duration_min_minutes, duration_max_minutes,
               is_addon, is_bookable, is_active, sort_order
        FROM services
        WHERE id = ?
        `,
      )
      .get(id),
  );
  if (rows.some((row) => !row)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Услуга не найдена");
  }
  if (rows.some((row) => row.is_active !== 1)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Эта услуга отключена");
  }
  if (rows.some((row) => row.is_bookable !== 1)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Эту услугу нельзя записать в слот");
  }
  if (!rows.some((row) => row.is_addon === 0)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Нельзя записаться только на добавку");
  }
  if (rows.some((row) => row.duration_max_minutes == null)) {
    throw new HttpError(400, "VALIDATION_ERROR", "У услуги нет длительности");
  }
  return rows;
}

export function visitDurationMinutes(services) {
  return services.reduce((sum, service) => sum + service.duration_max_minutes, 0);
}

export function visitPriceRub(services) {
  return services.reduce((sum, service) => sum + service.price_rub, 0);
}

export function assertMasterOffers(db, masterId, serviceIds) {
  const placeholders = serviceIds.map(() => "?").join(", ");
  const count = db
    .prepare(
      `
      SELECT COUNT(*) AS n
      FROM master_services
      WHERE master_id = ? AND service_id IN (${placeholders})
      `,
    )
    .get(masterId, ...serviceIds).n;
  if (count !== serviceIds.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "Мастер не выполняет весь набор услуг");
  }
}

export function listMasters(serviceIdsQuery) {
  const db = getDb();
  const serviceIds = serviceIdsQuery ? parseServiceIds(serviceIdsQuery) : null;
  if (serviceIds) {
    loadBookableServices(db, serviceIds);
  }

  const allowed = serviceIds ? mastersOfferingAll(db, serviceIds) : null;
  const rows = db
    .prepare(
      `
      SELECT id, display_name, specialization_label, portrait_path, cover_path, sort_order
      FROM masters
      WHERE is_active = 1
      ORDER BY sort_order, id
      `,
    )
    .all();

  return rows
    .filter((row) => (allowed ? allowed.has(row.id) : true))
    .map((row) => serializeMaster(row, masterServiceIds(db, row.id)));
}
