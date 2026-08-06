export const CODEX_SUBAGENT_DESCRIPTION = "Fast subagent for codebase exploration";

export const buildCodexSubagentRole = (model) => ({
  description: CODEX_SUBAGENT_DESCRIPTION,
  model,
});
