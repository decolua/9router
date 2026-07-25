const Database = require('better-sqlite3');
const db = new Database('/app/data/db/data.sqlite');
const combos = db.prepare('SELECT id, name, kind FROM combos').all();
console.log('Combos count:', combos.length);
combos.forEach(c => console.log('  [' + c.id.substring(0,8) + '] ' + c.kind + ' -> ' + c.name));

const provs = db.prepare('SELECT provider, name, isActive FROM providerConnections').all();
console.log('\nProviders count:', provs.length);
provs.forEach(p => console.log('  ' + p.provider + ' -> ' + p.name + ' active=' + p.isActive));
db.close();
