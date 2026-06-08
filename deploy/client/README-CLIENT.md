# ebRouter — Client Installation Guide

Production deployment: **ebRouter + PostgreSQL** via Docker Compose.  
All application data (providers, API keys, combos, usage) is stored in PostgreSQL.

---

## Requirements

| Item | Minimum |
|------|---------|
| **Docker** | Docker Desktop (Windows/Mac) or Docker Engine 24+ (Linux) |
| **Docker Compose** | v2 (`docker compose`) |
| **RAM** | 4 GB |
| **Disk** | 10 GB free |
| **Network** | Outbound HTTPS to AI providers |
| **Port** | **20128** available on the host |

---

## Quick install

### Windows

1. Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Unzip this folder to e.g. `C:\ebrouter`.
3. Open PowerShell in that folder:

```powershell
cd C:\ebrouter
.\install.ps1
```

4. Open **http://localhost:20128/dashboard**
5. Log in with the password printed by the installer.
6. **Change your password** immediately (Settings).

### Linux / macOS

```bash
cd /opt/ebrouter
chmod +x install.sh backup.sh update.sh restore.sh
./install.sh
```

---

## What's included

| File | Purpose |
|------|---------|
| `docker-compose.yml` | App + PostgreSQL stack |
| `.env.example` | Configuration template |
| `.env` | **Created by install** — secrets (keep private) |
| `install.ps1` / `install.sh` | First-time setup |
| `backup.ps1` / `backup.sh` | Database backup |
| `update.ps1` / `update.sh` | Upgrade app image |
| `restore.ps1` / `restore.sh` | Restore from backup |

---

## After install

### 1. Connect AI providers

Dashboard → **Providers** → connect subscriptions or add API keys.

### 2. Create API key

Dashboard → **Settings** → **API Keys** → copy a key.

### 3. Configure coding tools

Example (Cursor):

```
OpenAI-compatible base URL: http://localhost:20128/v1
API Key:                    <from dashboard>
Model:                      <e.g. cc/claude-opus-4-7 or a combo name>
```

If ebRouter runs on a **team server**, replace `localhost` with the server IP or hostname.

### 4. Team access

- Default port: **20128**
- Set `REQUIRE_API_KEY=true` in `.env` (default) so `/v1/*` requires a Bearer token
- Each developer uses their own API key from the dashboard

---

## Daily operations

### Check status

```bash
docker compose ps
docker compose logs -f ebrouter
```

### Stop / start

```bash
docker compose stop
docker compose start
```

### Backup (run daily or weekly)

**Windows:** `.\backup.ps1`  
**Linux/Mac:** `./backup.sh`

Backups are saved to `backups/ebrouter-YYYYMMDD-HHMMSS.sql`.

**Also store securely:**

- `.env` (passwords and encryption keys)
- `backups/*.sql`

### Restore

**Windows:**

```powershell
.\restore.ps1 -SqlFile ".\backups\ebrouter-20260606-120000.sql"
```

**Linux/Mac:**

```bash
./restore.sh ./backups/ebrouter-20260606-120000.sql
```

### Update app version

Your vendor will provide a new image tag, e.g. `ghcr.io/your-vendor/ebrouter:0.4.56`.

**Windows:**

```powershell
.\update.ps1 -Image "ghcr.io/your-vendor/ebrouter:0.4.56"
```

**Linux/Mac:**

```bash
./update.sh ghcr.io/your-vendor/ebrouter:0.4.56
```

If the image is private on GitHub Container Registry, log in first:

```bash
docker login ghcr.io -u YOUR_GITHUB_USER
# Password: a GitHub Personal Access Token with read:packages
```

PostgreSQL data is **not** removed during updates.

---

## Configuration (`.env`)

Important variables:

| Variable | Description |
|----------|-------------|
| `EBROUTER_IMAGE` | Docker image and version tag |
| `PORT` | Host port (default 20128) |
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | Dashboard session signing |
| `INITIAL_PASSWORD` | First login password |
| `MASTER_KEY` | Encrypts secrets in DB — **never change after go-live** |
| `REQUIRE_API_KEY` | `true` = API calls need Bearer token |
| `BASE_URL` | Public URL if not localhost |

After editing `.env`:

```bash
docker compose up -d
```

---

## Server deployment (team)

1. Install Docker on a Linux VM or Windows Server with Docker Desktop.
2. Run `install.sh` or `install.ps1`.
3. Set in `.env`:

```env
BASE_URL=http://YOUR-SERVER-IP:20128
NEXT_PUBLIC_BASE_URL=http://YOUR-SERVER-IP:20128
REQUIRE_API_KEY=true
```

4. Open firewall port **20128** (or put nginx/Caddy in front with HTTPS).
5. Developers point tools to `http://YOUR-SERVER-IP:20128/v1`.

For HTTPS, use a reverse proxy and set `AUTH_COOKIE_SECURE=true`.

---

## Data location

Data persists in Docker volumes (survives container restarts):

| Volume | Contents |
|--------|----------|
| `pgdata` | PostgreSQL database |
| `ebrouter_data` | Certs, runtime files under `/app/data` |

List volumes:

```bash
docker volume ls | grep ebrouter
```

---

## Troubleshooting

| Problem | Action |
|---------|--------|
| `Docker is not running` | Start Docker Desktop |
| Port 20128 in use | Change `PORT` in `.env`, run `docker compose up -d` |
| Login fails | Check `INITIAL_PASSWORD` in `.env` |
| App won't start | `docker compose logs ebrouter` — look for `[DB] Driver: postgres` |
| DB connection error | `docker compose ps` — wait for postgres `healthy` |
| Forgot password | Reset via CLI on host or vendor support |

---

## Uninstall

```bash
docker compose down
```

To **delete all data** (irreversible):

```bash
docker compose down -v
```

---

## Support checklist

When contacting support, provide:

```bash
docker compose ps
docker compose logs ebrouter --tail 100
curl -s http://localhost:20128/api/version
```

Do **not** send your `.env` file or database backups unless requested through a secure channel.
