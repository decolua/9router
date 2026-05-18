// Minimal log shim so the vendored tool-emulation.js stays unmodified.
// Mirrors dwgx's log surface (debug/info/warn/error). Routes to console.
export const log = {
  debug: (...args) => { if (process.env.DEVIN_DEBUG) console.log("[devin]", ...args); },
  info:  (...args) => console.log("[devin]", ...args),
  warn:  (...args) => console.warn("[devin]", ...args),
  error: (...args) => console.error("[devin]", ...args),
};
