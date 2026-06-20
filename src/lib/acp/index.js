// Ported from OmniRoute src/lib/acp/index.ts.
// ACP Module — Public API. Re-exports the registry and manager.
export { detectInstalledAgents, getAgentById, getAvailableAgents, refreshAgentCache, setCustomAgents, getCustomAgentDefs, resolveVersionProbe, shouldUseShellForVersionProbe } from "./registry.js";
export { AcpManager, acpManager } from "./manager.js";
