import initializeApp from "./shared/services/initializeApp.js";
import { initAutoBackup } from "./lib/db/autoBackup.js";

async function startServer() {
  console.log("Starting server...");
  
  try {
    await initializeApp();
    console.log("Server initialized");
    initAutoBackup();
  } catch (error) {
    console.log("Error initializing server:", error);
    process.exit(1);
  }
}

startServer().catch(console.log);

export default startServer;
