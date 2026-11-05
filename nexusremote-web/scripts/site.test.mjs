import assert from 'node:assert/strict';
import{createSession,parseSession}from'../lib/auth.js';
import{readFileSync}from'node:fs';
process.env.ADMIN_API_TOKEN='test_key_that_is_unique_and_long_enough_for_tests_42';
const token=createSession('owner',null,1000);
assert.equal(parseSession(token,2000)?.role,'owner');
assert.equal(parseSession(token.slice(0,-2)+'xx',2000),null);
assert.equal(parseSession(token,1000+9*3600000),null);
const worker=createSession('worker','NX-ABCDEF12',1000);
assert.equal(parseSession(worker,2000)?.agentId,'NX-ABCDEF12');
assert.throws(()=>createSession('worker','NOT_VALID',1000));
for(const f of ['public/index.html','public/login.html','public/apply.html','public/portal.html','public/styles.css','public/site.js']){
 assert.ok(readFileSync(f,'utf8').length>1000,'missing site asset '+f);
}
const html=readFileSync('public/index.html','utf8');assert.match(html,/NEXUSREMOTE/i);assert.match(html,/No applicant fees/i);
const login=readFileSync('public/login.html','utf8');assert.match(login,/autocomplete="off"/);
const portal=readFileSync('public/portal.html','utf8');assert.match(portal,/Verified payments/i);
const source=readFileSync('api/portal.js','utf8');assert.match(source,/SIGN_IN_REQUIRED/);
console.log('NEXUS_MIRROR_PORTAL_AUTH_AND_UI_ASSERTIONS_PASSED');
