import initializeApp from "./shared/services/initializeApp.js";

// Fix #3744: suppress undici SOCKS5 ExperimentalWarning — proxy fallback to direct is handled gracefully
// (undici/lib/dispatcher/socks5-proxy-agent.js emits ExperimentalWarning on first SOCKS5 use)
if (typeof process !== "undefined" && process.emitWarning) {
  const _origEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, type, ...args) => {
    if (type === "ExperimentalWarning" && String(warning).includes("SOCKS5")) return;
    return _origEmitWarning(warning, type, ...args);
  };
}
async function startServer() {
  console.log("Starting server...");
  
  try {
    await initializeApp();
    console.log("Server initialized");
  } catch (error) {
    console.log("Error initializing server:", error);
    process.exit(1);
  }
}

startServer().catch(console.log);

export default startServer;
