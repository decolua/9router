# Installation

How to install and run 9Router on your machine or server.

---

## Requirements

- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **Supported OS**: macOS, Linux, Windows (WSL recommended)

Verify your Node version:
```bash
node --version  # should be >= 20.0.0
```

---

## Installation Options

### Method 1: Global npm (Recommended for Local Use)

```bash
npm install -g 9router
9router
```

The server starts on port `20128` and opens the dashboard at `http://localhost:20128`.

### Method 2: Docker (Recommended for Servers & VPS)

Use the official multi-architecture image (`linux/amd64` & `linux/arm64`):

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

### Method 3: From Source (Local Development)

```bash
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run dev
```

---

## First Run & Login

1. Open `http://localhost:20128` in your browser.
2. Sign in with the default password: `123456`.
3. Change your password under **Settings** → **Security**.

---

## Data Storage & Backups

9Router stores all providers, keys, combos, and history in a local SQLite database:

| Platform | Database Location |
|---|---|
| **macOS / Linux** | `~/.9router/db/data.sqlite` |
| **Windows** | `%APPDATA%\9router\db\data.sqlite` |
| **Docker** | `/app/data/db/data.sqlite` (via `-v "$HOME/.9router:/app/data"`) |

**Manual Backup:**
```bash
cp -r ~/.9router ~/.9router.bak
```

---

## Verification

Test the endpoint:

```bash
curl http://localhost:20128/v1/models
```

You should receive a JSON list containing connected models and combos.
