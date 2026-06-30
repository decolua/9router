export const CODEX_SUBAGENT_DESCRIPTION = "9Router subagent for delegated coding and exploration tasks";

export function extendCodexSubagentConfig(config) {
  return {
    description: CODEX_SUBAGENT_DESCRIPTION,
    ...config,
  };
}

