/**
 * Usage Fetcher — shared constants and utility functions
 */

import {
  CLIENT_METADATA,
  getPlatformUserAgent,
} from "../config/appConstants.js";

// GitHub API config
export const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

// GLM quota endpoints (region-aware)
export const GLM_QUOTA_URLS = {
  international: "https://api.z.ai/api/monitor/usage/quota/limit",
  china: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
};

// MiniMax usage endpoints (try in order, fallback on transient errors)
export const MINIMAX_USAGE_URLS = {
  minimax: [
    "https://www.minimax.io/v1/token_plan/remains",
    "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  ],
  "minimax-cn": [
    "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
  ],
};

// Antigravity API config (from Quotio)
export const ANTIGRAVITY_CONFIG = {
  quotaApiUrl:
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  loadProjectApiUrl:
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId:
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  userAgent: getPlatformUserAgent(),
};

// Codex (OpenAI) API config
export const CODEX_CONFIG = {
  usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};

// Claude API config
export const CLAUDE_CONFIG = {
  oauthUsageUrl: "https://api.anthropic.com/api/oauth/usage",
  usageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
  settingsUrl: "https://api.anthropic.com/v1/settings",
  apiVersion: "2023-06-01",
};

// Re-export CLIENT_METADATA for Gemini/Antigravity modules
export { CLIENT_METADATA };

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
export function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === "number") {
      return new Date(
        resetValue < 1e12 ? resetValue * 1000 : resetValue,
      ).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(
          timestamp < 1e12 ? timestamp * 1000 : timestamp,
        ).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}
