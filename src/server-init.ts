import initializeApp from "./shared/services/initializeApp";

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
