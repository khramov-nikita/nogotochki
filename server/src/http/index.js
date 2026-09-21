import { closeDb, getDb } from "../db/connection.js";
import { applyMigrations } from "../db/migrate.js";
import { ensureCatalogSeed } from "../db/ensure-catalog-seed.js";
import { bootstrapAdmin } from "../db/bootstrap-admin.js";
import { purgeExpiredHolds } from "../domain/cleanup.js";
import { purgeExpiredSessions } from "../domain/auth.js";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

applyMigrations();
ensureCatalogSeed();
bootstrapAdmin();

const app = createApp();
const config = getConfig();

const server = app.listen(config.port, () => {
  console.log(`nogotochki api listening on http://127.0.0.1:${config.port}`);
});

const timer = setInterval(() => {
  try {
    const db = getDb();
    purgeExpiredHolds(db);
    purgeExpiredSessions(db);
  } catch (error) {
    console.error(error);
  }
}, 60_000);
timer.unref();

function shutdown() {
  clearInterval(timer);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
