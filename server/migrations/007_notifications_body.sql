-- Текст уведомления хранится в body; тип overlapping для наложения слота.
-- SQLite не меняет CHECK — пересоздаём таблицу, строки сохраняем.

CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  appointment_id INTEGER,
  booking_hold_id INTEGER,
  type TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (is_read IN (0, 1)),
  CHECK (appointment_id IS NOT NULL OR booking_hold_id IS NOT NULL),
  CHECK (type IN (
    'confirmed',
    'reminder',
    'cancelled',
    'rescheduled',
    'reserve_expiring',
    'overlapping'
  )),
  CONSTRAINT fk_notifications_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_booking_hold
    FOREIGN KEY (booking_hold_id) REFERENCES booking_holds (id) ON DELETE CASCADE
);

INSERT INTO notifications_new (
  id, client_id, appointment_id, booking_hold_id, type, body, is_read, created_at
)
SELECT
  id,
  client_id,
  appointment_id,
  booking_hold_id,
  type,
  '',
  is_read,
  created_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX idx_notifications_client_created
  ON notifications (client_id, created_at);

CREATE INDEX idx_notifications_client_unread
  ON notifications (client_id, is_read);

CREATE INDEX idx_notifications_booking_hold_id
  ON notifications (booking_hold_id);
