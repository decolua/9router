import crypto from "crypto";

/**
 * Generate MCP-specific API key with mcp_ prefix
 * Completely separate from v1 API keys (sk- prefix)
 */
export function generateMcpApiKey() {
  const randomPart = crypto.randomBytes(16).toString("hex");
  return {
    key: `mcp_${randomPart}`,
  };
}

/**
 * Validate that a key has the MCP prefix
 */
export function isMcpApiKey(key) {
  return typeof key === "string" && key.startsWith("mcp_");
}
