import { getDb, runInTransaction } from "../db/connection.js";
import { HttpError } from "../http/errors.js";
import { getStudioSettings } from "./settings.js";
import { addDaysYmd, nowUtcIso, zonedLocalToUtcIso } from "./time.js";
import { parseHm, parseId, parseLocalDate, parseOptionalText, requireBodyObject } from "./validate.js";

export const TIME_BLOCK_KINDS = ["break", "day_off", "vacation"];

function parseKind(value) {
  const kind = typeof value === "string" ? value.trim() : "";
  if (!TIME_BLOCK_KINDS.includes(kind)) {
    throw new HttpError(400, "VALIDATION_ERROR", "kind должен быть break, day_off или vacation");
  }
  return kind;
}

function serializeMasterRef(db, masterId) {
  const master = db
    .prepare("SELECT id, display_name, specialization_label FROM masters WHERE id = ?")
    .get(masterId);
  if (!master) {
    return { id: masterId, display_name: null, specialization_label: null };
  }
  return {
    id: master.id,
    display_name: master.display_name || null,
    specialization_label: master.specialization_label || null,
  };
}

export function serializeTimeBlock(db, row) {
  return {
    id: row.id,
    master_id: row.master_id,
    master: serializeMasterRef(db, row.master_id),
    kind: row.kind || "break",
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    reason: row.reason || null,
    created_at: row.created_at,
  };
}

function resolveInterval(payload, timezone) {
  const kind = parseKind(payload.kind);
  if (kind === "break") {
    const date = parseLocalDate(payload.date || payload.starts_on, "date");
    const startTime = parseHm(payload.start_time, "start_time");
    const endTime = parseHm(payload.end_time, "end_time");
    const startsAt = zonedLocalToUtcIso(date, startTime, timezone);
    const endsAt = zonedLocalToUtcIso(date, endTime, timezone);
    if (endsAt <= startsAt) {
      throw new HttpError(400, "VALIDATION_ERROR", "Конец перерыва должен быть позже начала");
    }
    return { kind, startsAt, endsAt };
  }

  if (kind === "day_off") {
    const date = parseLocalDate(payload.date || payload.starts_on, "date");
    const startsAt = zonedLocalToUtcIso(date, "00:00", timezone);
    const endsAt = zonedLocalToUtcIso(addDaysYmd(date, 1), "00:00", timezone);
    return { kind, startsAt, endsAt };
  }

  const startsOn = parseLocalDate(payload.starts_on || payload.date, "starts_on");
  const endsOn = parseLocalDate(payload.ends_on || payload.date, "ends_on");
  if (endsOn < startsOn) {
    throw new HttpError(400, "VALIDATION_ERROR", "Конец отпуска не может быть раньше начала");
  }
  const startsAt = zonedLocalToUtcIso(startsOn, "00:00", timezone);
  const endsAt = zonedLocalToUtcIso(addDaysYmd(endsOn, 1), "00:00", timezone);
  return { kind, startsAt, endsAt };
}

export function listTimeBlocksForDay(db, { date, masterId, timezone }) {
  const dayStart = zonedLocalToUtcIso(date, "00:00", timezone);
  const dayEnd = zonedLocalToUtcIso(addDaysYmd(date, 1), "00:00", timezone);
  const params = [dayEnd, dayStart];
  let sql = `
    SELECT id, master_id, starts_at, ends_at, reason, created_at, kind
    FROM master_time_blocks
    WHERE starts_at < ? AND ends_at > ?
  `;
  if (masterId) {
    sql += " AND master_id = ?";
    params.push(masterId);
  }
  sql += " ORDER BY starts_at, id";
  return db.prepare(sql).all(...params).map((row) => serializeTimeBlock(db, row));
}

export function createTimeBlock(body) {
  const payload = requireBodyObject(body);
  const masterId = parseId(payload.master_id, "master_id");
  const reason = parseOptionalText(payload.reason, "reason", { max: 500 });
  const db = getDb();
  const settings = getStudioSettings(db);
  const { kind, startsAt, endsAt } = resolveInterval(payload, settings.timezone);

  return runInTransaction(db, () => {
    const master = db.prepare("SELECT id FROM masters WHERE id = ?").get(masterId);
    if (!master) {
      throw new HttpError(404, "NOT_FOUND", "Мастер не найден");
    }
    const now = nowUtcIso();
    const result = db
      .prepare(
        `
        INSERT INTO master_time_blocks (master_id, starts_at, ends_at, reason, created_at, kind)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(masterId, startsAt, endsAt, reason, now, kind);
    const row = db
      .prepare(
        `
        SELECT id, master_id, starts_at, ends_at, reason, created_at, kind
        FROM master_time_blocks
        WHERE id = ?
        `,
      )
      .get(Number(result.lastInsertRowid));
    return serializeTimeBlock(db, row);
  });
}

export function deleteTimeBlock(id) {
  const db = getDb();
  return runInTransaction(db, () => {
    const row = db
      .prepare(
        `
        SELECT id, master_id, starts_at, ends_at, reason, created_at, kind
        FROM master_time_blocks
        WHERE id = ?
        `,
      )
      .get(id);
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "Блокировка не найдена");
    }
    db.prepare("DELETE FROM master_time_blocks WHERE id = ?").run(id);
    return { deleted: true, time_block: serializeTimeBlock(db, row) };
  });
}
