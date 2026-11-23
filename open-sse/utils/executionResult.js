// Internal metadata never travels in provider payloads or client response bodies.
export function executionResult(response, target) {
  return { response, target };
}

// Keep Response-only callbacks usable by media combos and existing integrations.
export function normalizeExecutionResult(result) {
  return result?.response && "target" in result ? result : { response: result, target: null };
}
