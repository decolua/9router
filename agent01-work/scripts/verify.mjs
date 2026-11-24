import assert from 'node:assert/strict';import {normalize,score} from '../api/jobs.js';import {readFileSync}from'node:fs';
const sample={guid:'https://himalayas.app/companies/acme/jobs/support',title:'Remote Virtual Assistant',companyName:'Example Co',applicationLink:'https://himalayas.app/companies/acme/jobs/support?utm_source=api',pubDate:1792890000,locationRestrictions:['South Africa'],employmentType:'Contractor',description:'<p>Assist clients with appointments and admin.</p>'};
const job=normalize(sample,'virtual assistant');assert.ok(job);assert.equal(job.title,'Remote Virtual Assistant');assert.equal(job.source,'Himalayas');assert.ok(job.score>50);assert.ok(job.applicationUrl.includes('utm_source=api'));
assert.equal(normalize({...sample,applicationLink:'javascript:alert(1)'},'assistant'),null);
assert.match(readFileSync('api/execute.js','utf8'),/DRAFT ONLY/);
assert.match(readFileSync('api/execute.js','utf8'),/SAME_ORIGIN_REQUIRED/);
assert.match(readFileSync('public/index.html','utf8'),/applicationUrl/);
console.log('AGENT01_WORK_COPILOT_7_ASSERTIONS_PASS');
