const fs = require("fs");

const chunksDir = "C:/Users/Admin/AppData/Roaming/npm/node_modules/9router/app/.next-cli-build/server/chunks";
const chunkPath = fs.readdirSync(chunksDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => `${chunksDir}/${name}`)
  .find((path) => {
    const text = fs.readFileSync(path, "utf8");
    return text.includes("prompt_cache_retention") && text.includes("codex_cli_rs");
  });

if (!chunkPath) throw new Error("Could not find installed Codex executor chunk");
let code = fs.readFileSync(chunkPath, "utf8");

const oldResolver = 'this._currentSessionId=function(a,b,c){let d=v(a?.prompt_cache_key)||v(a?.session_id)||v(a?.conversation_id);if(d)return d;if(Array.isArray(a?.input)&&a.input.length>0){let b="";for(let c of a.input){if(c?.role!=="assistant")continue;let a=c?"string"==typeof c.content?c.content:Array.isArray(c.content)?c.content.map(a=>a.text||a.output||"").filter(Boolean).join(""):"":"";if(a&&(b+=a).length>=200)break}if(b.length>=50){let a=t((c||"")+b.slice(0,200)),d=o.get(a);if(d)return d.lastUsed=Date.now(),d.sessionId;let e=u();return o.set(a,{sessionId:e,lastUsed:Date.now()}),e}}let e=v(b?.providerSpecificData?.workspaceId);return e||(c?`sess_${t(c)}`:u())}(b,d,s);';

const newResolver = 'this._currentSessionId=function(a,b,c){let d=v(a?.prompt_cache_key)||v(a?.session_id)||v(a?.conversation_id);if(d)return d;let e=[c||"unknown-machine",a?.instructions||""];if(Array.isArray(a?.input))for(let b of a.input)if(b?.role==="user"){let a=b?"string"==typeof b.content?b.content:Array.isArray(b.content)?b.content.map(a=>a.text||a.output||"").filter(Boolean).join(""):"":"";if(a){e.push(a);break}}let f="auto:"+t(e.join("\\n---\\n")),g=o.get(f);if(g)return g.lastUsed=Date.now(),g.sessionId;let h=`sess_${t(f)}`;return o.set(f,{sessionId:h,lastUsed:Date.now()}),h}(b,d,s);';

if (code.includes(newResolver)) {
  console.log("Codex cache resolver already patched");
} else {
  const count = code.split(oldResolver).length - 1;
  if (count !== 1) throw new Error(`Expected 1 old resolver match, got ${count}`);
  code = code.replace(oldResolver, newResolver);
  fs.writeFileSync(chunkPath, code);
  console.log(`Patched Codex cache resolver in ${chunkPath}`);
}

new Function(code);
console.log("Syntax OK");
