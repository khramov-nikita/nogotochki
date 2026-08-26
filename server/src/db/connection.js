import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertNodeForSqlite } from "./engine.js";

assertNodeForSqlite();

const { DatabaseSync } = await import("node:sqlite");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "../../..");
export const SERVER_ROOT = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

const DEFAULT_DATABASE_PATH = path.join(PROJECT_ROOT, "data", "nogotochki.sqlite");

function resolveDatabasePath() {
  const fromEnv = process.env.DATABASE_PATH?.trim();
  if (!fromEnv) {
    return DEFAULT_DATABASE_PATH;
  }
  return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(PROJECT_ROOT, fromEnv);
}

export const DATABASE_PATH = resolveDatabasePath();

let db = null;

export function getDb() {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

  db = new DatabaseSync(DATABASE_PATH, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");

  return db;
}

export function runInTransaction(database, fn) {
  // IMMEDIATE берёт RESERVED сразу, а не на первой записи (DEFERRED).
  // Иначе два клиента оба читают «свободно» и оба вставляют.
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
