import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createApiKey,updateApiKey,deleteApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import * as auth from '../../src/sse/services/auth.js';
import config from '../../next.config.mjs';
it('rewrite aliases execute blocked Responses route with 429',async()=>{
 const rules=await config.rewrites();const key=await createApiKey('aliases','fixture');
 const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('no network'));const dispatch=vi.spyOn(auth,'getProviderCredentials');
 try{await updateApiKey(key.id,{quotaExhausted:true});
 for(const [source,url] of [['/codex/:path*','/codex/responses'],['/responses','/responses'],['/v1/v1/:path*','/v1/v1/responses'],['/v1/:path*','/v1/responses']]){
 expect(rules.find(r=>r.source===source).destination).toContain('/api/v1/');
 const {POST}=await import('../../src/app/api/v1/responses/route.js');
 const response=await POST(new NextRequest('http://localhost'+url,{method:'POST',headers:{authorization:'Bearer '+key.key},body:'{}'}));
 expect(response.status).toBe(429);expect((await response.json()).error.code).toBe('insufficient_quota');
 }expect(spy).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
 }finally{spy.mockRestore();dispatch.mockRestore();await deleteApiKey(key.id);}
});
it('native Gemini cannot mask blocked google credential behind unrelated x-api-key',async()=>{
 const key=await createApiKey('conflicting headers','fixture');const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('no network'));const dispatch=vi.spyOn(auth,'getProviderCredentials').mockResolvedValue(null);
 try{await updateApiKey(key.id,{quotaExhausted:true});
 const {POST}=await import('../../src/app/api/v1beta/models/[...path]/route.js');
 const response=await POST(new NextRequest('http://localhost/v1beta/models/fixture:generateContent',{method:'POST',headers:{'x-api-key':'unrelated','x-goog-api-key':key.key},body:JSON.stringify({generationConfig:{responseModalities:['AUDIO']}})}),{params:Promise.resolve({path:['fixture:generateContent']})});
 expect(response.status).toBe(429);expect(dispatch).not.toHaveBeenCalled();expect(spy).not.toHaveBeenCalled();
 }finally{spy.mockRestore();dispatch.mockRestore();await deleteApiKey(key.id);}
});
