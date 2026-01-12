/**
 * Global test setup
 * Runs before all tests
 */

import { beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Track all spawned server processes for cleanup
const activeServers = new Set();

// Export function to register servers for cleanup
export function registerServer(serverInfo) {
  if (serverInfo && serverInfo.process) {
    activeServers.add(serverInfo);
  }
}

// Export function to unregister servers after cleanup
export function unregisterServer(serverInfo) {
  activeServers.delete(serverInfo);
}

// Set test environment variables
process.env.NODE_ENV = 'test';

// Global setup
beforeAll(() => {
  console.log('🧪 Starting test suite...');
});

// Global cleanup - ensure all servers are stopped
afterAll(async () => {
  console.log('🧹 Cleaning up test servers...');

  // Kill any remaining tracked servers
  for (const server of activeServers) {
    try {
      if (server.process && server.process.pid) {
        process.kill(-server.process.pid, 'SIGKILL');
      }
    } catch (e) {
      // Process already dead
    }
  }
  activeServers.clear();

  // Kill any stray Next.js dev processes
  try {
    await execAsync('pkill -9 -f "next.*dev" 2>/dev/null || true');
  } catch (e) {
    // Ignore errors
  }

  console.log('✅ Test suite completed');
});

// Handle process termination signals
const cleanup = async () => {
  console.log('\n🛑 Received termination signal, cleaning up...');

  for (const server of activeServers) {
    try {
      if (server.process && server.process.pid) {
        process.kill(-server.process.pid, 'SIGKILL');
      }
    } catch (e) {
      // Process already dead
    }
  }

  try {
    await execAsync('pkill -9 -f "next.*dev" 2>/dev/null || true');
  } catch (e) {
    // Ignore errors
  }

  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await cleanup();
});
process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection:', reason);
  await cleanup();
});
