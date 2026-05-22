/**
 * Custom Usage Script Runner
 * Safely executes user-defined usage/quote extraction scripts
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * Parse reset time value into ISO string
 */
function parseResetTime(resetValue) {
  if (!resetValue) return null;
  try {
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Validate that a script has the required structure
 */
function isValidUsageScript(script) {
  if (!script || typeof script !== "object") return false;
  if (!script.request || typeof script.request !== "object") return false;
  if (typeof script.request.url !== "string" && typeof script.request.url !== "function") return false;
  if (typeof script.extractor !== "function") return false;
  return true;
}

/**
 * Extract provider variables for use in the script's request/headers
 * These are the variables the user can reference: baseUrl, apiKey, accessToken, etc.
 */
function buildScriptContext(connection, providerConfig) {
  // baseUrl can come from providerConfig (standard providers) or connection.providerSpecificData (custom providers)
  const baseUrl = providerConfig?.baseUrl || connection.providerSpecificData?.baseUrl || connection.baseUrl || "";

  return {
    baseUrl,
    apiKey: connection.apiKey || "",
    accessToken: connection.accessToken || "",
    providerSpecificData: connection.providerSpecificData || {},
    // Full connection for advanced use
    connection,
  };
}

const MAX_SCRIPT_LENGTH = 50000; // 50KB max script size

/**
 * Safely execute a user's custom usage script
 * @param {Object} connection - Provider connection with credentials
 * @param {Object} providerConfig - Provider config (from PROVIDERS)
 * @param {string} scriptCode - The user's script code (object literal as string)
 * @param {Object} proxyOptions - Proxy options for the fetch
 * @returns {Object} The extracted usage result
 */
export async function executeCustomUsageScript(connection, providerConfig, scriptCode, proxyOptions = null) {
  // Validate script length to prevent DoS
  if (!scriptCode || typeof scriptCode !== "string" || scriptCode.length > MAX_SCRIPT_LENGTH) {
    return {
      isValid: false,
      invalidMessage: `Script exceeds maximum allowed length of ${MAX_SCRIPT_LENGTH} characters`,
    };
  }

  // Parse user script
  let script;
  try {
    script = new Function(`return ${scriptCode}`)();
  } catch (error) {
    return {
      isValid: false,
      invalidMessage: `Script parse error: ${error.message}`,
    };
  }

  // Validate structure
  if (!isValidUsageScript(script)) {
    return {
      isValid: false,
      invalidMessage: "Script must have 'request' (with url) and 'extractor' function",
    };
  }

  const { request: req, extractor } = script;

  // Build script context with provider variables
  const context = buildScriptContext(connection, providerConfig);

  // Resolve URL (string or function)
  const url = typeof req.url === "function" ? req.url(context) : req.url;

  // Resolve method
  const method = req.method || "GET";

  // Resolve headers (object or function)
  let headers = {};
  if (req.headers) {
    const rawHeaders = typeof req.headers === "function" ? req.headers(context) : { ...req.headers };
    // Resolve any function values within the headers object
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key] = typeof value === "function" ? value(context) : value;
    }
  }

  // Debug: log the request being made
  console.log(`[CustomUsage] Provider: ${connection.provider}`);
  console.log(`[CustomUsage] URL: ${url}`);
  console.log(`[CustomUsage] Method: ${method}`);
  console.log(`[CustomUsage] Headers:`, headers);

  // Execute the HTTP request
  let response;
  try {
    response = await proxyAwareFetch(url, { method, headers }, proxyOptions);
  } catch (error) {
    return {
      isValid: false,
      invalidMessage: `Request failed: ${error.message}`,
    };
  }

  if (!response.ok) {
    return {
      isValid: false,
      invalidMessage: `API error: ${response.status} ${response.statusText}`,
    };
  }

  // Parse JSON response
  let data;
  try {
    data = await response.json();
  } catch (error) {
    return {
      isValid: false,
      invalidMessage: `Failed to parse JSON response: ${error.message}`,
    };
  }

  // Run the extractor function with response data and context
  let result;
  try {
    result = extractor(data, context);
  } catch (error) {
    return {
      isValid: false,
      invalidMessage: `Extractor error: ${error.message}`,
    };
  }

  // Validate and normalize the result
  if (!result || typeof result !== "object") {
    return {
      isValid: false,
      invalidMessage: "Extractor must return an object",
    };
  }

  // Return the normalized result
  return {
    isValid: result.isValid !== false,
    invalidMessage: result.invalidMessage || null,
    remaining: typeof result.remaining === "number" ? result.remaining : null,
    unit: typeof result.unit === "string" ? result.unit : null,
    planName: typeof result.planName === "string" ? result.planName : null,
    total: typeof result.total === "number" ? result.total : null,
    used: typeof result.used === "number" ? result.used : null,
    extra: typeof result.extra === "string" ? result.extra : null,
    resetAt: parseResetTime(result.resetAt),
  };
}
