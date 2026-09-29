const fs = require("fs");
const p = "C:/Users/vitou/AppData/Roaming/npm/node_modules/9router/app/.next-cli-build/static/chunks/app/(dashboard)/dashboard/token-saver/page-504a0d7ef46b00da.js";
const s = fs.readFileSync(p, "utf8");
const needle = '(0,l.useEffect)(()=>{(async()=>{try{let e=await fetch("/api/settings")';
const idx = s.indexOf(needle);
console.log("idx", idx);
console.log(s.slice(idx, idx + 1500));
