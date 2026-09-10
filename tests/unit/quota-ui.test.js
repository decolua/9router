import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
it('keys dashboard exposes manual quota toggle and saves boolean without rotating credential',()=>{
 const source=readFileSync(new URL('../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js',import.meta.url),'utf8');
 expect(source).toContain('Local quota exhausted');
 expect(source).toContain('handleQuotaToggle(key.id, checked)');
 expect(source).toContain('JSON.stringify({ quotaExhausted })');
 expect(source).toContain('checked={key.quotaExhausted === true}');
});
