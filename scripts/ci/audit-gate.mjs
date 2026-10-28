// CI gate over `npm audit --json`: fail on any high/critical advisory in production
// dependencies unless .github/audit-exceptions.json lists that exact advisory with a
// reachability reason and an unexpired reviewBy date.
// Usage: npm audit --omit=dev --json > audit.json; node scripts/ci/audit-gate.mjs audit.json
import { readFileSync } from "fs";

const BLOCKING = new Set(["high", "critical"]);

const auditPath = process.argv[2];
if (!auditPath) { console.error("Missing audit.json path"); process.exit(2); }

const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const { exceptions = [] } = JSON.parse(
  readFileSync(new URL("../../.github/audit-exceptions.json", import.meta.url), "utf8")
);

const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(exceptions.map((e) => [`${e.package}|${e.advisory}`, e]));
const expired = exceptions.filter((e) => !e.reviewBy || e.reviewBy < today);

// Each advisory object in `via` is the package's own finding; string entries point to
// the dependency that carries it and are reported under that package instead.
const findings = [];
for (const [name, vuln] of Object.entries(audit.vulnerabilities || {})) {
  for (const via of vuln.via || []) {
    if (typeof via === "string" || !BLOCKING.has(via.severity)) continue;
    const advisory = String(via.url || "").split("/").pop() || String(via.source);
    findings.push({ name, advisory, severity: via.severity, title: via.title, range: via.range, nodes: vuln.nodes });
  }
}

const blocked = findings.filter((f) => !allowed.has(`${f.name}|${f.advisory}`));
const tolerated = findings.filter((f) => allowed.has(`${f.name}|${f.advisory}`));
const used = new Set(findings.map((f) => `${f.name}|${f.advisory}`));
const stale = exceptions.filter((e) => !used.has(`${e.package}|${e.advisory}`));

for (const f of tolerated) {
  console.log(`⚠️  allowed ${f.severity} ${f.advisory} in ${f.name} (${f.range}) until ${allowed.get(`${f.name}|${f.advisory}`).reviewBy}`);
}
for (const e of stale) console.log(`ℹ️  exception ${e.advisory} (${e.package}) no longer matches a finding; remove it.`);

let failed = false;
if (expired.length) {
  failed = true;
  console.error(`\n❌ ${expired.length} audit exception(s) past reviewBy:`);
  for (const e of expired) console.error(`  - ${e.advisory} (${e.package}) reviewBy=${e.reviewBy || "missing"}`);
}
if (blocked.length) {
  failed = true;
  console.error(`\n❌ ${blocked.length} high/critical production advisory finding(s):`);
  for (const f of blocked) console.error(`  - ${f.severity} ${f.advisory} ${f.name} ${f.range}: ${f.title} [${(f.nodes || []).join(", ")}]`);
}
if (failed) process.exit(1);
console.log(`✅ No unreviewed high/critical production advisories (${tolerated.length} allowed by exception).`);
