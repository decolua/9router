import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createApiKey,updateApiKey,deleteApiKey} from '../../src/lib/db/repos/apiKeysRepo.js';
import {updateSettings} from '../../src/lib/db/repos/settingsRepo.js';
import * as auth from '../../src/sse/services/auth.js';
const routes=['chat/completions','responses','responses/compact','messages','embeddings','audio/speech','audio/transcriptions','images/generations','videos/generations','videos/edits','videos/extensions','web/fetch','search','api/chat','videos/[id]','gemini-chat','gemini-audio'];
it.each(routes)('required/optional auth and quota matrix: %s',async route=>{
 const blocked=await createApiKey('blocked','fixture'),other=await createApiKey('other','fixture'),disabled=await createApiKey('disabled','fixture');
 await updateApiKey(blocked.id,{quotaExhausted:true});await updateApiKey(disabled.id,{isActive:false,quotaExhausted:true});
 const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('no network'));
 const dispatch=vi.spyOn(auth,'getProviderCredentials').mockResolvedValue(null);
 try{
 const gemini=route.startsWith('gemini');
 const mod=await import(gemini?'../../src/app/api/v1beta/models/[...path]/route.js':'../../src/app/api/v1/'+route+'/route.js');
 for(const required of [true,false]){
 await updateSettings({requireApiKey:required});
 for(const [kind,key] of [['absent',null],['invalid','invalid-fixture'],['disabled',disabled.key],['blocked',blocked.key],['other',other.key]]){
 dispatch.mockClear();spy.mockClear();
 const headers={'content-type':'application/json',...(key?{authorization:'Bearer '+key}:{})};
 const get=route==='videos/[id]';
 const multipart=new FormData();multipart.set('model','fixture/model');
 if(route==='audio/transcriptions')delete headers['content-type'];
 const body={model:'fixture/model',messages:[],input:'fixture',query:'fixture',url:'https://example.invalid',...(route==='gemini-audio'?{generationConfig:{responseModalities:['AUDIO']}}:{})};
 const response=await mod[get?'GET':'POST'](new NextRequest('http://localhost/api/v1/'+route,{method:get?'GET':'POST',headers,...(!get?{body:route==='audio/transcriptions'?multipart:JSON.stringify(body)}:{})}),{params:Promise.resolve({id:'fixture',path:['fixture:generateContent']})});
 if(kind==='blocked'){expect(response.status).toBe(429);expect(dispatch).not.toHaveBeenCalled();}
 else if(required&&kind!=='other'){expect(response.status).toBe(401);expect(dispatch).not.toHaveBeenCalled();}
 else {expect(response.status).not.toBe(401);expect(response.status).not.toBe(429);}
 expect(spy).not.toHaveBeenCalled();
 }
 }
 }finally{dispatch.mockRestore();spy.mockRestore();await updateSettings({requireApiKey:false});for(const k of [blocked,other,disabled])await deleteApiKey(k.id);}
});
