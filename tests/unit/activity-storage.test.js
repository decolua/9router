import { it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('@/lib/usageDb.js', async () => ({
 saveRequestDetail: (...args) => import('@/lib/db/repos/requestDetailsRepo.js').then(m=>m.saveRequestDetail(...args)),
 saveRequestUsage: async()=>{}, appendRequestLog: async()=>{}, trackPendingRequest:()=>{}
}));
let db;
beforeEach(async()=> {
 vi.resetModules();
 process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'activity-storage-'));
 db=await import('@/lib/db/index.js'); await db.initDb();
 await db.updateSettings({enableObservability:true,observabilityBatchSize:1,observabilityMaxJsonSize:1024,observabilityMaxTotalSize:64});
});
it('sanitizes before buffering and caps pending bytes', async()=> {
 await db.updateSettings({observabilityBatchSize:100,observabilityMaxJsonSize:4096});
 const repo=await import('@/lib/db/repos/requestDetailsRepo.js');
 for(let i=0;i<12;i++) await repo.saveRequestDetail({id:`buffer-${i}`,request:{input:'z'.repeat(2000000),credentials:{token:'synthetic'}}});
 expect(repo.__test__.bufferedBytes()).toBeLessThanOrEqual(16*1024*1024);
 const pending=repo.__test__.pending();
 expect(pending.length).toBeGreaterThan(0);
 expect(pending[0].request.credentials).toBe('[REDACTED]');
});
it('preserves explicit low limits, strips credential previews and bounds retained bytes', async()=> {
 await db.updateSettings({observabilityMaxJsonSize:5, observabilityMaxTotalSize:1});
 const now=Date.now(); const clock=vi.spyOn(Date,'now').mockReturnValue(now+6000);
 try {
  await db.saveRequestDetail({id:'low',request:{input:'x'.repeat(9000),apiKey:'synthetic-secret'}});
  let stored; await vi.waitFor(async()=>{stored=await db.getRequestDetailById('low');expect(stored).toBeTruthy();});
  expect(stored.request).toMatchObject({_truncated:true,_limit:5120});
  expect(stored.request._preview).toBeUndefined();
  await db.updateSettings({observabilityMaxJsonSize:512,observabilityBatchSize:1});
  clock.mockReturnValue(now+12000);
  for(let i=0;i<5;i++) await db.saveRequestDetail({id:`retention-${i}`,request:{input:'y'.repeat(400000)}});
  const {getAdapter}=await import('@/lib/db/driver.js'); const adapter=await getAdapter();
  await vi.waitFor(()=>expect(adapter.get('SELECT SUM(length(CAST(data AS BLOB))) AS bytes FROM requestDetails').bytes).toBeLessThanOrEqual(1024*1024));
 } finally {clock.mockRestore();}
});
it('persists a typical 942k request and honest Responses summary through real stream callback', async()=> {
 const {buildOnStreamComplete}=await import('../../open-sse/handlers/chatCore/streamingHandler.js');
 const {createSSEStream}=await import('../../open-sse/utils/stream.js');
 const {FORMATS}=await import('../../open-sse/translator/formats.js');
 const body={model:'synthetic',input:'x'.repeat(941619),instructions:'synthetic instructions'};
 const {onStreamComplete,streamDetailId}=buildOnStreamComplete({provider:'synthetic',model:'synthetic',body,stream:true,finalBody:body,requestStartTime:Date.now()});
 const events=[
  {type:'response.output_text.delta',delta:'Synthetic result'},
  {type:'response.output_item.added',output_index:1,item:{type:'function_call',id:'f',name:'login',arguments:''}},
  {type:'response.function_call_arguments.delta',output_index:1,item_id:'f',delta:'{"password":"synthetic-secret",'},
  {type:'response.incomplete',response:{output:[]}}
 ];
 const bytes=new TextEncoder().encode(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
 const source=new ReadableStream({start(c){c.enqueue(bytes);c.close();}});
 await new Response(source.pipeThrough(createSSEStream({mode:'passthrough',onStreamComplete,sourceFormat:FORMATS.OPENAI_RESPONSES}))).text();
 let stored;
 await vi.waitFor(async()=>{stored=await db.getRequestDetailById(streamDetailId); expect(stored).toBeTruthy();});
 expect(stored.request.input?.length).toBe(941619);
 expect(stored.providerRequest.input?.length).toBe(941619);
 expect(stored.response.content).toBe('Synthetic result');
 expect(stored.response.capture.kind).toBe('semantic_upstream_summary');
 expect(JSON.stringify(stored)).not.toContain('synthetic-secret');
 expect(stored.response.tool_calls[0].function._capture.partial).toBe(true);
 expect(stored.providerResponse).toEqual({ _unavailable:true, reason:'Raw provider SSE is not stored; response contains a semantic upstream summary.' });
});
