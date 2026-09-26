const parseTomlString = (line, key) => {
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\n]*)"\\s*(?:#.*)?$`));
  return match ? match[1] : "";
};

// Only inspect the active provider table so settings from other providers cannot affect status.
export function getCurrentCodexProviderBaseUrl(config) {
  if (typeof config !== "string") return "";

  const lines = config.split(/\r?\n/);
  let modelProvider = "";
  let inRootTable = true;

  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      inRootTable = false;
      continue;
    }
    if (inRootTable) {
      modelProvider = parseTomlString(line, "model_provider") || modelProvider;
    }
  }

  if (!modelProvider) return "";

  const activeTable = `model_providers.${modelProvider}`;
  let inActiveProviderTable = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);
    if (tableMatch) {
      inActiveProviderTable = tableMatch[1] === activeTable;
      continue;
    }
    if (inActiveProviderTable) {
      const baseUrl = parseTomlString(line, "base_url");
      if (baseUrl) return baseUrl;
    }
  }

  return "";
}
