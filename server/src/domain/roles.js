import { HttpError } from "../http/errors.js";

export const ROLE_CLIENT = "client";
export const ROLE_MASTER = "master";
export const ROLE_ADMINISTRATOR = "administrator";

export function overlapRequested(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function clientRoles(client) {
  return Array.isArray(client?.roles) ? client.roles : [];
}

export function hasRole(client, slug) {
  return clientRoles(client).includes(slug);
}

export function hasAnyRole(client, slugs) {
  return slugs.some((slug) => hasRole(client, slug));
}

export function resolveOverlapOverride(actor, requested) {
  return hasRole(actor, ROLE_ADMINISTRATOR) && overlapRequested(requested) ? 1 : 0;
}

export function loadClientRoles(db, clientId) {
  return db
    .prepare(
      `
      SELECT r.slug
      FROM client_roles cr
      JOIN roles r ON r.id = cr.role_id
      WHERE cr.client_id = ?
      ORDER BY r.slug
      `,
    )
    .all(clientId)
    .map((row) => row.slug);
}

export function loadLinkedMasterId(db, clientId) {
  const row = db.prepare("SELECT id FROM masters WHERE client_id = ?").get(clientId);
  return row?.id ?? null;
}

export function getRoleId(db, slug) {
  const row = db.prepare("SELECT id FROM roles WHERE slug = ?").get(slug);
  if (!row) {
    throw new HttpError(500, "SERVER_ERROR", "Внутренняя ошибка сервера");
  }
  return row.id;
}

export function assignRole(db, clientId, slug, now) {
  const roleId = getRoleId(db, slug);
  db.prepare(
    `
    INSERT OR IGNORE INTO client_roles (client_id, role_id, created_at)
    VALUES (?, ?, ?)
    `,
  ).run(clientId, roleId, now);
}

export function replaceClientRoles(db, clientId, slugs, now) {
  db.prepare("DELETE FROM client_roles WHERE client_id = ?").run(clientId);
  for (const slug of slugs) {
    assignRole(db, clientId, slug, now);
  }
}

export function attachActor(db, clientRow) {
  if (!clientRow) {
    return null;
  }
  return {
    ...clientRow,
    roles: loadClientRoles(db, clientRow.id),
    master_id: loadLinkedMasterId(db, clientRow.id),
  };
}
