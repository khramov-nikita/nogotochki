-- Схема v1 «Ноготочки»: 17 таблиц из docs/db-schema.md.
-- Таблиц свободных слотов (slots / time_slots / free_slots) нет.

CREATE TABLE studio_settings (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  kicker TEXT,
  hero_image_path TEXT,
  public_location TEXT NOT NULL,
  exact_address TEXT,
  timezone TEXT NOT NULL,
  calendar_horizon_days INTEGER NOT NULL,
  slot_step_minutes INTEGER NOT NULL,
  min_lead_minutes INTEGER NOT NULL,
  reserve_minutes INTEGER NOT NULL,
  established_year INTEGER,
  regular_clients_count INTEGER,
  cancel_min_hours_before INTEGER,
  reschedule_min_hours_before INTEGER,
  reminder_hours_before INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (id = 1)
);

CREATE TABLE studio_closures (
  id INTEGER PRIMARY KEY,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (ends_on >= starts_on)
);

CREATE TABLE content_pages (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE content_page_items (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (page_id, sort_order),
  CONSTRAINT fk_content_page_items_page
    FOREIGN KEY (page_id) REFERENCES content_pages (id) ON DELETE CASCADE
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_sessions_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
);

CREATE TABLE password_reset_tokens (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_password_reset_tokens_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_rub INTEGER NOT NULL,
  price_rub_alt INTEGER,
  duration_min_minutes INTEGER,
  duration_max_minutes INTEGER,
  is_addon INTEGER NOT NULL,
  is_bookable INTEGER NOT NULL,
  validity_months INTEGER,
  image_path TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (is_addon IN (0, 1)),
  CHECK (is_bookable IN (0, 1))
);

CREATE TABLE masters (
  id INTEGER PRIMARY KEY,
  display_name TEXT,
  specialization_label TEXT NOT NULL,
  portrait_path TEXT,
  cover_path TEXT,
  is_active INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (is_active IN (0, 1))
);

CREATE TABLE master_services (
  id INTEGER PRIMARY KEY,
  master_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  UNIQUE (master_id, service_id),
  CONSTRAINT fk_master_services_master
    FOREIGN KEY (master_id) REFERENCES masters (id) ON DELETE CASCADE,
  CONSTRAINT fk_master_services_service
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE
);

CREATE TABLE master_schedule (
  id INTEGER PRIMARY KEY,
  master_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (master_id, weekday, start_time),
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (end_time > start_time),
  CONSTRAINT fk_master_schedule_master
    FOREIGN KEY (master_id) REFERENCES masters (id) ON DELETE CASCADE
);

CREATE TABLE master_time_blocks (
  id INTEGER PRIMARY KEY,
  master_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  CONSTRAINT fk_master_time_blocks_master
    FOREIGN KEY (master_id) REFERENCES masters (id) ON DELETE CASCADE
);

CREATE TABLE booking_holds (
  id INTEGER PRIMARY KEY,
  hold_token TEXT NOT NULL UNIQUE,
  client_id INTEGER,
  master_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  CONSTRAINT fk_booking_holds_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL,
  CONSTRAINT fk_booking_holds_master
    FOREIGN KEY (master_id) REFERENCES masters (id) ON DELETE CASCADE
);

CREATE TABLE booking_hold_services (
  id INTEGER PRIMARY KEY,
  hold_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE (hold_id, service_id),
  CONSTRAINT fk_booking_hold_services_hold
    FOREIGN KEY (hold_id) REFERENCES booking_holds (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_hold_services_service
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  master_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  rescheduled_at TEXT,
  expired_at TEXT,
  CHECK (ends_at > starts_at),
  CHECK (status IN (
    'pending_prepayment',
    'confirmed',
    'cancelled',
    'rescheduled',
    'expired'
  )),
  CONSTRAINT fk_appointments_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_master
    FOREIGN KEY (master_id) REFERENCES masters (id) ON DELETE RESTRICT
);

CREATE TABLE appointment_services (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE (appointment_id, service_id),
  CONSTRAINT fk_appointment_services_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_services_service
    FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE RESTRICT
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  appointment_id INTEGER,
  booking_hold_id INTEGER,
  type TEXT NOT NULL,
  is_read INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (is_read IN (0, 1)),
  CHECK (appointment_id IS NOT NULL OR booking_hold_id IS NOT NULL),
  CHECK (type IN (
    'confirmed',
    'reminder',
    'cancelled',
    'rescheduled',
    'reserve_expiring'
  )),
  CONSTRAINT fk_notifications_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_booking_hold
    FOREIGN KEY (booking_hold_id) REFERENCES booking_holds (id) ON DELETE CASCADE
);

CREATE INDEX idx_studio_closures_range
  ON studio_closures (starts_on, ends_on);

CREATE INDEX idx_appointments_client_status
  ON appointments (client_id, status);

CREATE INDEX idx_appointments_master_interval
  ON appointments (master_id, starts_at, ends_at);

CREATE INDEX idx_appointments_starts_at
  ON appointments (starts_at);

CREATE INDEX idx_booking_holds_master_interval
  ON booking_holds (master_id, starts_at, expires_at);

CREATE INDEX idx_booking_holds_expires_at
  ON booking_holds (expires_at);

CREATE INDEX idx_master_schedule_master_weekday
  ON master_schedule (master_id, weekday);

CREATE INDEX idx_master_time_blocks_master_starts
  ON master_time_blocks (master_id, starts_at);

CREATE INDEX idx_master_services_service_id
  ON master_services (service_id);

CREATE INDEX idx_sessions_client_id
  ON sessions (client_id);

CREATE INDEX idx_sessions_expires_at
  ON sessions (expires_at);

CREATE INDEX idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

CREATE INDEX idx_notifications_client_created
  ON notifications (client_id, created_at);

CREATE INDEX idx_booking_hold_services_service_id
  ON booking_hold_services (service_id);

CREATE INDEX idx_notifications_booking_hold_id
  ON notifications (booking_hold_id);
