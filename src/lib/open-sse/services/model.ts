import { ALIAS_TO_ID } from "@/shared/constants/providers";

/**
 * Resolve provider alias to internal provider ID
 * Format: "cc" -> "claude", "ag" -> "antigravity", etc.
 */
export function resolveProviderAlias(alias: string): string {
  return (ALIAS_TO_ID as any)[alias] || alias;
}

/**
 * Parse model string into provider and model name
 * Format: "provider/model" or "alias/model" or "model"
 */
export function parseModel(modelStr: string): { provider: string | null; model: string; isAlias: boolean; providerAlias: string | null } {
  if (!modelStr) return { provider: null, model: "", isAlias: true, providerAlias: null };

  // Provider/Model format
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias: string, aliases: Record<string, any> | null): { provider: string; model: string } | null {
  if (!aliases) return null;

  const resolved = aliases[alias];
  if (!resolved) return null;

  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfoCore(modelStr: string, aliasesOrGetter: Record<string, any> | (() => Promise<Record<string, any>>)): Promise<{ provider: string; model: string }> {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider || "openai",
      model: parsed.model,
    };
  }

  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  const resolved = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolved) {
    return resolved;
  }

  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

/**
 * Infer provider from model name prefix
 */
function inferProviderFromModelName(modelName: string): string {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gemini-")) return "gemini";
  if (m.startsWith("gpt-")) return "openai";
  if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4"))
    return "openai";
  if (m.startsWith("deepseek-")) return "openrouter";
  return "openai";
}
