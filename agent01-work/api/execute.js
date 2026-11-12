function plain(v,n=600){return String(v||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n)}
const tasks={
 'prepare-application':({title,company,details,skills})=>({
  label:'Application preparation complete (draft only)',
  output:`Subject: Interest in ${title} — ${company}\n\nHello ${company} hiring team,\n\nI am interested in the ${title} opportunity. From the published description, I understand the role involves ${details.slice(0,170)||'supporting the team with defined deliverables'}.\n\n${skills?'My relevant background: '+skills+'.\n\n':''}I would welcome a discussion about your requirements, scope, timeline and how I could contribute. I can provide suitable work examples and references on request.\n\nKind regards\n[Your name]\n\nDRAFT ONLY — not sent or applied.`,
  checks:['Review role requirements and location eligibility','Replace placeholders and verify all personal claims','Apply using the original application link after reviewing']
 }),
 'make-work-plan':({title,company,details})=>({
  label:'Work plan created (not executed on external systems)',
  output:`Work plan — ${title} at ${company}\n\n1. Confirm project scope, hiring status, eligibility and terms with ${company}.\n2. Extract concrete deliverables from the published role and map them to your actual skills.\n3. Prepare one tailored work sample or portfolio item showing relevant results.\n4. Review compensation and contract conditions before accepting any work.\n5. Submit a truthful application through the published link.\n\nRole notes: ${details.slice(0,250)||'Read the full official listing before proceeding.'}`,
  checks:['No fabricated achievements or qualifications','Relevant deliverables and acceptance criteria documented','No application submitted without your review']
 }),
 'qualify-lead':({title,company,details})=>({
  label:'Lead qualification checklist prepared',
  output:`Lead: ${company} — ${title}\nPublic signal: ${company} has a posted role. This is a work opportunity, NOT proof that the company wants to purchase your services.\n\nQualification questions:\n- Is the opening current and open to your location?\n- Are paid deliverables and compensation explicit?\n- Does your actual portfolio meet the requirements?\n- Who is the authorized contact through the official listing?\n- Are there upfront-payment or identity-risk warnings?\n\nJob summary: ${details.slice(0,250)}`,
  checks:['Official job and apply URL verified','Eligibility unresolved unless verified on listing','No personal contact data guessed']
 })
};
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'POST_ONLY'});
 const origin=String(req.headers.origin||'');if(!origin||origin!=='https://'+req.headers.host)return res.status(403).json({error:'SAME_ORIGIN_REQUIRED'});
 if(!String(req.headers['content-type']||'').includes('application/json'))return res.status(415).json({error:'JSON_REQUIRED'});
 const type=String(req.body?.action||'');if(!Object.hasOwn(tasks,type))return res.status(400).json({error:'UNSUPPORTED_ACTION'});
 const title=plain(req.body?.job?.title,140),company=plain(req.body?.job?.company,120),details=plain(req.body?.job?.summary,500),skills=plain(req.body?.skills,450);
 if(!title||!company)return res.status(400).json({error:'JOB_DETAILS_REQUIRED'});
 const result=tasks[type]({title,company,details,skills});
 return res.status(200).json({success:true,action:type,...result,execution:'Local document preparation; no email, job application, third-party account or payment action was performed.',generatedAt:new Date().toISOString()});
}