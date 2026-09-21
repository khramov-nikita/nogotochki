import { getDb, runInTransaction } from "./connection.js";
import { hashPasswordSync } from "../domain/password.js";
import {
  ROLE_ADMINISTRATOR,
  ROLE_CLIENT,
  assignRole,
} from "../domain/roles.js";
import { nowUtcIso } from "../domain/time.js";

function hasAdministrator(db) {
  const row = db
    .prepare(
      `
      SELECT 1 AS ok
      FROM client_roles cr
      JOIN roles r ON r.id = cr.role_id
      WHERE r.slug = ?
      LIMIT 1
      `,
    )
    .get(ROLE_ADMINISTRATOR);
  return Boolean(row);
}

/**
 * One-shot admin for empty production DB.
 * Credentials only from env (Coolify), never from compose/git.
 */
export function bootstrapAdmin() {
  const db = getDb();
  if (hasAdministrator(db)) {
    return;
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";

  if (!email || !email.includes("@") || password.length < 8) {
    console.warn(
      "bootstrap-admin: нет администратора. Задайте BOOTSTRAP_ADMIN_EMAIL и BOOTSTRAP_ADMIN_PASSWORD в env Coolify (пароль ≥ 8), затем перезапустите.",
    );
    return;
  }

  const now = nowUtcIso();
  const password_hash = hashPasswordSync(password);

  runInTransaction(db, () => {
    const existing = db.prepare("SELECT id FROM clients WHERE email = ?").get(email);
    let clientId;
    if (existing) {
      clientId = existing.id;
      db.prepare(
        `
        UPDATE clients
        SET password_hash = ?, updated_at = ?
        WHERE id = ?
        `,
      ).run(password_hash, now, clientId);
    } else {
      const result = db
        .prepare(
          `
          INSERT INTO clients (email, password_hash, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(email, password_hash, "Администратор", now, now);
      clientId = Number(result.lastInsertRowid);
    }

    assignRole(db, clientId, ROLE_CLIENT, now);
    assignRole(db, clientId, ROLE_ADMINISTRATOR, now);
  });

  console.log(`bootstrap-admin: создан администратор ${email}`);
}
