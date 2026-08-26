import { isMainModule } from "./cli.js";
import { closeDb, getDb } from "./connection.js";

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

export function printSchema() {
  const db = getDb();
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
  console.log(`PRAGMA foreign_keys = ${foreignKeys.foreign_keys}`);

  const tables = db
    .prepare(
      `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
      `,
    )
    .all();

  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all();
    const fks = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(name)})`).all();

    console.log(`\n${name}`);
    for (const column of columns) {
      const flags = [
        column.type || "INTEGER",
        column.notnull ? "NOT NULL" : "NULL",
        column.pk ? "PK" : null,
      ].filter(Boolean);
      console.log(`  ${column.name}: ${flags.join(", ")}`);
    }

    if (fks.length > 0) {
      for (const fk of fks) {
        console.log(
          `  FK ${fk.from} → ${fk.table}.${fk.to} ON DELETE ${fk.on_delete}`,
        );
      }
    }
  }
}

if (isMainModule(import.meta.url)) {
  printSchema();
  closeDb();
}
