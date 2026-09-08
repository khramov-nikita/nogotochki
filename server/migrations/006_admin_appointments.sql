-- Админский журнал отмены/переноса и вид блокировки времени мастера.
-- Отмена не удаляет строку: статус cancelled, слот свободен сам собой.

ALTER TABLE appointments ADD COLUMN cancelled_by_client_id INTEGER;
ALTER TABLE appointments ADD COLUMN cancel_reason TEXT;
ALTER TABLE appointments ADD COLUMN previous_starts_at TEXT;
ALTER TABLE appointments ADD COLUMN previous_ends_at TEXT;
ALTER TABLE appointments ADD COLUMN previous_master_id INTEGER;
ALTER TABLE appointments ADD COLUMN rescheduled_by_client_id INTEGER;

ALTER TABLE master_time_blocks ADD COLUMN kind TEXT NOT NULL DEFAULT 'break';
