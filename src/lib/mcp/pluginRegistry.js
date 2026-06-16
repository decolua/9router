/**
 * MCP Plugin Registry
 *
 * Unified lookup for stdio plugins across the system.
 * Merges preset plugins from coworkPlugins with user-configured MCP servers.
 *
 * This prevents duplicate definitions and provides a single source of truth
 * for plugin resolution in stdio bridges and MCP server manager.
 */

const { LOCAL_STDIO_PLUGINS } = require("@/shared/constants/coworkPlugins");

/**
 * Find a plugin by name from the preset stdio plugins.
 * @param {string} name - Plugin name to find
 * @returns {object|null} Plugin definition or null
 */
function findPlugin(name) {
  return LOCAL_STDIO_PLUGINS.find((p) => p.name === name) || null;
}

/**
 * List all registered preset stdio plugins.
 * @returns {object[]} Array of plugin definitions
 */
function listPlugins() {
  return [...LOCAL_STDIO_PLUGINS];
}

module.exports = { findPlugin, listPlugins };
