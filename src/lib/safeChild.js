/**
 * Safe Child Process Wrapper
 *
 * Purpose: Prevent unhandled 'error' events on child processes from crashing the parent.
 * This is one of the main causes of silent process death on Ubuntu (especially
 * with the sudo-spawned MITM server and tailscale daemons).
 *
 * Usage:
 *   const { createSafeChild } = require('@/lib/safeChild');
 *   const child = createSafeChild('sudo', [...], options);
 */

const { spawn } = require('child_process');

/**
 * Creates a child process with guaranteed error handling.
 * Attaches 'error' listener that logs safely instead of crashing the parent.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options - same as child_process.spawn options
 * @param {object} [logger] - optional logger with .log and .err methods
 * @returns {import('child_process').ChildProcess | null}
 */
function createSafeChild(command, args = [], options = {}, logger = null) {
  let child;
  try {
    child = spawn(command, args, options);
  } catch (syncErr) {
    // Synchronous spawn failure (e.g. command not found)
    const log = logger?.err || console.error;
    log(`[safeChild] Failed to spawn synchronously: ${command} ${args.join(' ')}`, syncErr);
    return null;
  }

  if (!child) return null;

  const log = logger?.log || console.log;
  const errLog = logger?.err || console.error;

  // Critical: attach error handler immediately
  child.on('error', (error) => {
    // This is the key fix — prevents uncaught 'error' event from killing the parent process
    errLog(`[safeChild] Child process error for "${command} ${args.join(' ')}":`, error?.message || error);
    // We deliberately do NOT re-throw or kill parent here.
  });

  // Also protect stdio streams if they exist (common source of secondary errors)
  if (child.stdout) {
    child.stdout.on('error', (e) => {
      errLog(`[safeChild] stdout error from ${command}:`, e?.message || e);
    });
  }
  if (child.stderr) {
    child.stderr.on('error', (e) => {
      errLog(`[safeChild] stderr error from ${command}:`, e?.message || e);
    });
  }
  if (child.stdin) {
    child.stdin.on('error', (e) => {
      errLog(`[safeChild] stdin error from ${command}:`, e?.message || e);
    });
  }

  // Optional: log when child exits abnormally (helps debugging)
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      log(`[safeChild] ${command} exited with code ${code} (signal: ${signal})`);
    }
  });

  return child;
}

module.exports = {
  createSafeChild,
};