import {it,expect,vi} from 'vitest';
import {JSDOM} from '../../.quota-ui-deps/node_modules/jsdom/lib/api.js';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Page from '../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js';
it('quota toggle disables while saving, deduplicates clicks, restores on failure and toggles back',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/dashboard/endpoint'});
 vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('navigator',dom.window.navigator);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const alert=vi.fn();vi.stubGlobal('alert',alert);
 let resolve;const writes=[];
 vi.stubGlobal('fetch',vi.fn((url,opts)=>{
  if(opts?.method==='PUT'){writes.push(JSON.parse(opts.body));return new Promise(r=>{resolve=r;});}
  return Promise.resolve({ok:true,json:async()=>url==='/api/keys'?{keys:[{id:'fixture',name:'fixture',key:'fixture-key',isActive:true,quotaExhausted:false}]}:{}});
 }));
 const root=createRoot(document.getElementById('root'));
 try{
 await act(async()=>{root.render(React.createElement(Page,{machineId:'fixture'}));});
 const toggle=()=>[...document.querySelectorAll('label')].find(el=>el.textContent.includes('Local quota exhausted'))?.querySelector('button');
 expect(toggle()).not.toBeNull();
 await act(async()=>{toggle().click();toggle().click();});
 expect(writes).toEqual([{quotaExhausted:true}]);expect(toggle().disabled).toBe(true);
 await act(async()=>resolve({ok:false,json:async()=>({error:'denied'})}));
 expect(alert).toHaveBeenCalledWith('denied');expect(toggle().disabled).toBe(false);
 await act(async()=>toggle().click());
 await act(async()=>resolve({ok:true,json:async()=>({key:{quotaExhausted:true}})}));
 await act(async()=>toggle().click());
 expect(writes.at(-1)).toEqual({quotaExhausted:false});
 await act(async()=>resolve({ok:true,json:async()=>({key:{quotaExhausted:false}})}));
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();dom.window.close();}
});
