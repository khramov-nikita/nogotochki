import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb, runInTransaction } from "../db/connection.js";
import { isAdminEmail } from "../http/config.js";
import { HttpError, isUniqueConstraint } from "../http/errors.js";
import { nowUtcIso } from "./time.js";
import { parseEmail, parseOptionalName, parseOptionalToken, parsePassword, requireBodyObject } from "./validate.js";
import { attachHoldToClient } from "./holds.js";

const BCRYPT_ROUNDS = 10;

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function publicClient(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name || null,
    is_admin: isAdminEmail(row.email),
  };
}

export function findSessionClient(token) {
  if (!token) {
    return null;
  }
  const db = getDb();
  const now = nowUtcIso();
  const row = db
    .prepare(
      `
      SELECT c.id, c.email, c.display_name, s.id AS session_id, s.expires_at
      FROM sessions s
      JOIN clients c ON c.id = s.client_id
      WHERE s.token_hash = ?
      `,
    )
    .get(hashToken(token));
  if (!row || row.expires_at <= now) {
    return null;
  }
  return row;
}

function createSession(db, clientId, sessionDays) {
  const token = createToken();
  const now = nowUtcIso();
  const expiresAt = nowUtcIso(new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000));
  db.prepare(
    `
    INSERT INTO sessions (client_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    `,
  ).run(clientId, hashToken(token), expiresAt, now);
  return { token, expires_at: expiresAt };
}

function loadClientById(db, id) {
  return db.prepare("SELECT id, email, display_name FROM clients WHERE id = ?").get(id);
}

export function registerClient(body, sessionDays) {
  const payload = requireBodyObject(body);
  const email = parseEmail(payload.email);
  const password = parsePassword(payload.password);
  const confirmation = parsePassword(payload.password_confirmation, "password_confirmation");
  if (password !== confirmation) {
    throw new HttpError(400, "VALIDATION_ERROR", "Пароли не совпадают");
  }
  const displayName = parseOptionalName(payload.display_name);
  const holdToken = parseOptionalToken(payload.hold_token);
  const db = getDb();
  const now = nowUtcIso();
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

  try {
    return runInTransaction(db, () => {
      const result = db
        .prepare(
          `
          INSERT INTO clients (email, password_hash, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(email, passwordHash, displayName, now, now);
      const clientId = Number(result.lastInsertRowid);
      attachHoldToClient(db, holdToken, clientId);
      const session = createSession(db, clientId, sessionDays);
      return { client: publicClient(loadClientById(db, clientId)), session };
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw new HttpError(409, "EMAIL_TAKEN", "Этот email уже зарегистрирован");
    }
    throw error;
  }
}

export function loginClient(body, sessionDays) {
  const payload = requireBodyObject(body);
  const email = parseEmail(payload.email);
  const password = parsePassword(payload.password);
  const holdToken = parseOptionalToken(payload.hold_token);
  const db = getDb();
  const row = db
    .prepare("SELECT id, email, display_name, password_hash FROM clients WHERE email = ?")
    .get(email);

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new HttpError(401, "UNAUTHORIZED", "Неверный email или пароль");
  }

  return runInTransaction(db, () => {
    attachHoldToClient(db, holdToken, row.id);
    const session = createSession(db, row.id, sessionDays);
    return {
      client: publicClient({ id: row.id, email: row.email, display_name: row.display_name }),
      session,
    };
  });
}

export function logoutClient(token) {
  if (!token) {
    throw new HttpError(401, "UNAUTHORIZED", "Нужна авторизация");
  }
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  if (result.changes === 0) {
    throw new HttpError(401, "UNAUTHORIZED", "Нужна авторизация");
  }
}

export function purgeExpiredSessions(db = getDb()) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowUtcIso());
}
