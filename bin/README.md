# 9Router System Tray

This directory contains the system tray implementation for 9Router using Electron.

## Features

The system tray provides the following information and controls:

### Basic Information
- **9Router (Port xxx)**: Shows the current port 9Router is running on
- **Open Dashboard**: Click to open the web dashboard in your default browser

### Model Information
- **Model in use**: Displays the most recently used provider/model combination
  - Format: `Provider/model` (e.g., `cc/claude-opus-4-6`)

### Context Information (Last 24 hours)
- **Input tokens**: Total prompt/input tokens used
- **Output tokens**: Total completion/output tokens generated
- **Total tokens**: Combined total
- **Last request time**: Shows how long ago the last request was made (e.g., "3s ago", "5m ago")

### Quota Tracker
- Displays all providers with usage statistics from the last 24 hours
- Shows top 5 providers by token usage
- For each provider, displays:
  - Provider name
  - Total tokens used
  - Number of requests made

### MITM Server Control
- **MITM Server**: Toggle to enable/disable the MITM server
  - Shows current status (Enabled ✓ / Disabled)
  - Click to toggle on/off

### Other Controls
- **Autostart**: Toggle to start 9Router automatically on system boot (coming soon)
- **Quit**: Completely exit 9Router

## Files

- **cli.js**: Main Electron entry point, starts the Next.js server and initializes the tray
- **trayManager.js**: System tray manager class that handles:
  - Tray icon creation
  - Menu building with dynamic data
  - API communication with the running 9Router server
  - Periodic updates (every 5 seconds)
  - MITM server control

- **postbuild.js**: Post-build script to prepare the application

## Usage

### Development
```bash
# Build the application first
npm run build

# Start with system tray
npm run start:tray
```

### After Installation
```bash
# Run the CLI with tray
9router-fdk
```

Or for the global npm package:
```bash
9router-tray
```

## How It Works

1. **Server Startup**: The CLI starts the Next.js server in the background
2. **Tray Initialization**: Creates a system tray icon with the 9Router logo
3. **Data Fetching**: Periodically fetches data from local API endpoints:
   - `/api/usage/stats?period=24h` - Usage statistics
   - `/api/cli-tools/antigravity-mitm` - MITM server status
4. **Menu Updates**: Updates the tray menu every 5 seconds with fresh data
5. **Background Running**: Keeps running in the system tray even when window is closed

## API Endpoints Used

- **GET /api/usage/stats**: Get usage statistics (tokens, requests, etc.)
- **GET /api/cli-tools/antigravity-mitm**: Get MITM server status
- **POST /api/cli-tools/antigravity-mitm**: Start MITM server
- **DELETE /api/cli-tools/antigravity-mitm**: Stop MITM server
- **GET /api/settings**: Get application settings

## Requirements

- Node.js 20+
- Electron 34+
- Canvas (for tray icon generation)
- A built Next.js application (run `npm run build` first)

## Platform Support

- **Windows**: Full support
- **macOS**: Full support
- **Linux**: Full support

## Troubleshooting

### Tray doesn't show data
- Ensure the server is running and accessible at `http://localhost:20128`
- Check that the build was successful (`npm run build`)
- Look for errors in the console output

### MITM toggle doesn't work
- Ensure you have proper permissions (may require sudo password)
- Check MITM server logs for errors
- Verify API key is configured

### Autostart doesn't work
- This feature is coming soon and requires platform-specific implementation

## Future Enhancements

- [ ] Implement autostart functionality for all platforms
- [ ] Add click-to-copy for model names
- [ ] Add more detailed quota information (reset times, limits)
- [ ] Add notification support for quota warnings
- [ ] Add custom tray icon support
- [ ] Add settings panel in tray menu
