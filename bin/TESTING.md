# System Tray Testing Guide

## Prerequisites

- Node.js 20+
- Git

## Installation Steps

1. **Clone the repository** (if not already done):
   ```bash
   git clone https://github.com/fdkgenie/9router.git
   cd 9router
   ```

2. **Switch to the tray feature branch**:
   ```bash
   git checkout claude/add-additional-info-to-tray
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```

   This will install:
   - Electron 34.2.0
   - Canvas 2.11.2
   - All other dependencies

4. **Create environment file**:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` if needed for custom settings.

5. **Build the application**:
   ```bash
   npm run build
   ```

   This will:
   - Build the Next.js application
   - Run postbuild script to prepare the bin directory
   - Takes 1-3 minutes depending on your system

## Starting with System Tray

```bash
npm run start:tray
```

### What Happens

1. **Server starts**: The Next.js server starts on port 20128 (default)
2. **Tray appears**: A system tray icon appears with "9R" logo
3. **Dashboard (optional)**: A hidden browser window loads the dashboard
4. **Background running**: App runs in system tray, not taskbar

### Expected Behavior

When you click the tray icon, you should see a menu like:

```
┌─────────────────────────────────────────┐
│ 9Router (Port 20128)                    │
├─────────────────────────────────────────┤
│ Open Dashboard                          │
├─────────────────────────────────────────┤
│ Model: cc/claude-opus-4-6               │
├─────────────────────────────────────────┤
│ Context (24h):                          │
│   Input: 125.3K                         │
│   Output: 89.2K                         │
│   Total: 214.5K                         │
│   Last: 3s ago                          │
├─────────────────────────────────────────┤
│ Quota Tracker (24h):                    │
│   cc: 150K (23 req)                     │
│   if: 64.5K (12 req)                    │
│   glm: 32.1K (5 req)                    │
│   ...and 2 more                         │
├─────────────────────────────────────────┤
│ MITM Server: Disabled                   │
├─────────────────────────────────────────┤
│ ☐ Autostart                             │
├─────────────────────────────────────────┤
│ Quit                                    │
└─────────────────────────────────────────┘
```

## Testing Steps

### 1. Basic Functionality Test

- [ ] Tray icon appears in system tray
- [ ] Right-click (or left-click depending on OS) shows menu
- [ ] Menu shows "9Router (Port 20128)" title
- [ ] "Open Dashboard" button works and opens browser

### 2. Model Information Test

- [ ] Make an API request through 9Router
- [ ] Wait 5 seconds for menu refresh
- [ ] Model information appears in menu
- [ ] Provider/model format is correct (e.g., "cc/claude-opus-4-6")

### 3. Context Information Test

- [ ] Context section shows token counts
- [ ] Input/Output/Total tokens are formatted properly
- [ ] Time since last request updates every 5 seconds
- [ ] Format changes based on time (3s, 5m, 2h, 1d ago)

### 4. Quota Tracker Test

- [ ] Quota tracker lists providers with usage
- [ ] Shows token count and request count
- [ ] Limited to top 5 providers
- [ ] Shows "...and X more" if there are more than 5

### 5. MITM Server Test

- [ ] MITM Server menu item appears
- [ ] Shows current status (Enabled ✓ / Disabled)
- [ ] Click to toggle (may require sudo password)
- [ ] Status updates after toggle

### 6. Auto-refresh Test

- [ ] Menu data updates every 5 seconds
- [ ] No errors in console during refresh
- [ ] Time-ago values update correctly

### 7. Error Handling Test

- [ ] Stop the server manually (kill process)
- [ ] Wait 5 seconds for refresh
- [ ] Fallback menu appears with "Server not responding..."
- [ ] "Open Dashboard" still works (attempts to open)

### 8. Quit Test

- [ ] Click "Quit" in menu
- [ ] Server process stops
- [ ] Tray icon disappears
- [ ] No zombie processes remain

## Troubleshooting

### Tray icon doesn't appear

**Check console output:**
```bash
npm run start:tray
```

Look for errors related to:
- Electron initialization
- Canvas/icon creation
- Tray creation

**Common issues:**
- Missing dependencies: Run `npm install` again
- Permission issues: Run with proper permissions
- Display server issues (Linux): Ensure X11 or Wayland is running

### Menu shows no data

**Check that:**
- Server is running and accessible at `http://localhost:20128`
- API endpoints are responding:
  ```bash
  curl http://localhost:20128/api/usage/stats?period=24h
  curl http://localhost:20128/api/cli-tools/antigravity-mitm
  ```

### MITM toggle doesn't work

**Check:**
- You have sudo/admin permissions
- MITM server prerequisites are installed
- Check console for error messages

### Build fails

**Common solutions:**
- Clear build cache: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 20+)

## Platform-Specific Notes

### macOS
- Tray icon appears in menu bar at top right
- Cmd+Q also quits the application
- First launch may require security approval

### Windows
- Tray icon appears in system tray (bottom right)
- May be hidden in "Show hidden icons" menu
- First launch may trigger Windows Defender prompt

### Linux
- Works with most desktop environments (GNOME, KDE, XFCE)
- Requires system tray support in DE
- May need `libgtk-3-dev` for Electron

## Manual Testing Checklist

After completing all tests:

- [ ] All menu items display correctly
- [ ] Data refreshes automatically every 5 seconds
- [ ] API integration works properly
- [ ] MITM toggle functions correctly
- [ ] No memory leaks after extended running
- [ ] Quit works cleanly without zombie processes
- [ ] Works on target platform (Windows/macOS/Linux)

## Reporting Issues

If you encounter issues, please report:

1. **Environment**:
   - OS and version
   - Node.js version
   - npm version

2. **Console output**:
   - Copy full console output from `npm run start:tray`

3. **Steps to reproduce**:
   - What you did
   - What you expected
   - What actually happened

4. **Screenshots**:
   - Screenshot of tray menu (if visible)
   - Screenshot of console errors
