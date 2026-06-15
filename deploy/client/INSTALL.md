# ebRouter — Installation Guide

Install ebRouter on your computer or server. Data is stored in **PostgreSQL** (set up automatically).

---

## Before you start

You need:

- **Docker Desktop** installed and running ([Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [Mac](https://docs.docker.com/desktop/setup/install/mac-install/))
- **10 GB** free disk space
- Port **20128** available
- Internet access

If your vendor gave you a **private** Docker image, run this once before install:

```powershell
docker login ghcr.io -u YOUR_GITHUB_USER
# Password = GitHub token with read:packages (vendor will provide)
```

---

## Install (Windows)

1. Unzip this folder to e.g. `C:\ebrouter`
2. Open **PowerShell** in that folder
3. Run:

```powershell
cd C:\ebrouter
.\install.ps1
```

4. Wait until you see **"ebRouter is installed"**
5. Open **http://localhost:20128/dashboard**
6. Log in with the **password shown in the terminal**
7. Go to **Settings** → change your password immediately

---

## Install (Linux / Mac)

```bash
cd /opt/ebrouter
chmod +x install.sh backup.sh update.sh
./install.sh
```

Then open **http://localhost:20128/dashboard**

---

## Connect your coding tool (e.g. Cursor)

1. Dashboard → **Providers** → add your AI accounts / API keys  
2. Dashboard → **Settings** → **API Keys** → copy a key  
3. In Cursor (or Claude Code, Cline, etc.):

| Setting | Value |
|---------|--------|
| API base URL | `http://localhost:20128/v1` |
| API key | *(from dashboard)* |
| Model | *(e.g. your provider model or combo name)* |

**Team server?** Replace `localhost` with your server IP.

---

## Useful commands

Run from the same folder as `install.ps1`.

| Task | Windows | Linux/Mac |
|------|---------|-----------|
| **Backup database** | `.\backup.ps1` | `./backup.sh` |
| **Update app** | `.\update.ps1 -Image "IMAGE_TAG_FROM_VENDOR"` | `./update.sh IMAGE_TAG` |
| **Check status** | `docker compose ps` | same |
| **View logs** | `docker compose logs -f ebrouter` | same |
| **Stop** | `docker compose stop` | same |
| **Start again** | `docker compose start` | same |

Keep **`.env`** and **`backups/`** safe — they contain your passwords and data.

---

## Problems?

| Issue | Fix |
|-------|-----|
| Docker not running | Start Docker Desktop |
| Install fails on pull | Check internet; run `docker login ghcr.io` if image is private |
| Port in use | Ask vendor to change `PORT` in `.env` |
| Forgot login password | Open `.env` in this folder → see `INITIAL_PASSWORD` |

For support, send:

```powershell
docker compose ps
docker compose logs ebrouter --tail 50
```

**Do not email your `.env` file** unless vendor asks via a secure channel.

---

## Uninstall

```powershell
docker compose down
```

To remove all data (cannot undo): `docker compose down -v`

---

*ebRouter runs locally on your machine. You connect your own AI providers; billing is between you and those providers.*
