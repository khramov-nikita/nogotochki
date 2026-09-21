import { getDb } from "./connection.js";
import { seed } from "./seed.js";

/** First boot: passport catalog if services table is empty. */
export function ensureCatalogSeed() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
  if (count > 0) {
    return;
  }
  console.log("catalog seed: services empty, running seed()");
  seed();
}
