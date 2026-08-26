import fs from "node:fs";
import { isMainModule } from "./cli.js";
import { DATABASE_PATH, closeDb, getDb } from "./connection.js";
import { applyMigrations } from "./migrate.js";

const SIDECARS = ["-wal", "-shm", "-journal"];

function assertNotProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:reset нельзя запускать при NODE_ENV=production");
  }
}

function removeDatabaseFiles() {
  closeDb();

  const files = [DATABASE_PATH, ...SIDECARS.map((suffix) => DATABASE_PATH + suffix)];
  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`removed ${file}`);
    }
  }
}

export function resetDatabase() {
  assertNotProduction();
  removeDatabaseFiles();
  applyMigrations();

  const db = getDb();
  const applied = db
    .prepare("SELECT name FROM schema_migrations ORDER BY name")
    .all()
    .map((row) => row.name);
  console.log(`migrations (${applied.length}): ${applied.join(", ") || "(none)"}`);
  closeDb();
  console.log("database recreated from migrations");
}

if (isMainModule(import.meta.url)) {
  resetDatabase();
}
