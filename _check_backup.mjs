import initSqlJs from "sql.js";
import { readFileSync } from "fs";
const SQL = await initSqlJs();
const p = "C:\\Users\\Dmitry\\AppData\\Roaming\\9router\\db\\backups\\upgrade-0.4.80-to-0.5.2-0.5.2-20260618-020547\\data.sqlite";
const db = new SQL.Database(readFileSync(p));
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
for (const t of tables[0].values.flat()) {
  const rows = db.exec('SELECT * FROM "' + t + '" LIMIT 5');
  if (rows.length && rows[0].values.length) {
    console.log(t + ": " + rows[0].values.length + " rows");
    console.log("  cols: " + rows[0].columns.slice(0,8).join(", "));
    console.log("  val: " + JSON.stringify(rows[0].values[0].slice(0,8)));
  }
}
