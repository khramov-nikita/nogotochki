import fs from "node:fs";
import { isMainModule } from "./cli.js";
import { DATABASE_PATH, closeDb } from "./connection.js";
import { applyMigrations } from "./migrate.js";
import { seed } from "./seed.js";

const SIDECARS = ["-wal", "-shm", "-journal"];

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
  removeDatabaseFiles();
  applyMigrations();
  seed();
  closeDb();
  console.log("database recreated from scratch");
}

if (isMainModule(import.meta.url)) {
  resetDatabase();
}
