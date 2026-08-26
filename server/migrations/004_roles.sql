-- Roles as a list (junction), not clients.role.
-- masters.client_id links a master-role account to a schedule row.

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE client_roles (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (client_id, role_id),
  CONSTRAINT fk_client_roles_client
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
  CONSTRAINT fk_client_roles_role
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT
);

CREATE INDEX idx_client_roles_role_id
  ON client_roles (role_id);

INSERT INTO roles (id, slug, created_at) VALUES
  (1, 'client', '2026-08-26T00:00:00Z'),
  (2, 'master', '2026-08-26T00:00:00Z'),
  (3, 'administrator', '2026-08-26T00:00:00Z');

ALTER TABLE masters ADD COLUMN client_id INTEGER REFERENCES clients (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_masters_client_id
  ON masters (client_id)
  WHERE client_id IS NOT NULL;
