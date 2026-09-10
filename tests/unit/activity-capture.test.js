import { it, expect } from 'vitest';
import { sanitizeActivityPayload } from '../../src/lib/activityPayload.js';
it('omits incomplete structured function arguments with a partial capture notice, retaining free text', async () => {
 const {captured} = await capture([
  {type:'response.output_item.added', output_index:0, item:{type:'function_call',id:'f',name:'login',arguments:''}},
  {type:'response.function_call_arguments.delta', output_index:0,item_id:'f',delta:'{"password":"synthetic-secret",'},
  {type:'response.incomplete',response:{output:[]}}
 ]);
 const safe = sanitizeActivityPayload(captured);
 expect(JSON.stringify(safe)).not.toContain('synthetic-secret');
 expect(safe.tool_calls[0].function).toMatchObject({arguments:'[REDACTED]', _capture:{partial:true, notice:'Incomplete function arguments omitted'}});
 const text = '{"password":"legitimate conversation fragment",';
 expect(sanitizeActivityPayload({content:text,body:text})).toEqual({content:text,body:text});
});
import { createSSEStream } from '../../open-sse/utils/stream.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

async function capture(events, mode = 'translate', chunkSize = 7) {
 let captured;
 const wire = events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
 const bytes = new TextEncoder().encode(wire);
 const source = new ReadableStream({start(c) { for(let i=0;i<bytes.length;i+=chunkSize) c.enqueue(bytes.slice(i,i+chunkSize)); c.close(); }});
 const output = await new Response(source.pipeThrough(createSSEStream({mode, targetFormat:FORMATS.OPENAI_RESPONSES, sourceFormat:FORMATS.OPENAI_RESPONSES, onStreamComplete: value => { captured=value; }}))).text();
 return {captured,output};
}
for (const mode of ['translate','passthrough']) it(`captures fragmented Responses text/reasoning/tools in ${mode}`, async () => {
 const events = [
 {type:'response.output_text.delta', item_id:'m', output_index:0, content_index:0, delta:'Hello 🌍'},
 {type:'response.reasoning_summary_text.delta', item_id:'r', output_index:1, summary_index:0, delta:'Synthetic thought'},
 {type:'response.output_item.added', output_index:2, item:{type:'function_call',id:'f',call_id:'call_1',name:'lookup',arguments:''}},
 {type:'response.function_call_arguments.delta', item_id:'f',output_index:2,delta:'{"q":'},
 {type:'response.function_call_arguments.delta', item_id:'f',output_index:2,delta:'"test"}'},
 {type:'response.completed',response:{output:[],usage:{input_tokens:1,output_tokens:2}}}
 ];
 const {captured,output}=await capture(events,mode);
 expect(output).toContain('Hello 🌍');
 expect(captured.content).toBe('Hello 🌍');
 expect(captured.thinking).toBe('Synthetic thought');
 expect(captured.tool_calls).toEqual([{id:'call_1',type:'function',function:{name:'lookup',arguments:'{"q":"test"}'}}]);
});
it('uses completed snapshots without duplicating deltas and captures tool-only output', async () => {
 const item = {type:'message',id:'m',content:[{type:'output_text',text:'Hello'}]};
 const {captured} = await capture([
 {type:'response.output_text.delta',output_index:0,content_index:0,delta:'Hel'},
 {type:'response.output_text.done',output_index:0,content_index:0,text:'Hello'},
 {type:'response.completed',response:{output:[item,{type:'reasoning',summary:[{type:'summary_text',text:'Thought'}]},{type:'function_call',id:'f',call_id:'call_2',name:'test',arguments:'{}'}]}}
 ]);
 expect(captured.content).toBe('Hello'); expect(captured.thinking).toBe('Thought');
 expect(captured.tool_calls[0].function.name).toBe('test');
});
import { createActivityStreamCapture } from '../../open-sse/utils/activityStreamCapture.js';
it('bounds capture and marks partial summaries instead of growing without limit', () => {
 const collector = createActivityStreamCapture({maxChars:32, maxItems:2});
 for(let i=0;i<10;i++) collector.accept({type:'response.output_text.delta',output_index:i,delta:'x'.repeat(30)});
 const result=collector.result();
 expect(result.content.length).toBeLessThanOrEqual(32);
 expect(result.capture.truncated).toBe(true);
});
it('bounds legacy chat summary memory without changing delivered output', async () => {
 const text = 'z'.repeat(1100000);
 const {captured,output} = await capture([{choices:[{delta:{content:text,reasoning_content:text}}]}], 'passthrough', 65536);
 expect(output).toContain(text);
 expect(captured.content.length + captured.thinking.length).toBeLessThanOrEqual(1024*1024);
 expect(captured.capture.truncated).toBe(true);
});
import { extractRequestConfig } from '../../open-sse/handlers/chatCore/requestDetail.js';
it('captures Responses input and instructions without invented messages', () => {
 const body = { model: 'synthetic', input: [{role:'user',content:'synthetic input'}], instructions:'synthetic instructions' };
 expect(extractRequestConfig(body, true)).toEqual({...body, stream:true});
});
