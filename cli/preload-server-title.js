/**
 * Preload hook for the standalone Next.js server.
 *
 * Sets a unique process.title before the Next.js built-in startServer
 * overwrites it with the generic "next-server (v{version})". This makes
 * 9Router's server process easy to identify in task managers / process
 * lists (Issue #2117).
 *
 * Loaded via node --require from cli.js spawnServer().
 */
process.title = `9router next-server (v${require("./package.json").version})`;
