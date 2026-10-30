export function getSmartPolicyDraft(strategy = {}) {
  let policy = strategy.smartPolicy || (strategy.sessionSticky === false ? "per-turn" : "smart");
  const raw = Number(strategy.confidenceThreshold);
  let threshold = Number.isFinite(raw) && raw > 0 ? Math.round(raw <= 1 ? raw * 100 : raw) : 80;
  if (policy === "smart-switch-70") threshold = 70;
  if (policy === "smart-switch-90") threshold = 90;
  if (policy.startsWith("smart-switch")) policy = "smart";
  if (policy === "smart" && threshold !== 80) policy = "custom";
  return { policy, threshold };
}

export function getSmartPolicyLabel(strategy) {
  const { policy, threshold } = getSmartPolicyDraft(strategy);
  if (policy === "strict") return "Strict lock";
  if (policy === "per-turn") return "Per turn";
  return `${policy === "custom" ? "Custom" : "Smart"} ${threshold}%`;
}
