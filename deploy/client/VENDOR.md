# Vendor guide — client deployment bundle

How to prepare and ship `deploy/client/` to paying customers.

---

## Bundle contents

Zip the entire `deploy/client/` folder:

```
deploy/client/
├── docker-compose.yml
├── .env.example
├── install.ps1 / install.sh
├── backup.ps1 / backup.sh
├── update.ps1 / update.sh
├── restore.ps1 / restore.sh
├── INSTALL.md          ← give this to the client
├── README-CLIENT.md
└── VENDOR.md
```

Do **not** include `.env` (generated per client on install).

---

## Before shipping

### 1. Publish a Docker image to GHCR

**Automatic (recommended):** push a version tag — GitHub Actions builds and pushes:

```bash
git tag v0.4.56
git push origin v0.4.56
```

Image location:

```text
ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
ghcr.io/YOUR_GITHUB_ORG/ebrouter:latest
```

**Manual push:** see [../GHCR-PUBLISH.md](../GHCR-PUBLISH.md).

### 2. Pin the image in `.env.example`

```env
EBROUTER_IMAGE=ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
```

Use your real GitHub username/org (lowercase), e.g. `ghcr.io/acmecorp/ebrouter:0.4.56`.

### 3. Test the bundle on a clean machine

```powershell
cd deploy\client
# Set EBROUTER_IMAGE in .env.example first, then:
.\install.ps1
# verify http://localhost:20128/dashboard
.\backup.ps1
.\update.ps1 -Image "ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56"
```

---

## Per-client delivery

1. Send the zip + `INSTALL.md` (client reads this first).
2. Set `EBROUTER_IMAGE` in `.env.example` to your GHCR image before zipping.
3. If the GHCR package is **private**, give the client a read-only token and login steps (see GHCR-PUBLISH.md).
4. Run install on client site or let their IT run `install.ps1`.
5. Record the generated `.env` secrets in their password vault (client-owned).
6. Schedule backup (`backup.ps1` / Task Scheduler / cron) — scripts retain **30 days**; see `schedule-backup.example.cron`.

---

## Air-gapped / offline clients

On a machine with internet:

```bash
docker pull ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56
docker pull postgres:16-alpine
docker save ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56 postgres:16-alpine -o ebrouter-images.tar
```

On client machine:

```bash
docker load -i ebrouter-images.tar
# set EBROUTER_IMAGE=ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.56 in .env
./install.sh --skip-pull
```

---

## Custom image (build from source)

If the client must not pull from GHCR, build locally:

```bash
docker build -t yourcompany/ebrouter:1.0.0 .
```

Set `EBROUTER_IMAGE=yourcompany/ebrouter:1.0.0` in `.env`.

---

## Security defaults in this bundle

- PostgreSQL **not** exposed on host ports
- `REQUIRE_API_KEY=true` by default
- Random secrets generated on install
- `MASTER_KEY` enabled for encrypted secrets at rest

Recommend clients:

- Change dashboard password after first login
- Back up `.env` + SQL dumps
- Use HTTPS reverse proxy for internet-facing servers

---

## Updating clients

1. Publish new image tag to GHCR.
2. Send new version number.
3. Client runs:

```powershell
.\update.ps1 -Image "ghcr.io/YOUR_GITHUB_ORG/ebrouter:0.4.57"
```

PostgreSQL volume `pgdata` is preserved.

