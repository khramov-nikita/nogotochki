-- Запрет пересечения визитов одного мастера. Таблицы свободных слотов нет.
-- Стык конца и начала (15:00–16:00 и 16:00–17:00) пересечением не считается.
-- cancelled и expired слот не блокируют.

CREATE TRIGGER appointments_no_overlap_insert
BEFORE INSERT ON appointments
WHEN NEW.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
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
BEFORE UPDATE OF master_id, starts_at, ends_at, status ON appointments
WHEN NEW.status IN ('pending_prepayment', 'confirmed', 'rescheduled')
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
