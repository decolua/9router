// Ported from OmniRoute open-sse/services/autoCombo/providerRegistryAccessor.ts.
// Thin accessor over the provider REGISTRY (enables mocking in tests).
// The fork's registry default export IS the REGISTRY array.
import REGISTRY from "../../providers/registry/index.js";

export function getProviderRegistry() {
  return REGISTRY;
}
