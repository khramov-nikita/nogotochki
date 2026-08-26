-- Признак осознанного наложения. 002 не переписываем.
-- Триггер пропускает NEW.overlap_override = 1; чужие строки с флагом всё равно занимают слот.

ALTER TABLE appointments
  ADD COLUMN overlap_override INTEGER NOT NULL DEFAULT 0 CHECK (overlap_override IN (0, 1));

DROP TRIGGER IF EXISTS appointments_no_overlap_insert;
DROP TRIGGER IF EXISTS appointments_no_overlap_update;

CREATE TRIGGER appointments_no_overlap_insert
BEFORE INSERT ON appointments
WHEN NEW.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
 AND NEW.overlap_override = 0
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM appointments AS other
    WHERE other.master_id = NEW.master_id
      AND other.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
      AND NEW.starts_at < other.ends_at
      AND NEW.ends_at > other.starts_at
  );
END;

CREATE TRIGGER appointments_no_overlap_update
BEFORE UPDATE OF master_id, starts_at, ends_at ON appointments
WHEN NEW.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
 AND NEW.overlap_override = 0
BEGIN
  SELECT RAISE(ABORT, 'APPOINTMENT_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM appointments AS other
    WHERE other.master_id = NEW.master_id
      AND other.id != NEW.id
      AND other.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
      AND NEW.starts_at < other.ends_at
      AND NEW.ends_at > other.starts_at
  );
END;
