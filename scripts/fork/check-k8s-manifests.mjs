/**
 * Validate a 9Router Kubernetes bundle.
 *
 *   node scripts/fork/check-k8s-manifests.mjs <dir-with-kustomization.yaml>
 *
 * Two jobs. The ordinary one: everything parses, and the references between
 * documents resolve — every claimName has a PVC, every mount has a volume,
 * every PVC binds a PV with a matching storage class.
 *
 * The useful one: the traps this deployment has to avoid, which are easy to
 * undo by accident —
 *
 *   - RollingUpdate or replicas > 1, which briefly gives two pods one SQLite
 *     database on a ReadWriteMany volume;
 *
 * Not an admission check: it does not need or replace kubectl.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const yaml = require_("js-yaml");

const DIR = process.argv[2];
if (!DIR) {
  console.error();
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const kustomization = yaml.load(fs.readFileSync(path.join(DIR, "kustomization.yaml"), "utf8"));
const docs = [];
for (const file of kustomization.resources) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) {
    check(`${file} exists`, false, "listed in kustomization.yaml but not on disk");
    continue;
  }
  try {
    for (const d of yaml.loadAll(fs.readFileSync(full, "utf8"))) {
      if (d) docs.push({ file, doc: d });
    }
    check(`${file} parses`, true);
  } catch (e) {
    check(`${file} parses`, false, e.message);
  }
}

const byKind = (kind) => docs.filter((d) => d.doc.kind === kind).map((d) => d.doc);
const deployment = byKind("Deployment").find((d) => d.metadata.name === "nine-router");
check("the router Deployment is present", Boolean(deployment));

const containers = deployment?.spec?.template?.spec?.containers || [];
const router = containers.find((c) => c.name === "nine-router");

// Every claimName the pod asks for must be declared by a PVC in this bundle.
const claims = new Set(byKind("PersistentVolumeClaim").map((p) => p.metadata.name));
for (const v of deployment?.spec?.template?.spec?.volumes || []) {
  if (!v.persistentVolumeClaim) continue;
  check(`volume "${v.name}" → PVC ${v.persistentVolumeClaim.claimName} exists`,
    claims.has(v.persistentVolumeClaim.claimName),
    `no PersistentVolumeClaim named ${v.persistentVolumeClaim.claimName} in the kustomization`);
}

// Every mount must name a volume the pod declares.
const volumeNames = new Set((deployment?.spec?.template?.spec?.volumes || []).map((v) => v.name));
for (const c of containers) {
  for (const m of c.volumeMounts || []) {
    check(`${c.name} mounts "${m.name}"`, volumeNames.has(m.name),
      `container ${c.name} mounts ${m.name}, which the pod does not declare`);
  }
}

// Each PVC must bind to a PV in the bundle, with a matching storageClass.
const pvs = byKind("PersistentVolume");
for (const pvc of byKind("PersistentVolumeClaim")) {
  if (!pvc.spec.volumeName) continue;
  const pv = pvs.find((p) => p.metadata.name === pvc.spec.volumeName);
  check(`PVC ${pvc.metadata.name} → PV ${pvc.spec.volumeName}`, Boolean(pv), "no such PersistentVolume");
  if (pv) {
    check(`  storageClass matches for ${pvc.metadata.name}`,
      pv.spec.storageClassName === pvc.spec.storageClassName,
      `PV=${pv.spec.storageClassName} PVC=${pvc.spec.storageClassName}`);
  }
}

// Two PVs must not point at exactly the same directory.
const nfsPaths = pvs.filter((p) => p.spec.nfs).map((p) => `${p.spec.nfs.server}:${p.spec.nfs.path}`);
check("no two PersistentVolumes share an NFS path",
  new Set(nfsPaths).size === nfsPaths.length, nfsPaths.join(", "));

// The traps this deployment specifically has to avoid.
// The hazard is not the sidecar — it is shared single-writer state. Every
// claim here is ReadWriteMany, so a RollingUpdate does not stall waiting for a
// volume, it mounts the same one into both pods: two processes on one SQLite
// file over NFS, which corrupts it. Named from the manifests so the message
// stays true if the volumes change.
const rwxClaims = new Set(byKind("PersistentVolumeClaim")
  .filter((p) => (p.spec.accessModes || []).includes("ReadWriteMany"))
  .map((p) => p.metadata.name));
const mountedRwx = (deployment?.spec?.template?.spec?.volumes || [])
  .filter((v) => rwxClaims.has(v.persistentVolumeClaim?.claimName))
  .map((v) => v.name);

check("strategy is Recreate, not RollingUpdate",
  deployment?.spec?.strategy?.type === "Recreate",
  mountedRwx.length
    ? `${mountedRwx.join(", ")} are ReadWriteMany, so a RollingUpdate would mount each into two `
      + "pods at once — the router's SQLite database at /app/data/db cannot survive that"
    : "two pods would briefly share one browser profile and log each other out");

check("replicas is 1", deployment?.spec?.replicas === 1, `replicas=${deployment?.spec?.replicas}`);

// A tag that is reused across different image contents must be pulled every
// time. A tag that gets reused for different image contents must be pulled
// every time, or a node that cached an older build keeps serving it and the
// deploy appears to do nothing at all. A tag carrying a commit sha is content-specific and safe to
// cache; `latest` already defaults to Always in Kubernetes.
for (const c of containers) {
  const tag = String(c.image || "").split(":").pop();
  const contentSpecific = /-[0-9a-f]{7,}$/.test(tag) || String(c.image).includes("@sha256:");
  if (contentSpecific || tag === "latest") continue;
  check(`${c.name}: mutable tag "${tag}" is pulled every time`,
    c.imagePullPolicy === "Always",
    `imagePullPolicy=${c.imagePullPolicy || "(unset → IfNotPresent)"} — this tag gets reused for `
    + "different image contents, so a cached copy would be served instead of what you just pushed");
}


const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
