import fs from "node:fs";
import path from "node:path";
import { isMainModule } from "./cli.js";
import {
  DATABASE_PATH,
  SERVER_ROOT,
  closeDb,
  getDb,
  runInTransaction,
} from "./connection.js";

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const MIGRATIONS_DIR = path.join(SERVER_ROOT, "migrations");

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);
}

function appliedNames(db) {
  return new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((row) => row.name),
  );
}

export function applyMigrations() {
  const db = getDb();
  ensureMigrationsTable(db);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied = appliedNames(db);
  const insert = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    runInTransaction(db, () => {
      db.exec(sql);
      insert.run(file, nowUtc());
    });
    count += 1;
    console.log(`applied ${file}`);
  }

  if (count === 0) {
    console.log("migrations: nothing to apply");
  }

  console.log(`database: ${DATABASE_PATH}`);
}

if (isMainModule(import.meta.url)) {
  applyMigrations();
  closeDb();
}
