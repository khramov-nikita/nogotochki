-- Тестовые логины: роль живёт в clients.
-- Админки и кабинета мастера в продукте v1 нет; колонка нужна, чтобы в разработке
-- отличать администратора, мастера и клиента. Пароль по-прежнему только password_hash.

ALTER TABLE clients ADD COLUMN role TEXT NOT NULL DEFAULT 'client'
  CHECK (role IN ('client', 'master', 'admin'));
