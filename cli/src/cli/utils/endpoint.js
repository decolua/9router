const api = require("../api/client");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m"
};

/**
 * Get endpoint URL based on tunnel status
 * @param {number} port - Local server port
 * @returns {Promise<{endpoint: string, tunnelEnabled: boolean}>}
 */
async function getEndpoint(port) {
  const result = await api.getTunnelStatus();
  const tunnelEnabled = result.success && result.data?.enabled === true;
  const publicUrl = result.success ? result.data?.publicUrl : "";
  
  const endpoint = tunnelEnabled && publicUrl ? `${publicUrl}/v1` : `http://localhost:${port}/v1`;
  return { endpoint, tunnelEnabled };
}

/**
 * Get endpoint with color formatting
 * @param {number} port - Local server port
 * @returns {Promise<string>} Colored endpoint string
 */
async function getEndpointColored(port) {
  const { endpoint, tunnelEnabled } = await getEndpoint(port);
  return tunnelEnabled ? `${COLORS.green}${endpoint}${COLORS.reset}` : endpoint;
}

/**
 * Direct loopback endpoint for local IDEs (Cursor) — sub-second boot, no tunnel dependencies
 * @param {number} port - Local server port
 * @returns {string}
 */
function getLocalEndpoint(port = 20128) {
  return `http://127.0.0.1:${port}/v1`;
}

/**
 * Direct HTTPS loopback endpoint for local IDEs (Cursor) requiring https://
 * @param {number} port - Local server port
 * @returns {string}
 */
function getLocalHttpsEndpoint(port = 20128) {
  return `https://127.0.0.1:${port + 1}/v1`;
}

module.exports = { getEndpoint, getEndpointColored, getLocalEndpoint, getLocalHttpsEndpoint };
