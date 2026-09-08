import { nowUtcIso } from "./time.js";

export function purgeExpiredHolds(db) {
  db.prepare("DELETE FROM booking_holds WHERE expires_at <= ?").run(nowUtcIso());
}

export function addNotification(db, { clientId, appointmentId = null, bookingHoldId = null, type, body }) {
  const text = String(body || "").trim();
  if (!text) {
    throw new Error("notification body is required");
  }
  db.prepare(
    `
    INSERT INTO notifications (
      client_id, appointment_id, booking_hold_id, type, body, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?)
    `,
  ).run(clientId, appointmentId, bookingHoldId, type, text, nowUtcIso());
}
