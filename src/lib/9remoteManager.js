// 9remote process lifecycle manager
let remoteProcess = null;

export function setRemoteProcess(child) {
  remoteProcess = child;
}

export function getRemoteProcess() {
  return remoteProcess;
}

export function killRemote() {
  if (!remoteProcess) return;
  
  try {
    remoteProcess.kill("SIGTERM");
    console.log(`[9remote] Killed process ${remoteProcess.pid}`);
    remoteProcess = null;
  } catch (err) {
    console.log(`[9remote] Failed to kill:`, err.message);
    remoteProcess = null;
  }
}

// Register cleanup handlers
if (typeof process !== "undefined") {
  const cleanup = () => {
    killRemote();
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("beforeExit", killRemote);
}
