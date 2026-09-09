-- Внешний вход (Яндекс): password_hash необязателен; provider + provider_id.
-- SQLite не снимает NOT NULL — пересоздаём clients, строки сохраняем.

CREATE TABLE clients_new (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  provider TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO clients_new (
  id, email, password_hash, display_name, provider, provider_id, created_at, updated_at
)
SELECT
  id,
  email,
  password_hash,
  display_name,
  NULL,
  NULL,
  created_at,
  updated_at
FROM clients;

DROP TABLE clients;

ALTER TABLE clients_new RENAME TO clients;

CREATE UNIQUE INDEX idx_clients_provider_id
  ON clients (provider, provider_id)
  WHERE provider IS NOT NULL AND provider_id IS NOT NULL;
