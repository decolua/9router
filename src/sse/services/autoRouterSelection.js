import { DEFAULTS, classifyTaskComplexity } from "./autoRouterClassifier.js";

export class AutoRouterConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AutoRouterConfigurationError";
  }
}

export function effectiveTargets(models) {
  if (!Array.isArray(models) || models.length === 0) throw new AutoRouterConfigurationError("Auto Router requires one or more usable ordered targets.");
  const targets = models.map((target) => typeof target === "string" && target.trim() === target && target ? target : null);
  if (targets.some((target) => !target) || new Set(targets).size !== targets.length) {
    throw new AutoRouterConfigurationError("Auto Router requires distinct non-empty ordered targets.");
  }
  return targets;
}

export function selectLocalRank({ escalationScore, candidateCount, hardThreshold = DEFAULTS.hardThreshold }) {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 1) throw new AutoRouterConfigurationError("Auto Router requires one or more usable ordered targets.");
  if (!Number.isFinite(hardThreshold) || hardThreshold <= 0) throw new AutoRouterConfigurationError("Auto Router has an invalid hard threshold.");
  if (candidateCount === 1) return 0;
  if (!Number.isFinite(escalationScore)) return candidateCount - 1;
  const score = Math.max(0, escalationScore);
  if (candidateCount === 2) return score >= hardThreshold ? 1 : 0;
  return Math.min(candidateCount - 1, Math.floor(score / hardThreshold));
}

export function validateAutoTarget(comboName, target, comboStrategies = {}) {
  if (target === comboName) throw new AutoRouterConfigurationError(`Auto Router target "${target}" cannot reference its own combo.`);
  if (comboStrategies?.[target]?.fallbackStrategy === "auto") {
    throw new AutoRouterConfigurationError(`Auto Router target "${target}" is configured with fallbackStrategy "auto"; Auto Router chaining is not supported.`);
  }
}

export function selectAutoRoute({ body, comboName, models, comboStrategies = {}, classifier = classifyTaskComplexity }) {
  const candidates = effectiveTargets(models);
  for (const candidate of candidates) validateAutoTarget(comboName, candidate, comboStrategies);
  const classifierError = () => ({ score: DEFAULTS.hardThreshold, escalationScore: DEFAULTS.hardThreshold, reasons: ["classifier-error"], metadata: {} });
  let classification;
  try {
    classification = classifier(body);
  } catch {
    classification = classifierError();
  }
  if (!classification || typeof classification !== "object" || !Array.isArray(classification.reasons) || !Number.isFinite(classification.escalationScore) || !Number.isFinite(classification.score)) {
    classification = classifierError();
  }
  const conservativeReasons = new Set(["invalid-request", "empty-request", "contextless-request", "classifier-error"]);
  const isConservative = Array.isArray(classification.reasons) && classification.reasons.some((reason) => conservativeReasons.has(reason));
  const index = isConservative
    ? candidates.length - 1
    : selectLocalRank({ escalationScore: classification.escalationScore, candidateCount: candidates.length, hardThreshold: DEFAULTS.hardThreshold });
  const target = candidates[index];
  if (!target) throw new AutoRouterConfigurationError("Auto Router selected a missing target.");
  validateAutoTarget(comboName, target, comboStrategies);
  return { target, index, candidates, classification };
}
