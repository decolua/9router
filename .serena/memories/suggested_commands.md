# Suggested Commands

## Development Commands

### Installation
```bash
npm install              # Install all dependencies
```

### Development Server
```bash
npm run dev              # Start Next.js development server (port 3000)
                         # Dashboard: http://localhost:3000/dashboard
                         # API: http://localhost:3000/v1/*
```

### Production Build
```bash
npm run build            # Build standalone production bundle
                         # Output: .next/standalone/

npm start                # Start production server
                         # Serves the built application
```

## Code Quality

### Linting
```bash
npx eslint .             # Run ESLint on entire codebase
                         # Uses eslint.config.mjs (Next.js rules)
```

### Code Check
```bash
npx eslint . --fix       # Auto-fix linting issues where possible
```

## Testing & Debugging

### Manual API Testing

#### OpenAI Format
```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

#### Claude Format
```bash
curl http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3.5","messages":[{"role":"user","content":"Hello"}]}'
```

#### Responses API (Codex)
```bash
curl http://localhost:20128/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input":[{"role":"user","content":"Hello"}]}'
```

## CLI Usage (Global Install)

### Installation
```bash
npm install -g 9router   # Install globally
npx 9router              # Or run directly with npx
```

### Starting Server
```bash
9router                  # Start with default settings (port 20128)
9router --port 8080      # Custom port
9router --no-browser     # Don't open browser
9router --skip-update    # Skip auto-update check
9router --help           # Show help
```

## Git Commands

### Standard Workflow
```bash
git status               # Check current status
git add .                # Stage all changes
git commit -m "message"  # Commit with message
git push                 # Push to remote
```

### Branch Management
```bash
git checkout -b feature  # Create new branch
git checkout master      # Switch to master
git merge feature        # Merge feature branch
```

## System Commands (Linux)

### File Operations
```bash
ls -la                   # List files with details
cd <directory>           # Change directory
pwd                      # Print working directory
mkdir <dir>              # Create directory
rm -rf <path>            # Remove files/directories (careful!)
```

### File Searching
```bash
find . -name "*.js"      # Find JavaScript files
grep -r "pattern" .      # Search for pattern in files
```

### Process Management
```bash
ps aux | grep node       # Find Node.js processes
kill <pid>               # Kill process by ID
killall node             # Kill all Node processes
```

### Network
```bash
netstat -tuln | grep 3000   # Check if port 3000 is in use
lsof -i :3000               # See what's using port 3000
```

## Data Management

### Database Location
```bash
# Linux/macOS
cat ~/.9router/db.json      # View database
nano ~/.9router/db.json     # Edit database

# Windows
type %APPDATA%\9router\db.json    # View database
notepad %APPDATA%\9router\db.json # Edit database
```

### Backup
```bash
cp ~/.9router/db.json ~/.9router/db.json.backup   # Backup database
```

## Debugging

### Log Files
- Check console output for colored logs
- Request logging: `open-sse/utils/requestLogger.js`
- Debug mode: Enable in `src/sse/utils/logger.js`

### Common Issues
```bash
# Port already in use
lsof -ti:3000 | xargs kill -9   # Kill process on port 3000

# Node modules issues
rm -rf node_modules package-lock.json
npm install                      # Fresh install

# Cache issues
rm -rf .next                     # Clear Next.js cache
npm run build                    # Rebuild
```

## Package Management

### Dependency Updates
```bash
npm outdated             # Check for outdated packages
npm update               # Update packages (within semver)
npm install <package>    # Add new package
npm uninstall <package>  # Remove package
```

### Version Check
```bash
node --version           # Check Node.js version (should be 20+)
npm --version            # Check npm version
```

## Deployment

### Standalone Build
```bash
npm run build                           # Build standalone bundle
node .next/standalone/server.js         # Run standalone server
```

### Environment
- Data persists in home directory, not app bundle
- No environment variables needed for basic setup
- OAuth credentials stored in database file
