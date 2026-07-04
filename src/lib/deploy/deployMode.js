/** Deployment mode: multi-tenant SaaS vs single-org on-premise. */
export function getDeployMode() {
  const mode = String(process.env.DEPLOY_MODE || "onprem").trim().toLowerCase();
  return mode === "saas" ? "saas" : "onprem";
}

export function isSaas() {
  return getDeployMode() === "saas";
}

export function isOnPrem() {
  return getDeployMode() === "onprem";
}
