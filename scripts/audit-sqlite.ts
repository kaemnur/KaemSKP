import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const sqlitePath = process.env.KAEMSKP_SQLITE_PATH || defaultSqlitePath();
const db = new Database(sqlitePath, { readonly: true });
const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as Array<{ name: string }>;

const audit = tables.map((table) => ({
  table: table.name,
  rowCount: Number((db.prepare(`select count(*) as c from ${table.name}`).get() as { c: number }).c),
  columns: db.prepare(`pragma table_info(${table.name})`).all(),
  indexes: db.prepare(`pragma index_list(${table.name})`).all(),
  foreignKeys: db.prepare(`pragma foreign_key_list(${table.name})`).all()
}));

const output = {
  sqlitePath,
  auditedAt: new Date().toISOString(),
  tables: audit
};

writeFileSync(join(process.cwd(), "sqlite-audit.json"), JSON.stringify(output, null, 2), "utf8");
console.log(`SQLite audit written: sqlite-audit.json (${tables.length} tables)`);
db.close();

function defaultSqlitePath(): string {
  const root = process.env.APPDATA || process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  return join(root, "KaemSKP", "kaemskp.db");
}
