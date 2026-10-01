const parseTomlString = (line, key) => {
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(["'])([^\\n]*?)\\1\\s*(?:#.*)?$`));
  return match ? match[2] : "";
};

// Only inspect the active provider tables so other providers cannot affect the form.
export function getCurrentCodexProviderSettings(config) {
  if (typeof config !== "string") return { baseUrl: "", apiKey: "" };

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

  if (!modelProvider) return { baseUrl: "", apiKey: "" };

  const activeTable = `model_providers.${modelProvider}`;
  let inActiveProviderTable = false;
  let inActiveHeadersTable = false;
  let baseUrl = "";
  let apiKey = "";

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);
    if (tableMatch) {
      inActiveProviderTable = tableMatch[1] === activeTable;
      inActiveHeadersTable = tableMatch[1] === `${activeTable}.http_headers`;
      continue;
    }
    if (inActiveProviderTable) {
      baseUrl = parseTomlString(line, "base_url") || baseUrl;
    }
    if (inActiveHeadersTable) {
      const authorization = parseTomlString(line, "Authorization");
      const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
      apiKey = bearerMatch ? bearerMatch[1] : apiKey;
    }
  }

  return { baseUrl, apiKey };
}

export function getCurrentCodexProviderBaseUrl(config) {
  return getCurrentCodexProviderSettings(config).baseUrl;
}

export function deriveProfileNameFromModel(modelId, existingNames = []) {
  if (!modelId || typeof modelId !== "string") return "model";
  let base = "";
  const trimmed = modelId.trim();
  if (trimmed.includes("/")) {
    base = trimmed.split("/")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
  } else {
    base = trimmed.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  }
  base = base.replace(/^[-_]+|[-_]+$/g, "") || "model";
  if (base === "config") base = "model-config";

  let candidate = base;
  let counter = 2;
  while (existingNames.includes(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  return candidate;
}

export function buildCodexProfileToml({ name, model }) {
  return `# codex -p ${name}\nmodel = "${model}"\nmodel_provider = "9router"\n`;
}

export function parseCodexProfileModel(content) {
  if (typeof content !== "string") return "";
  const match = content.match(/^\s*model\s*=\s*(["'])([^"\n]+)\1/m);
  return match ? match[2] : "";
}

