import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyExit, runVerification, writeReport } from '../../scripts/lib/liveVerifier.mjs';
import { parseArgs, createSystemAdapter } from '../../scripts/verify-live-9router.mjs';

const healthy = {
 deployJournal: async()=>({status:'pass',state:'DONE',startedAt:'2026-01-01T00:00:00Z'}),
 gitState: async()=>({status:'pass',expectedCommit:'abc',upstream:'abc'}),
 liveState: async()=>({status:'pass',liveCommit:'abc',version:'0.5.20'}),
 pm2State: async()=>({status:'pass',processStatus:'online',unstableRestarts:0}),
 warpState: async()=>({status:'pass',listening:true,warp:true}),
 strictProxyState: async()=>({status:'pass',total:11,strict:11,drift:0}),
 guardState: async()=>({status:'pass',httpStatus:401}), logState: async()=>({status:'pass',findings:0}),
 canaryState: async()=>({status:'pass',httpStatus:200,model:'cx/gpt-5.6-sol'}),
};

test('healthy run passes and canary is not run by default', async()=>{ const r=await runVerification({},healthy); assert.equal(r.exitCode,0); assert.deepEqual(r.gates.canary,{status:'not_run'}); });
test('operational failure exits 1', async()=>{ const r=await runVerification({}, {...healthy,warpState:async()=>({status:'fail',listening:true,warp:false})}); assert.equal(r.exitCode,1); });
test('configuration error dominates and exceptions are masked', async()=>{ const r=await runVerification({}, {...healthy,gitState:async()=>{throw new Error('SECRET')}}); assert.equal(r.exitCode,2); assert.doesNotMatch(JSON.stringify(r),/SECRET/); });
test('classification contract',()=>{ assert.equal(classifyExit([{status:'pass'}]),0); assert.equal(classifyExit([{status:'fail'}]),1); assert.equal(classifyExit([{status:'fail'},{status:'error'}]),2); });
test('continues after failures and strips extra properties', async()=>{ let called=0; const a=Object.fromEntries(Object.entries(healthy).map(([k,v])=>[k,async()=>{called++; return {...await v(),secret:'token'};} ])); a.deployJournal=async()=>{called++;return {status:'fail',state:'BAD',secret:'token'}}; const r=await runVerification({},a); assert.equal(called,8); assert.doesNotMatch(JSON.stringify(r.summary),/secret|token/); });

test('args parser validates flags',()=>{ assert.equal(parseArgs(['--canary']).canary,true); assert.equal(parseArgs(['--checkpoint','T+0']).checkpoint,'T+0'); assert.throws(()=>parseArgs(['--wat'])); assert.throws(()=>parseArgs(['--checkpoint'])); });
test('core adapter detects journal, git, live and PM2 failures', async()=>{ const outputs=new Map([['git rev-parse HEAD','abc\n'],['git rev-list --left-right --count HEAD...@{upstream}','0\t1\n'],['pm2 jlist','[]']]); const adapter=createSystemAdapter({expectedCommit:'abc',readText:async p=>p.endsWith('.deploy-latest')?'/j':'2026 STATE FAILED\n',run:async(c,a)=>({stdout:outputs.get(`${c} ${a.join(' ')}`)||'',stderr:'',code:0}),fetch:async u=>new Response(u.endsWith('/api/health')?'bad':'{}',{status:200})}); assert.equal((await adapter.deployJournal()).status,'fail'); assert.equal((await adapter.gitState()).status,'fail'); assert.equal((await adapter.liveState()).status,'fail'); assert.equal((await adapter.pm2State()).status,'fail'); });
test('security adapters classify WARP, strict drift, guard and logs', async()=>{ const rows=[{provider:'xai',data:JSON.stringify({strictProxy:true,providerSpecificData:{strictProxy:false},token:'SECRET'})}]; const adapter=createSystemAdapter({run:async(c)=>({stdout:c==='ss'?'LISTEN 127.0.0.1:40000':c==='curl'?'warp=off\ncolo=SIN':'Proxy failed, falling back to direct',stderr:'',code:0}),fetch:async()=>new Response('',{status:200}),queryRows:async()=>rows,readText:async()=>'/j'}); assert.equal((await adapter.warpState()).status,'fail'); const strict=await adapter.strictProxyState(); assert.deepEqual(strict,{status:'fail',total:1,strict:0,drift:1}); assert.equal((await adapter.guardState()).status,'fail'); assert.equal((await adapter.logState()).findings,1); assert.doesNotMatch(JSON.stringify(strict),/SECRET|token|colo/); });
test('canary validates non-empty assistant response', async()=>{ const adapter=createSystemAdapter({fetch:async()=>new Response(JSON.stringify({model:'cx/gpt-5.6-sol',choices:[{message:{content:'ok'}}]}),{status:200})}); assert.equal((await adapter.canaryState({model:'cx/gpt-5.6-sol'})).status,'pass'); });
test('report is exclusive, mode 600 and sanitized', async()=>{ const root=await mkdtemp(path.join(os.tmpdir(),'verify-')); const result=await runVerification({canary:true},healthy); const p=await writeReport(result,{reportDir:root,checkpoint:'T+0',now:new Date('2026-01-01T00:00:00Z')}); assert.equal((await stat(p)).mode & 0o777,0o600); const text=await readFile(p,'utf8'); assert.doesNotMatch(text,/authorization|cookie|socks5|trace=/i); await assert.rejects(()=>writeReport(result,{reportDir:root,checkpoint:'T+0',now:new Date('2026-01-01T00:00:00Z')})); await assert.rejects(()=>writeReport(result,{reportDir:root,checkpoint:'../x'})); });
