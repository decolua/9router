# Localhost Deployment

Running 9Router locally on your macOS, Linux, or Windows development machine.

---

## Quick Start

```bash
npm install -g 9router
9router
```

The service runs on `http://localhost:20128`.

---

## Runtime CLI Flags

```bash
9router --port 20128     # Specify listening port
9router --no-browser     # Don't auto-open dashboard in browser
9router --skip-update    # Skip startup npm update check
9router --help           # Show CLI options
```

---

## Data Location & Clean Reset

- **macOS / Linux**: `~/.9router/`
- **Windows**: `%APPDATA%\9router\`

To completely reset 9Router data:
```bash
rm -rf ~/.9router
```
