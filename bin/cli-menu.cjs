#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Configuration
const PORT = process.env.PORT || 20127;
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';

let serverProcess = null;

/**
 * Start the Next.js server
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js');

    // Check if built server exists
    const fs = require('fs');
    if (!fs.existsSync(serverPath)) {
      console.error('Server not built. Please run: npm run build');
      reject(new Error('Server not built'));
      return;
    }

    console.log('Starting 9Router server...');

    serverProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT,
        HOSTNAME,
        NODE_ENV: 'production'
      },
      stdio: 'inherit'
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    // Wait for server to be ready
    setTimeout(() => {
      console.log('\n✓ Server started successfully');
      console.log(`✓ Dashboard: http://localhost:${PORT}/dashboard\n`);
      resolve();
    }, 3000);
  });
}

/**
 * Stop the Next.js server
 */
function stopServer() {
  if (serverProcess) {
    console.log('\nStopping server...');
    serverProcess.kill();
    serverProcess = null;
  }
}

/**
 * Display menu
 */
function displayMenu() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         9Router Control Menu          ║');
  console.log('╠════════════════════════════════════════╣');
  console.log('║  [1] Open Dashboard in Browser        ║');
  console.log('║  [2] Show Server Status                ║');
  console.log('║  [3] Restart Server                    ║');
  console.log('║  [4] View Logs                         ║');
  console.log('║  [q] Quit                              ║');
  console.log('╚════════════════════════════════════════╝\n');
  process.stdout.write('Select an option: ');
}

/**
 * Open dashboard in browser
 */
function openDashboard() {
  const open = require('child_process').exec;
  const url = `http://localhost:${PORT}/dashboard`;
  
  const command = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  
  open(`${command} ${url}`, (error) => {
    if (error) {
      console.log(`\n✗ Failed to open browser. Please visit: ${url}\n`);
    } else {
      console.log(`\n✓ Opening dashboard in browser...\n`);
    }
  });
}

/**
 * Show server status
 */
function showStatus() {
  const http = require('http');
  
  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/api/health',
    method: 'GET',
    timeout: 2000
  };

  const req = http.request(options, (res) => {
    console.log(`\n✓ Server Status: Running`);
    console.log(`✓ Port: ${PORT}`);
    console.log(`✓ URL: http://localhost:${PORT}/dashboard\n`);
  });

  req.on('error', () => {
    console.log(`\n✗ Server Status: Not responding\n`);
  });

  req.on('timeout', () => {
    console.log(`\n✗ Server Status: Timeout\n`);
    req.destroy();
  });

  req.end();
}

/**
 * Restart server
 */
async function restartServer() {
  console.log('\nRestarting server...');
  stopServer();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await startServer();
}

/**
 * View logs
 */
function viewLogs() {
  console.log('\n[Logs are displayed in the main console output]\n');
}

/**
 * Handle menu input
 */
function handleInput(input, rl) {
  const choice = input.trim().toLowerCase();

  switch (choice) {
    case '1':
      openDashboard();
      displayMenu();
      break;
    case '2':
      showStatus();
      displayMenu();
      break;
    case '3':
      restartServer().then(() => displayMenu());
      break;
    case '4':
      viewLogs();
      displayMenu();
      break;
    case 'q':
    case 'quit':
    case 'exit':
      console.log('\nShutting down 9Router...');
      stopServer();
      rl.close();
      process.exit(0);
      break;
    default:
      console.log('\n✗ Invalid option. Please try again.\n');
      displayMenu();
      break;
  }
}

/**
 * Initialize the CLI
 */
async function initialize() {
  try {
    // Start the server
    await startServer();

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Display initial menu
    displayMenu();

    // Handle user input
    rl.on('line', (input) => {
      handleInput(input, rl);
    });

    // Handle Ctrl+C
    rl.on('SIGINT', () => {
      console.log('\n\nReceived SIGINT. Shutting down...');
      stopServer();
      rl.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  stopServer();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  stopServer();
  process.exit(1);
});

// Start the CLI
initialize();
