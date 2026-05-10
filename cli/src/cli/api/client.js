const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { machineIdSync } = require("node-machine-id");

// Default configuration
const DEFAULT_CONFIG = {
  host: "localhost",
  port: 20128,
  protocol: "http:",
};

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let config = { ...DEFAULT_CONFIG };
let cachedCliToken = null;

function getCliToken() {
  if (cachedCliToken !== null) return cachedCliToken;
  try {
    const mid = machineIdSync();
    cachedCliToken = crypto.createHash("sha256").update(mid + CLI_TOKEN_SALT).digest("hex").substring(0, 16);
  } catch {
    cachedCliToken = "";
  }
  return cachedCliToken;
}

/**
 * Configure API client
 * @param {Object} options - Configuration options
 * @param {string} options.host - API host
 * @param {number} options.port - API port
 * @param {string} options.protocol - Protocol (http: or https:)
 */
function configure(options = {}) {
  config = { ...config, ...options };
}

/**
 * Make HTTP request to API
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object} body - Request body (optional)
 * @returns {Promise<Object>} Response with { success, data/error }
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve) => {
    const httpModule = config.protocol === "https:" ? https : http;
    
    const options = {
      hostname: config.host,
      port: config.port,
      path: path,
      method: method,
      headers: {
        "Content-Type": "application/json",
        [CLI_TOKEN_HEADER]: getCliToken(),
      },
    };

    // Add Content-Length for POST/PUT requests
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      const bodyString = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyString);
    }

    const req = httpModule.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          
          // Check if response indicates error
          if (res.statusCode >= 400 || parsed.error) {
            resolve({
              success: false,
              error: parsed.error || `HTTP ${res.statusCode}`,
              statusCode: res.statusCode,
            });
          } else {
            resolve({
              success: true,
              data: parsed,
              statusCode: res.statusCode,
            });
          }
        } catch (err) {
          resolve({
            success: false,
            error: `Failed to parse response: ${err.message}`,
          });
        }
      });
    });

    req.on("error", (err) => {
      resolve({
        success: false,
        error: `Network error: ${err.message}`,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        error: "Request timeout",
      });
    });

    // Set timeout (30 seconds)
    req.setTimeout(30000);

    // Write body if present
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// ============================================================================
// PROVIDERS API
// ============================================================================

/**
 * Get all providers
 * @returns {Promise<Object>} { success, data: { connections } }
 */
async function getProviders() {
  return makeRequest("GET", "/api/providers");
}

/**
 * Get provider by ID
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { connection } }
 */
async function getProviderById(id) {
  return makeRequest("GET", `/api/providers/${id}`);
}

/**
 * Test provider connection
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { valid, error } }
 */
async function testProvider(id) {
  return makeRequest("POST", `/api/providers/${id}/test`);
}

/**
 * Delete provider
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { message } }
 */
async function deleteProvider(id) {
  return makeRequest("DELETE", `/api/providers/${id}`);
}

/**
 * Get provider models
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { provider, connectionId, models } }
 */
async function getProviderModels(id) {
  return makeRequest("GET", `/api/providers/${id}/models`);
}

// ============================================================================
// OAUTH API
// ============================================================================

/**
 * Get OAuth authorization URL
 * @param {string} provider - Provider ID
 * @returns {Promise<Object>} { success, data: { authUrl, codeVerifier, state, redirectUri } }
 */
async function getOAuthAuthUrl(provider) {
  // Codex requires fixed port 1455 and path /auth/callback
  const redirectUri = provider === "codex" 
    ? "http://localhost:1455/auth/callback"
    : "http://localhost:20128/callback";
  return makeRequest("GET", `/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
}

/**
 * Exchange OAuth authorization code for token
 * @param {string} provider - Provider ID
 * @param {Object} data - { code, redirectUri, codeVerifier, state }
 * @returns {Promise<Object>} { success, data }
 */
async function exchangeOAuthCode(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/exchange`, data);
}

/**
 * Get OAuth device code
 * @param {string} provider - Provider ID
 * @returns {Promise<Object>} { success, data: { device_code, user_code, verification_uri, verification_uri_complete, codeVerifier, extraData } }
 */
async function getOAuthDeviceCode(provider) {
  return makeRequest("GET", `/api/oauth/${provider}/device-code`);
}

/**
 * Poll OAuth token using device code
 * @param {string} provider - Provider ID
 * @param {Object} data - { deviceCode, codeVerifier, extraData }
 * @returns {Promise<Object>} { success, data: { pending } }
 */
async function pollOAuthToken(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/poll`, data);
}

/**
 * Create API key provider connection
 * @param {Object} data - { provider, name, apiKey }
 * @returns {Promise<Object>} { success, data }
 */
async function createApiKeyProvider(data) {
  return makeRequest("POST", "/api/providers", data);
}

/**
 * Update provider connection
 * @param {string} id - Connection ID
 * @param {Object} data - { name, priority, defaultModel, isActive }
 * @returns {Promise<Object>} { success, data: { connection } }
 */
async function updateConnection(id, data) {
  return makeRequest("PUT", `/api/providers/${id}`, data);
}

// ============================================================================
// API KEYS API
// ============================================================================

/**
 * Get all API keys
 * @returns {Promise<Object>} { success, data: { keys } }
 */
async function getApiKeys() {
  return makeRequest("GET", "/api/keys");
}

/**
 * Create new API key
 * @param {string} name - Key name
 * @returns {Promise<Object>} { success, data: { key, name, id, machineId } }
 */
async function createApiKey(name) {
  return makeRequest("POST", "/api/keys", { name });
}

/**
 * Delete API key
 * @param {string} id - Key ID
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function deleteApiKey(id) {
  return makeRequest("DELETE", `/api/keys/${id}`);
}

// ============================================================================
// COMBOS API
// ============================================================================

/**
 * Get all combos
 * @returns {Promise<Object>} { success, data: { combos } }
 */
async function getCombos() {
  return makeRequest("GET", "/api/combos");
}

/**
 * Get combo by ID
 * @param {string} id - Combo ID
 * @returns {Promise<Object>} { success, data: combo }
 */
async function getComboById(id) {
  return makeRequest("GET", `/api/combos/${id}`);
}

/**
 * Create new combo
 * @param {Object} data - Combo data { name, models }
 * @returns {Promise<Object>} { success, data: combo }
 */
async function createCombo(data) {
  return makeRequest("POST", "/api/combos", data);
}

/**
 * Update combo
 * @param {string} id - Combo ID
 * @param {Object} data - Update data { name?, models? }
 * @returns {Promise<Object>} { success, data: combo }
 */
async function updateCombo(id, data) {
  return makeRequest("PUT", `/api/combos/${id}`, data);
}

/**
 * Delete combo
 * @param {string} id - Combo ID
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function deleteCombo(id) {
  return makeRequest("DELETE", `/api/combos/${id}`);
}

// ============================================================================
// CLI TOOLS API
// ============================================================================

/**
 * Get CLI tool settings
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @returns {Promise<Object>} { success, data: { installed, has9Router, ... } }
 */
async function getCliToolSettings(tool) {
  return makeRequest("GET", `/api/cli-tools/${tool}-settings`);
}

/**
 * Apply CLI tool settings (POST)
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @param {Object} body - Payload depends on tool
 * @returns {Promise<Object>} { success, data }
 */
async function applyCliToolSettings(tool, body) {
  return makeRequest("POST", `/api/cli-tools/${tool}-settings`, body);
}

/**
 * Reset CLI tool settings (DELETE)
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @returns {Promise<Object>} { success, data }
 */
async function resetCliToolSettings(tool) {
  return makeRequest("DELETE", `/api/cli-tools/${tool}-settings`);
}

// ============================================================================
// SETTINGS API
// ============================================================================

/**
 * Get settings
 * @returns {Promise<Object>} { success, data: settings }
 */
async function getSettings() {
  return makeRequest("GET", "/api/settings");
}

/**
 * Update settings
 * @param {Object} data - Settings data
 * @returns {Promise<Object>} { success, data: settings }
 */
async function updateSettings(data) {
  return makeRequest("PATCH", "/api/settings", data);
}

// ============================================================================
// MODELS API
// ============================================================================

/**
 * Get all models (internal API)
 * @returns {Promise<Object>} { success, data: { models } }
 */
async function getModels() {
  return makeRequest("GET", "/api/models");
}

/**
 * Get available models from active providers + combos (OpenAI compatible)
 * @returns {Promise<Object>} { success, data: { object, data: [...models] } }
 */
async function getAvailableModels() {
  return makeRequest("GET", "/v1/models");
}

// ============================================================================
// PROVIDER NODES API (custom providers)
// ============================================================================

async function getProviderNodes() {
  return makeRequest("GET", "/api/provider-nodes");
}

async function createProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes", data);
}

async function updateProviderNode(id, data) {
  return makeRequest("PUT", `/api/provider-nodes/${id}`, data);
}

async function deleteProviderNode(id) {
  return makeRequest("DELETE", `/api/provider-nodes/${id}`);
}

async function validateProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes/validate", data);
}

// ============================================================================
// TUNNEL API
// ============================================================================

/**
 * Get tunnel status
 * @returns {Promise<Object>} { success, data: { enabled, tunnelUrl, shortId, running } }
 */
async function getTunnelStatus() {
  return makeRequest("GET", "/api/tunnel/status");
}

/**
 * Enable tunnel
 * @returns {Promise<Object>} { success, data: { tunnelUrl, shortId } }
 */
async function enableTunnel() {
  return makeRequest("POST", "/api/tunnel/enable");
}

/**
 * Disable tunnel
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function disableTunnel() {
  return makeRequest("POST", "/api/tunnel/disable");
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  configure,
  
  // Providers
  getProviders,
  getProviderById,
  testProvider,
  deleteProvider,
  getProviderModels,
  
  // Connection aliases
  testConnection: testProvider,
  deleteConnection: deleteProvider,
  updateConnection,
  
  // OAuth
  getOAuthAuthUrl,
  exchangeOAuthCode,
  getOAuthDeviceCode,
  pollOAuthToken,
  createApiKeyProvider,
  
  // API Keys
  getApiKeys,
  createApiKey,
  deleteApiKey,
  
  // Combos
  getCombos,
  getComboById,
  createCombo,
  updateCombo,
  deleteCombo,
  
  // CLI Tools
  getCliToolSettings,
  applyCliToolSettings,
  resetCliToolSettings,

  // Settings
  getSettings,
  updateSettings,
  
  // Tunnel
  getTunnelStatus,
  enableTunnel,
  disableTunnel,
  
  // Models
  getModels,
  getAvailableModels,

  // Provider Nodes (custom providers)
  getProviderNodes,
  createProviderNode,
  updateProviderNode,
  deleteProviderNode,
  validateProviderNode,
};
