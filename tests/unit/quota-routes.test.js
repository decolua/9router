import { it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createApiKey, updateApiKey, getApiKeyById, deleteApiKey } from '../../src/lib/db/repos/apiKeysRepo.js';
import { createDashboardAuthToken } from '../../src/lib/auth/dashboardSession.js';
import { PUT } from '../../src/app/api/keys/[id]/route.js';
import * as auth from '../../src/sse/services/auth.js';
const routes = ['chat/completions','responses','responses/compact','messages','embeddings','audio/speech','audio/transcriptions','images/generations','videos/generations','videos/edits','videos/extensions','web/fetch','search'];
it('authenticated quota roundtrip and unauthorized writes, strict booleans', async () => {
 const key = await createApiKey('management fixture','quota-machine');
 const token = await createDashboardAuthToken();
 const send = (body, headers={}) => PUT(new NextRequest('http://localhost/api/keys/'+key.id,{method:'PUT',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}),{params:Promise.resolve({id:key.id})});
 try {
  for (const headers of [{},{authorization:'Bearer '+key.key},{cookie:'auth_token=invalid'}]) expect((await send({quotaExhausted:true},headers)).status).toBe(401);
  const headers={cookie:'auth_token='+token};
  for (const quotaExhausted of ['true','false',null,1,0,{},[]]) expect((await send({quotaExhausted},headers)).status).toBe(400);
  for (const quotaExhausted of [true,false]) {
   expect((await send({quotaExhausted},headers)).status).toBe(200);
   expect(await getApiKeyById(key.id)).toMatchObject({key:key.key,isActive:true,quotaExhausted});
  }
 } finally {await deleteApiKey(key.id);}
});
it.each(routes)('blocks %s before any network call even optional key auth', async route => {
 const key=await createApiKey('blocked fixture','quota-machine');
 const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw new Error('upstream forbidden');});
 const dispatchSpy=vi.spyOn(auth,'getProviderCredentials');
 try {
  await updateApiKey(key.id,{quotaExhausted:true});
  const {POST}=await import('../../src/app/api/v1/'+route+'/route.js');
  const response=await POST(new NextRequest('http://localhost/api/v1/'+route,{method:'POST',headers:{'content-type':'application/json',...(route==='messages'?{'x-api-key':key.key}:{authorization:'Bearer '+key.key})},body:JSON.stringify({model:'fixture/model',messages:[],input:'fixture'})}));
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({error:{code:'insufficient_quota',message:'Local quota exceeded'}});
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(dispatchSpy).not.toHaveBeenCalled();
 } finally {dispatchSpy.mockRestore();fetchSpy.mockRestore();await deleteApiKey(key.id);}
});
