import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createApiKey,updateApiKey,deleteApiKey,validateApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import {clientQuotaError} from '../../src/sse/services/clientQuota.js';
import {POST} from '../../src/app/api/v1beta/models/[...path]/route.js';
it('blocks native Gemini TTS with query key before fetch',async()=>{
 const key=await createApiKey('gemini fixture','quota-machine');
 const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('no upstream'));
 try {
 await updateApiKey(key.id,{quotaExhausted:true});
 const response=await POST(new NextRequest('http://localhost/api/v1beta/models/gemini-tts:generateContent?key='+key.key,{method:'POST',body:JSON.stringify({generationConfig:{responseModalities:['AUDIO']}})}),{params:Promise.resolve({path:['gemini-tts:generateContent']})});
 expect(response.status).toBe(429);expect((await response.json()).error.code).toBe('insufficient_quota');expect(spy).not.toHaveBeenCalled();
 }finally{spy.mockRestore();await deleteApiKey(key.id);}
});
it('guard leaves unknown, absent, disabled and other keys unchanged; false restores same key',async()=>{
 const a=await createApiKey('a','quota-machine');const b=await createApiKey('b','quota-machine');
 const req=key=>new NextRequest('http://localhost/v1/responses',{headers:key?{authorization:'Bearer '+key}:{}});
 try{
 await updateApiKey(a.id,{quotaExhausted:true});
 for(const key of [undefined,'invalid-fixture',b.key]) expect(await clientQuotaError(req(key))).toBe(null);
 expect(await validateApiKey('invalid-fixture')).toBe(false);
 await updateApiKey(a.id,{isActive:false});expect(await clientQuotaError(req(a.key))).toBe(null);expect(await validateApiKey(a.key)).toBe(false);
 await updateApiKey(a.id,{isActive:true,quotaExhausted:false});expect(await clientQuotaError(req(a.key))).toBe(null);expect(await validateApiKey(a.key)).toBe(true);
 }finally{await deleteApiKey(a.id);await deleteApiKey(b.id);}
});
