import {it,expect} from 'vitest';
import {importDb,exportDb} from '../../src/lib/db/index.js';
it('full DB roundtrip preserves true/false and defaults legacy missing quota to false',async()=>{
 const apiKeys=[{id:'round-true',key:'fixture-round-true',quotaExhausted:true},{id:'round-false',key:'fixture-round-false',quotaExhausted:false},{id:'round-legacy',key:'fixture-round-legacy'}];
 await importDb({apiKeys});
 const exported=await exportDb();
 expect(exported.apiKeys.map(k=>k.quotaExhausted)).toEqual([true,false,false]);
 await importDb(JSON.parse(JSON.stringify(exported)));
 expect((await exportDb()).apiKeys).toEqual(exported.apiKeys);
});
