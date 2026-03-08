#!/usr/bin/env node

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const TrayManager = require('./trayManager');

// Configuration
const PORT = process.env.PORT || 20128;
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';

let serverProcess = null;
let trayManager = null;
let mainWindow = null;

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
      console.log('Server started successfully');
      resolve();
    }, 3000);
  });
}

/**
 * Stop the Next.js server
 */
function stopServer() {
  if (serverProcess) {
    console.log('Stopping server...');
    serverProcess.kill();
    serverProcess = null;
  }
}

/**
 * Create hidden browser window (optional, for future use)
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Hidden by default
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}/dashboard`);

  mainWindow.on('close', (event) => {
    // Prevent window from closing, just hide it
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

/**
 * Show the main window
 */
function showWindow() {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
}

/**
 * Initialize the application
 */
async function initialize() {
  try {
    // Start the server
    await startServer();

    // Create hidden window
    createWindow();

    // Initialize system tray
    trayManager = new TrayManager(PORT);
    await trayManager.init();

    console.log('9Router is running in system tray');
    console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  } catch (error) {
    console.error('Failed to initialize:', error);
    app.quit();
  }
}

// Electron app events
app.whenReady().then(initialize);

app.on('window-all-closed', (event) => {
  // Don't quit when all windows are closed on macOS
  if (process.platform !== 'darwin') {
    // Keep app running in tray
    event.preventDefault();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (trayManager) {
    trayManager.cleanup();
  }
  stopServer();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
