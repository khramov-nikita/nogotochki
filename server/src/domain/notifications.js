import { getDb } from "../db/connection.js";
import { HttpError } from "../http/errors.js";
import { getStudioSettings } from "./settings.js";
import { hmInTimeZone, nowUtcIso } from "./time.js";
import { parseId } from "./validate.js";

function appointmentHref(appointmentId) {
  if (!appointmentId) {
    return null;
  }
  return `/cabinet-appointment.html?id=${appointmentId}`;
}

export function formatNotificationWhen(iso, timeZone) {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
  }).format(date);
  return `${weekday}, ${hmInTimeZone(date, timeZone)}`;
}

export function cancelledNotificationBody(startsAt, timeZone) {
  return `Запись на ${formatNotificationWhen(startsAt, timeZone)} отменена студией.`;
}

export function rescheduledNotificationBody(previousStartsAt, nextStartsAt, timeZone) {
  return `Запись на ${formatNotificationWhen(previousStartsAt, timeZone)} перенесена на ${formatNotificationWhen(nextStartsAt, timeZone)}.`;
}

export function overlappingNotificationBody(startsAt, timeZone) {
  return `На ваше время ${formatNotificationWhen(startsAt, timeZone)} поставили ещё одну запись.`;
}

function serializeNotification(row) {
  return {
    id: row.id,
    type: row.type,
    body: row.body || "",
    appointment_id: row.appointment_id ?? null,
    is_read: row.is_read === 1,
    created_at: row.created_at,
    href: appointmentHref(row.appointment_id),
  };
}

function unreadCountFor(db, clientId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE client_id = ? AND is_read = 0")
    .get(clientId).n;
}

export function listNotificationsForClient(clientId) {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, type, body, appointment_id, is_read, created_at
      FROM notifications
      WHERE client_id = ?
      ORDER BY created_at DESC, id DESC
      `,
    )
    .all(clientId);
  return {
    notifications: rows.map(serializeNotification),
    unread_count: unreadCountFor(db, clientId),
  };
}

export function markNotificationRead(id, clientId) {
  const notificationId = parseId(id, "id");
  const db = getDb();
  const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId);
  if (!row || row.client_id !== clientId) {
    throw new HttpError(404, "NOT_FOUND", "Уведомление не найдено");
  }
  if (row.is_read !== 1) {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(notificationId);
  }
  const updated = db.prepare("SELECT * FROM notifications WHERE id = ?").get(notificationId);
  return {
    notification: serializeNotification(updated),
    unread_count: unreadCountFor(db, clientId),
  };
}

export function studioTimezone(db = getDb()) {
  return getStudioSettings(db).timezone;
}
