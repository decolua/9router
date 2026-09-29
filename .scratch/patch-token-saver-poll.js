/**
 * Hot-patch installed token-saver chunk: visibility/focus sync (EndpointPageClient pattern),
 * poll only while tab visible — not a global always-on poll.
 */
const fs = require("fs");
const path = require("path");

const chunk = path.join(
  process.env.APPDATA,
  "npm/node_modules/9router/app/.next-cli-build/static/chunks/app/(dashboard)/dashboard/token-saver/page-504a0d7ef46b00da.js"
);

let s = fs.readFileSync(chunk, "utf8");

// Replace prior always-on eSync poll if present
const alwaysOn = `let eSync=setInterval(async()=>{try{let e=await fetch("/api/settings",{headers:{"Cache-Control":"no-store"}});if(!e.ok)return;let a=await e.json();t(!1!==a.rtkEnabled),W(!!a.cavemanEnabled),X(!!a.ponytailEnabled),c(!!a.headroomEnabled)}catch{}},1500);return()=>clearInterval(eSync)},[ey,eI,eR]);`;

const visibleOnly = `let syncToggles=async()=>{try{let e=await fetch("/api/settings",{headers:{"Cache-Control":"no-store"}});if(!e.ok)return;let a=await e.json();t(!1!==a.rtkEnabled),W(!!a.cavemanEnabled),X(!!a.ponytailEnabled),c(!!a.headroomEnabled)}catch{}};let onVis=()=>{document.hidden||syncToggles()};document.addEventListener("visibilitychange",onVis);window.addEventListener("focus",onVis);let eSync=setInterval(()=>{document.hidden||syncToggles()},1500);return()=>{clearInterval(eSync);document.removeEventListener("visibilitychange",onVis);window.removeEventListener("focus",onVis)}},[ey,eI,eR]);`;

if (s.includes("let syncToggles=async")) {
  console.log("ALREADY_VISIBILITY_PATCHED");
  process.exit(0);
}

if (s.includes(alwaysOn)) {
  s = s.replace(alwaysOn, visibleOnly);
  fs.writeFileSync(chunk, s);
  console.log("GREEN: upgraded always-on poll → visibility-aware");
  process.exit(0);
}

// Fresh install without prior patch: inject after original useEffect closer
const old = `(0,l.useEffect)(()=>{(async()=>{try{let e=await fetch("/api/settings");if(e.ok){let a=await e.json();t(!1!==a.rtkEnabled),c(!!a.headroomEnabled),m(a.headroomUrl||"http://localhost:8787"),"number"==typeof a.headroomTimeoutMs&&h(a.headroomTimeoutMs),H(!0===a.headroomCodeAware),_(!1!==a.headroomKompress),W(!!a.cavemanEnabled),G(a.cavemanLevel||"full"),X(!!a.ponytailEnabled),Y(a.ponytailLevel||"full"),Z(!!a.pxpipeEnabled),"number"==typeof a.pxpipeMinChars&&ee(a.pxpipeMinChars),ey(),eI().then(eR)}}catch{}})()},[ey,eI,eR]);`;

const neu = `(0,l.useEffect)(()=>{(async()=>{try{let e=await fetch("/api/settings",{headers:{"Cache-Control":"no-store"}});if(e.ok){let a=await e.json();t(!1!==a.rtkEnabled),c(!!a.headroomEnabled),m(a.headroomUrl||"http://localhost:8787"),"number"==typeof a.headroomTimeoutMs&&h(a.headroomTimeoutMs),H(!0===a.headroomCodeAware),_(!1!==a.headroomKompress),W(!!a.cavemanEnabled),G(a.cavemanLevel||"full"),X(!!a.ponytailEnabled),Y(a.ponytailLevel||"full"),Z(!!a.pxpipeEnabled),"number"==typeof a.pxpipeMinChars&&ee(a.pxpipeMinChars),ey(),eI().then(eR)}}catch{}})();${visibleOnly.slice(0, -1)}`;

// visibleOnly ends with `},[ey,eI,eR]);` — careful with composition
const neu2 = `(0,l.useEffect)(()=>{(async()=>{try{let e=await fetch("/api/settings",{headers:{"Cache-Control":"no-store"}});if(e.ok){let a=await e.json();t(!1!==a.rtkEnabled),c(!!a.headroomEnabled),m(a.headroomUrl||"http://localhost:8787"),"number"==typeof a.headroomTimeoutMs&&h(a.headroomTimeoutMs),H(!0===a.headroomCodeAware),_(!1!==a.headroomKompress),W(!!a.cavemanEnabled),G(a.cavemanLevel||"full"),X(!!a.ponytailEnabled),Y(a.ponytailLevel||"full"),Z(!!a.pxpipeEnabled),"number"==typeof a.pxpipeMinChars&&ee(a.pxpipeMinChars),ey(),eI().then(eR)}}catch{}})();let syncToggles=async()=>{try{let e=await fetch("/api/settings",{headers:{"Cache-Control":"no-store"}});if(!e.ok)return;let a=await e.json();t(!1!==a.rtkEnabled),W(!!a.cavemanEnabled),X(!!a.ponytailEnabled),c(!!a.headroomEnabled)}catch{}};let onVis=()=>{document.hidden||syncToggles()};document.addEventListener("visibilitychange",onVis);window.addEventListener("focus",onVis);let eSync=setInterval(()=>{document.hidden||syncToggles()},1500);return()=>{clearInterval(eSync);document.removeEventListener("visibilitychange",onVis);window.removeEventListener("focus",onVis)}},[ey,eI,eR]);`;

if (s.includes(old)) {
  fs.writeFileSync(chunk, s.replace(old, neu2));
  console.log("GREEN: patched from stock chunk");
  process.exit(0);
}

console.error("RED: could not find snippet to patch");
process.exit(1);
