/**
 * Get local endpoint URL (remote access features have been removed)
 * @param {number} port - Local server port
 * @returns {Promise<{endpoint: string}>}
 */
async function getEndpoint(port) {
  return { endpoint: `http://localhost:${port}/v1` };
}

/**
 * Get endpoint (kept as an alias for existing callers)
 * @param {number} port - Local server port
 * @returns {Promise<string>} Endpoint string
 */
async function getEndpointColored(port) {
  const { endpoint } = await getEndpoint(port);
  return endpoint;
}

module.exports = { getEndpoint, getEndpointColored };
