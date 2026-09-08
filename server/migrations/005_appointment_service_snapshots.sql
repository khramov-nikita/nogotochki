-- Snapshot price and duration on the visit; operational on/off for services.
-- is_bookable stays "can go into the stepper" (certificate = 0). is_active is the admin toggle.

ALTER TABLE services ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE appointment_services ADD COLUMN price_rub INTEGER;
ALTER TABLE appointment_services ADD COLUMN duration_min_minutes INTEGER;
ALTER TABLE appointment_services ADD COLUMN duration_max_minutes INTEGER;

UPDATE appointment_services
SET
  price_rub = (SELECT s.price_rub FROM services s WHERE s.id = appointment_services.service_id),
  duration_min_minutes = (SELECT s.duration_min_minutes FROM services s WHERE s.id = appointment_services.service_id),
  duration_max_minutes = (SELECT s.duration_max_minutes FROM services s WHERE s.id = appointment_services.service_id);
