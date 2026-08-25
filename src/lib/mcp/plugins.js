/**
 * Preset stdio plugin registry.
 *
 * Unified lookup for the built-in stdio plugins bundled with 9router
 * (as opposed to user-configured MCP servers). Provides a single source of
 * truth so both the stdio bridge and the server manager resolve plugins the
 * same way.
 */

import coworkPlugins from "@/shared/constants/coworkPlugins";

const { LOCAL_STDIO_PLUGINS } = coworkPlugins;

/** Find a preset plugin by name. Returns `null` if not registered. */
export function findPlugin(name) {
  return LOCAL_STDIO_PLUGINS.find((p) => p.name === name) || null;
}

/** Return a copy of every registered preset plugin definition. */
export function listPlugins() {
  return [...LOCAL_STDIO_PLUGINS];
}
