import { getDb, runInTransaction } from "../db/connection.js";
import { HttpError, isForeignKeyConstraint, isUniqueConstraint } from "../http/errors.js";
import { serializeService } from "./catalog.js";
import { nowUtcIso } from "./time.js";
import {
  parseBooleanFlag,
  parseHm,
  parseId,
  parseInteger,
  parseOptionalName,
  parseOptionalText,
  parseRequiredName,
  parseServiceIds,
  requireBodyObject,
} from "./validate.js";

const SORT_TABLES = {
  services: "services",
  masters: "masters",
};

function nextSortOrder(db, table) {
  const ident = SORT_TABLES[table];
  if (!ident) {
    throw new HttpError(500, "SERVER_ERROR", "Внутренняя ошибка сервера");
  }
  return db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM "${ident}"`).get().n;
}

function loadService(db, id) {
  const row = db.prepare("SELECT * FROM services WHERE id = ?").get(id);
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Услуга не найдена");
  }
  return serializeService(row);
}

function masterServiceIds(db, masterId) {
  return db
    .prepare("SELECT service_id FROM master_services WHERE master_id = ? ORDER BY service_id")
    .all(masterId)
    .map((row) => row.service_id);
}

function masterSchedule(db, masterId) {
  return db
    .prepare(
      `
      SELECT weekday, start_time, end_time
      FROM master_schedule
      WHERE master_id = ?
      ORDER BY weekday, start_time
      `,
    )
    .all(masterId);
}

function serializeAdminMaster(db, row) {
  return {
    id: row.id,
    display_name: row.display_name || null,
    specialization_label: row.specialization_label,
    portrait_path: row.portrait_path || null,
    cover_path: row.cover_path || null,
    is_active: row.is_active === 1,
    sort_order: row.sort_order,
    service_ids: masterServiceIds(db, row.id),
    schedule: masterSchedule(db, row.id),
  };
}

function loadMaster(db, id) {
  const row = db.prepare("SELECT * FROM masters WHERE id = ?").get(id);
  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
  }
  return serializeAdminMaster(db, row);
}

function parseSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9_]{2,64}$/.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "slug: латиница, цифры и _");
  }
  return value;
}

function parseSchedule(value) {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "schedule должен быть массивом");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, "VALIDATION_ERROR", `Некорректная строка графика ${index}`);
    }
    const weekday = parseInteger(item.weekday, "weekday", { min: 1, max: 7 });
    const startTime = parseHm(item.start_time, "start_time");
    const endTime = parseHm(item.end_time, "end_time");
    if (endTime <= startTime) {
      throw new HttpError(400, "VALIDATION_ERROR", "end_time должен быть позже start_time");
    }
    return { weekday, start_time: startTime, end_time: endTime };
  });
}

function replaceMasterServices(db, masterId, serviceIds) {
  if (!serviceIds) {
    return;
  }
  for (const serviceId of serviceIds) {
    const service = db.prepare("SELECT id, is_bookable FROM services WHERE id = ?").get(serviceId);
    if (!service) {
      throw new HttpError(400, "VALIDATION_ERROR", "Услуга не найдена");
    }
    if (service.is_bookable !== 1) {
      throw new HttpError(400, "VALIDATION_ERROR", "К мастеру можно привязать только записываемые услуги");
    }
  }
  db.prepare("DELETE FROM master_services WHERE master_id = ?").run(masterId);
  const insert = db.prepare("INSERT INTO master_services (master_id, service_id) VALUES (?, ?)");
  for (const serviceId of serviceIds) {
    insert.run(masterId, serviceId);
  }
}

function replaceSchedule(db, masterId, schedule) {
  if (!schedule) {
    return;
  }
  db.prepare("DELETE FROM master_schedule WHERE master_id = ?").run(masterId);
  const insert = db.prepare(
    `
    INSERT INTO master_schedule (master_id, weekday, start_time, end_time, created_at)
    VALUES (?, ?, ?, ?, ?)
    `,
  );
  const now = nowUtcIso();
  for (const row of schedule) {
    insert.run(masterId, row.weekday, row.start_time, row.end_time, now);
  }
}

function parsePositiveRub(value, field) {
  if (value == null || value === "") {
    throw new HttpError(400, "VALIDATION_ERROR", `Укажите ${field}`);
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "Цена должна быть положительной");
  }
  return number;
}

function parseOptionalPositiveRub(value, field) {
  if (value == null || value === "") {
    return null;
  }
  return parsePositiveRub(value, field);
}

function parseServiceDurations(payload, isBookable, current = null) {
  const minSource =
    payload.duration_min_minutes === undefined && current
      ? current.duration_min_minutes
      : payload.duration_min_minutes;
  const maxSource =
    payload.duration_max_minutes === undefined && current
      ? current.duration_max_minutes
      : payload.duration_max_minutes;
  const optional = isBookable !== 1;
  const durationMin = parseInteger(minSource, "duration_min_minutes", { min: 1, optional });
  const durationMax = parseInteger(maxSource, "duration_max_minutes", { min: 1, optional });
  if (isBookable === 1 && (durationMin == null || durationMax == null)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Длительность должна быть положительной");
  }
  if (durationMin != null && durationMax != null && durationMax < durationMin) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "duration_max_minutes не может быть меньше duration_min_minutes",
    );
  }
  return { durationMin, durationMax };
}

function parseMasterServiceIds(value, { missing = [] } = {}) {
  if (value == null) {
    return missing;
  }
  if (Array.isArray(value) && value.length === 0) {
    return [];
  }
  return parseServiceIds(value);
}

function serviceHasReferences(db, id) {
  const appointments = db
    .prepare("SELECT COUNT(*) AS n FROM appointment_services WHERE service_id = ?")
    .get(id).n;
  const holds = db
    .prepare("SELECT COUNT(*) AS n FROM booking_hold_services WHERE service_id = ?")
    .get(id).n;
  return { appointments, holds, any: appointments > 0 || holds > 0 };
}

function masterHasReferences(db, id) {
  const appointments = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE master_id = ?").get(id).n;
  const holds = db.prepare("SELECT COUNT(*) AS n FROM booking_holds WHERE master_id = ?").get(id).n;
  return { appointments, holds, any: appointments > 0 || holds > 0 };
}

function disableService(db, id) {
  db.prepare("UPDATE services SET is_active = 0, updated_at = ? WHERE id = ?").run(nowUtcIso(), id);
  return {
    ok: true,
    deleted: false,
    disabled: true,
    message: "У услуги есть записи, поэтому она отключена, а не удалена.",
    service: loadService(db, id),
  };
}

function disableMaster(db, id) {
  db.prepare("UPDATE masters SET is_active = 0, updated_at = ? WHERE id = ?").run(nowUtcIso(), id);
  return {
    ok: true,
    deleted: false,
    disabled: true,
    message: "У мастера есть записи, поэтому он отключён, а не удалён.",
    master: loadMaster(db, id),
  };
}

export function listAdminServices() {
  const db = getDb();
  return db.prepare("SELECT * FROM services ORDER BY sort_order, id").all().map(serializeService);
}

export function createService(body) {
  const payload = requireBodyObject(body);
  const slug = parseSlug(payload.slug);
  const name = parseRequiredName(payload.name, "название");
  const priceRub = parsePositiveRub(payload.price_rub, "price_rub");
  const priceRubAlt = parseOptionalPositiveRub(payload.price_rub_alt, "price_rub_alt");
  const isAddon = parseBooleanFlag(payload.is_addon ?? 0, "is_addon");
  const isBookable = parseBooleanFlag(payload.is_bookable ?? 1, "is_bookable");
  const isActive = parseBooleanFlag(payload.is_active ?? 1, "is_active");
  const { durationMin, durationMax } = parseServiceDurations(payload, isBookable);
  const validityMonths = parseInteger(payload.validity_months, "validity_months", {
    min: 1,
    optional: true,
  });
  const sortOrder =
    payload.sort_order == null ? nextSortOrder(getDb(), "services") : parseInteger(payload.sort_order, "sort_order", { min: 0 });
  const description = parseOptionalText(payload.description, "description", { max: 2000 });
  const imagePath = parseOptionalText(payload.image_path, "image_path", { max: 500 });
  const db = getDb();
  const now = nowUtcIso();

  try {
    const result = db
      .prepare(
        `
        INSERT INTO services (
          slug, name, description, price_rub, price_rub_alt,
          duration_min_minutes, duration_max_minutes, is_addon, is_bookable, is_active,
          validity_months, image_path, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        slug,
        name,
        description,
        priceRub,
        priceRubAlt,
        durationMin,
        durationMax,
        isAddon,
        isBookable,
        isActive,
        validityMonths,
        imagePath,
        sortOrder,
        now,
        now,
      );
    return loadService(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new HttpError(409, "CONFLICT", "Услуга с таким slug уже есть");
    }
    throw error;
  }
}

export function updateService(id, body) {
  const payload = requireBodyObject(body);
  const db = getDb();
  const current = db.prepare("SELECT * FROM services WHERE id = ?").get(id);
  if (!current) {
    throw new HttpError(404, "NOT_FOUND", "Услуга не найдена");
  }

  const isAddon = payload.is_addon == null ? current.is_addon : parseBooleanFlag(payload.is_addon, "is_addon");
  const isBookable =
    payload.is_bookable == null ? current.is_bookable : parseBooleanFlag(payload.is_bookable, "is_bookable");
  const isActive =
    payload.is_active == null ? current.is_active : parseBooleanFlag(payload.is_active, "is_active");
  const { durationMin, durationMax } = parseServiceDurations(payload, isBookable, current);

  const next = {
    slug: payload.slug == null ? current.slug : parseSlug(payload.slug),
    name: payload.name == null ? current.name : parseRequiredName(payload.name, "название"),
    description:
      payload.description === undefined
        ? current.description
        : parseOptionalText(payload.description, "description", { max: 2000 }),
    price_rub:
      payload.price_rub == null ? current.price_rub : parsePositiveRub(payload.price_rub, "price_rub"),
    price_rub_alt:
      payload.price_rub_alt === undefined
        ? current.price_rub_alt
        : parseOptionalPositiveRub(payload.price_rub_alt, "price_rub_alt"),
    duration_min_minutes: durationMin,
    duration_max_minutes: durationMax,
    is_addon: isAddon,
    is_bookable: isBookable,
    is_active: isActive,
    validity_months:
      payload.validity_months === undefined
        ? current.validity_months
        : parseInteger(payload.validity_months, "validity_months", { min: 1, optional: true }),
    image_path:
      payload.image_path === undefined
        ? current.image_path
        : parseOptionalText(payload.image_path, "image_path", { max: 500 }),
    sort_order:
      payload.sort_order == null
        ? current.sort_order
        : parseInteger(payload.sort_order, "sort_order", { min: 0 }),
  };

  try {
    db.prepare(
      `
      UPDATE services SET
        slug = ?, name = ?, description = ?, price_rub = ?, price_rub_alt = ?,
        duration_min_minutes = ?, duration_max_minutes = ?, is_addon = ?, is_bookable = ?, is_active = ?,
        validity_months = ?, image_path = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(
      next.slug,
      next.name,
      next.description,
      next.price_rub,
      next.price_rub_alt,
      next.duration_min_minutes,
      next.duration_max_minutes,
      next.is_addon,
      next.is_bookable,
      next.is_active,
      next.validity_months,
      next.image_path,
      next.sort_order,
      nowUtcIso(),
      id,
    );
    return loadService(db, id);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new HttpError(409, "CONFLICT", "Услуга с таким slug уже есть");
    }
    throw error;
  }
}

export function deleteService(id) {
  const db = getDb();
  const current = db.prepare("SELECT id FROM services WHERE id = ?").get(id);
  if (!current) {
    throw new HttpError(404, "NOT_FOUND", "Услуга не найдена");
  }
  const refs = serviceHasReferences(db, id);
  if (refs.any) {
    return disableService(db, id);
  }
  try {
    db.prepare("DELETE FROM services WHERE id = ?").run(id);
    return { ok: true, deleted: true };
  } catch (error) {
    if (isForeignKeyConstraint(error)) {
      return disableService(db, id);
    }
    throw error;
  }
}

export function listAdminMasters() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM masters ORDER BY sort_order, id")
    .all()
    .map((row) => serializeAdminMaster(db, row));
}

export function createMaster(body) {
  const payload = requireBodyObject(body);
  const specialization = parseRequiredName(payload.specialization_label, "specialization_label");
  const displayName = parseOptionalName(payload.display_name);
  const isActive = parseBooleanFlag(payload.is_active ?? 1, "is_active");
  const sortOrder =
    payload.sort_order == null ? nextSortOrder(getDb(), "masters") : parseInteger(payload.sort_order, "sort_order", { min: 0 });
  const serviceIds = parseMasterServiceIds(payload.service_ids, { missing: [] });
  const schedule = parseSchedule(payload.schedule) || [];
  const portraitPath = parseOptionalText(payload.portrait_path, "portrait_path", { max: 500 });
  const coverPath = parseOptionalText(payload.cover_path, "cover_path", { max: 500 });
  const db = getDb();
  const now = nowUtcIso();

  return runInTransaction(db, () => {
    const result = db
      .prepare(
        `
        INSERT INTO masters (
          display_name, specialization_label, portrait_path, cover_path,
          is_active, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(displayName, specialization, portraitPath, coverPath, isActive, sortOrder, now, now);
    const masterId = Number(result.lastInsertRowid);
    replaceMasterServices(db, masterId, serviceIds);
    replaceSchedule(db, masterId, schedule);
    return loadMaster(db, masterId);
  });
}

export function updateMaster(id, body) {
  const payload = requireBodyObject(body);
  const db = getDb();
  const current = db.prepare("SELECT * FROM masters WHERE id = ?").get(id);
  if (!current) {
    throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
  }

  const specialization =
    payload.specialization_label == null
      ? current.specialization_label
      : parseRequiredName(payload.specialization_label, "specialization_label");
  const displayName =
    payload.display_name === undefined ? current.display_name : parseOptionalName(payload.display_name);
  const isActive =
    payload.is_active == null ? current.is_active : parseBooleanFlag(payload.is_active, "is_active");
  const sortOrder =
    payload.sort_order == null
      ? current.sort_order
      : parseInteger(payload.sort_order, "sort_order", { min: 0 });
  const portraitPath =
    payload.portrait_path === undefined
      ? current.portrait_path
      : parseOptionalText(payload.portrait_path, "portrait_path", { max: 500 });
  const coverPath =
    payload.cover_path === undefined
      ? current.cover_path
      : parseOptionalText(payload.cover_path, "cover_path", { max: 500 });
  const serviceIds = payload.service_ids === undefined ? null : parseMasterServiceIds(payload.service_ids);
  const schedule = parseSchedule(payload.schedule);

  return runInTransaction(db, () => {
    db.prepare(
      `
      UPDATE masters SET
        display_name = ?, specialization_label = ?, portrait_path = ?, cover_path = ?,
        is_active = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
      `,
    ).run(displayName, specialization, portraitPath, coverPath, isActive, sortOrder, nowUtcIso(), id);
    replaceMasterServices(db, id, serviceIds);
    replaceSchedule(db, id, schedule);
    return loadMaster(db, id);
  });
}

export function deleteMaster(id) {
  const db = getDb();
  const current = db.prepare("SELECT id FROM masters WHERE id = ?").get(id);
  if (!current) {
    throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
  }
  const refs = masterHasReferences(db, id);
  if (refs.any) {
    return disableMaster(db, id);
  }
  try {
    db.prepare("DELETE FROM masters WHERE id = ?").run(id);
    return { ok: true, deleted: true };
  } catch (error) {
    if (isForeignKeyConstraint(error)) {
      return disableMaster(db, id);
    }
    throw error;
  }
}
