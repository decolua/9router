import initializeApp from "./shared/services/initializeApp.js";
import { initConsoleLogCapture } from "./lib/consoleLogBuffer.js";

// Patch console before anything else so all startup logs are captured in the web UI
initConsoleLogCapture();

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
