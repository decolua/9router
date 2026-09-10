import {it,expect,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
it('legacy JSON migration preserves true/false and missing defaults',async()=>{
 const dir=fs.mkdtempSync(path.join(process.env.DATA_DIR,'quota-legacy-'));
 vi.resetModules(); vi.doMock('../../src/lib/dataDir.js',()=>({DATA_DIR:dir}));
 const {ensureDirs}=await import('../../src/lib/db/paths.js');ensureDirs();
 fs.writeFileSync(path.join(dir,'db.json'),JSON.stringify({apiKeys:[{id:'a',key:'fixture-a',quotaExhausted:true},{id:'b',key:'fixture-b',quotaExhausted:false},{id:'c',key:'fixture-c'}]}));
 const {createBetterSqliteAdapter}=await import('../../src/lib/db/adapters/betterSqliteAdapter.js');
 const db=createBetterSqliteAdapter(path.join(dir,'db','data.sqlite'));
 const {runMigrationOnce}=await import('../../src/lib/db/migrate.js');
 await runMigrationOnce(db);
 expect(db.all('SELECT quotaExhausted FROM apiKeys ORDER BY id').map(k=>k.quotaExhausted)).toEqual([1,0,0]);
});
