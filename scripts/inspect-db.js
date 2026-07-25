const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('/app/data/db/data.sqlite');

// Check tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('Tables:', tables.join(', '));

// Check combos table
const comboCols = tables.includes('combos') 
  ? db.prepare("PRAGMA table_info(combos)").all().map(c => c.name)
  : [];
console.log('Combo columns:', comboCols.join(', ') || 'N/A');

// Check if there's a models or modelAliases table
for (const t of ['models', 'modelAliases', 'customModels', 'disabledModels', 'providerConnections']) {
  if (tables.includes(t)) {
    const rows = db.prepare(`SELECT * FROM ${t} LIMIT 5`).all();
    console.log(`\n=== ${t} (${rows.length} rows) ===`);
    rows.forEach(r => console.log(JSON.stringify(r)));
  }
}

db.close();
