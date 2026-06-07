export function resolveCommandCodeCliBin({ env = process.env, platform = process.platform } = {}) {
  const override = env?.COMMAND_CODE_CLI_BIN;
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }
  return platform === "win32" ? "commandcode" : "cmd";
}
