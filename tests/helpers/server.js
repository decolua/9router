import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import { promisify } from 'util';
import waitOn from 'wait-on';
import getPort from 'get-port';
import { registerServer, unregisterServer } from '../setup.js';

const treeKillAsync = promisify(treeKill);

console.log('🧪 Starting test suite...');

/**
 * Start the Next.js dev server
 */
export async function startServer(env = {}) {
  try {
    // Find available port (tries 3000 first, then finds next available)
    const port = await getPort({ port: [3000, 3001, 3002, 3003, 3004, 3005] });

    // Start server with specific port
    const serverProcess = spawn('npm', ['run', 'dev'], {
      env: {
        ...process.env,
        ...env,
        PORT: port.toString(),
        NEXT_MANUAL_SIG_HANDLE: 'true', // Required for proper signal handling
      },
      stdio: 'pipe',
      shell: true,
    });

    // Listen for errors during startup
    const startupError = new Promise((_, reject) => {
      serverProcess.on('error', reject);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    // Wait for server to be ready
    const waitForReady = waitOn({
      resources: [`http://localhost:${port}`],
      timeout: 120000,
      interval: 100,
      simultaneous: 1,
    });

    // Race between server becoming ready or hitting an error
    await Promise.race([waitForReady, startupError]);

    // Return server process and port
    const serverInfo = { process: serverProcess, port };

    // Register server for global cleanup
    registerServer(serverInfo);

    return serverInfo;
  } catch (error) {
    console.error('Failed to start server:', error.message);
    throw error;
  }
}

/**
 * Stop the server properly
 */
export async function stopServer(serverInfo) {
  if (!serverInfo || !serverInfo.process) {
    return;
  }

  const { process: serverProcess, port } = serverInfo;

  if (!serverProcess.pid) {
    return;
  }

  try {
    // Kill entire process tree with SIGTERM
    await treeKillAsync(serverProcess.pid, 'SIGTERM');

    // Wait for process to actually exit
    await Promise.race([
      new Promise((resolve) => {
        serverProcess.on('exit', () => resolve());
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for process exit')), 5000)
      ),
    ]);

    // Ensure port is actually freed
    await waitOn({
      resources: [`tcp:localhost:${port}`],
      reverse: true, // Wait for resource to NOT be available
      timeout: 10000,
    });

    // Unregister from global cleanup
    unregisterServer(serverInfo);
  } catch (error) {
    console.error('Error during server shutdown:', error.message);

    // Force kill if SIGTERM failed
    try {
      await treeKillAsync(serverProcess.pid, 'SIGKILL');
    } catch (killError) {
      console.error('Failed to force kill process:', killError.message);
    }

    // Still unregister even if cleanup had errors
    unregisterServer(serverInfo);
  }
}

/**
 * Make API request (now uses dynamic port from server info)
 */
export async function apiRequest(path, options = {}, serverPort = 3000) {
  const url = `http://localhost:${serverPort}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  // Get response text first, then try to parse as JSON
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    body = text;
  }

  return {
    status: response.status,
    headers: response.headers,
    body
  };
}

/**
 * Cleanup on exit
 */
process.on('exit', () => {
  console.log('✅ Test suite completed');
});

/**
 * Custom matcher for Vitest
 */
if (typeof expect !== 'undefined') {
  expect.extend({
    toBeOneOf(received, expected) {
      const pass = expected.includes(received);
      if (pass) {
        return {
          message: () => `expected ${received} not to be one of ${expected.join(', ')}`,
          pass: true
        };
      } else {
        return {
          message: () => `expected ${received} to be one of ${expected.join(', ')}`,
          pass: false
        };
      }
    }
  });
}
