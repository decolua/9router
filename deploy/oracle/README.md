# ebRouter on Oracle Cloud Always Free (SaaS demo)

Host a **multi-tenant demo** on Oracle's free ARM VPS using `deploy/saas` (Docker + PostgreSQL).

**Cost:** $0/month on [Oracle Always Free](https://www.oracle.com/cloud/free/) (2 OCPU + 12 GB RAM ARM VM).

| URL | Purpose |
|-----|---------|
| `http://YOUR_IP:20128/register` | Create a new org |
| `http://YOUR_IP:20128/o/acme/login` | Login to org `acme` |
| `http://YOUR_IP:20128/o/acme/dashboard` | Org dashboard |

Path-based org URLs are used (no custom domain required). Add a domain + TLS later if needed.

---

## What you need

- Oracle Cloud account (credit card may be required for verification; stay on Always Free resources)
- SSH key on your PC
- Docker image on GHCR — see [../GHCR-PUBLISH.md](../GHCR-PUBLISH.md)
- ~30 minutes

---

## Step 1 — Create the VM

1. Sign in to [Oracle Cloud Console](https://cloud.oracle.com/)
2. **Compute → Instances → Create instance**
3. Settings:

| Field | Value |
|-------|--------|
| **Name** | `ebrouter` |
| **Image** | Ubuntu 22.04 (aarch64) |
| **Shape** | Ampere → **VM.Standard.A1.Flex** |
| **OCPUs** | 2 |
| **Memory** | 12 GB |
| **Networking** | Create new VCN or use default |
| **Public IPv4** | **Assign a public IPv4 address** |
| **SSH keys** | Paste your public key |

4. Click **Create**
5. Copy the **Public IP** when the instance is **Running**

> **Always Free limits (2026):** 2 OCPU and 12 GB RAM total across ARM instances. Do not exceed this on free tier.

---

## Step 2 — Open firewall ports

### A) Oracle Security List (required)

1. **Networking → Virtual cloud networks** → your VCN
2. **Security Lists** → Default Security List → **Add Ingress Rules**

| Source CIDR | Protocol | Dest port | Description |
|-------------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 20128 | ebRouter (demo) |
| `0.0.0.0/0` | TCP | 80 | HTTP (optional, for Caddy later) |
| `0.0.0.0/0` | TCP | 443 | HTTPS (optional) |

### B) Ubuntu firewall on the VM (after SSH)

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 20128 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
```

Or if `ufw` is active:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 20128/tcp
sudo ufw enable
```

---

## Step 3 — Install Docker on the VM

```bash
ssh ubuntu@YOUR_PUBLIC_IP

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
```

Log out and SSH in again so the `docker` group applies:

```bash
exit
ssh ubuntu@YOUR_PUBLIC_IP
docker --version
```

---

## Step 4 — Deploy ebRouter

### Option A — Clone repo (if public on GitHub)

```bash
git clone https://github.com/YOUR_GITHUB_ORG/eb-router.git
cd eb-router/deploy/saas
```

### Option B — Copy only deploy files

From your PC:

```bash
scp -r deploy/saas deploy/oracle ubuntu@YOUR_PUBLIC_IP:~/ebrouter/
```

On the server:

```bash
cd ~/ebrouter/saas
```

### Configure environment

```bash
cp ../oracle/.env.example .env    # if you used Option B
# or
cp .env.example .env && nano .env  # edit manually — see oracle/.env.example
```

Edit `.env` — **required changes:**

```env
EBROUTER_IMAGE=ghcr.io/YOUR_ORG/ebrouter:0.4.56
BASE_URL=http://YOUR_PUBLIC_IP:20128
NEXT_PUBLIC_BASE_URL=http://YOUR_PUBLIC_IP:20128
EBROUTER_BIND=0.0.0.0:20128
```

Generate secrets on the server:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # API_KEY_SECRET
openssl rand -hex 16   # MACHINE_ID_SALT
openssl rand -base64 32  # MASTER_KEY
openssl rand -hex 16   # POSTGRES_PASSWORD
```

Paste into `.env`. **Do not set `SAAS_BASE_DOMAIN`** for IP-based path demos.

### Start

```bash
chmod +x install.sh backup.sh restore.sh
./install.sh --skip-pull   # or ./install.sh to pull image first
```

Without `install.sh`:

```bash
docker compose up -d
```

Wait ~1–2 minutes, then:

```bash
curl -s http://127.0.0.1:20128/api/health
# {"ok":true}
```

---

## Step 5 — Create your first org

In a browser:

```text
http://YOUR_PUBLIC_IP:20128/register
```

After signup you should land on:

```text
http://YOUR_PUBLIC_IP:20128/o/your-slug/login
```

Sign in → dashboard.

---

## Give demo links to clients

| Action | Send them |
|--------|-----------|
| Self-service signup | `http://YOUR_IP:20128/register` |
| Existing org | `http://YOUR_IP:20128/o/{slug}/login` |

Each org is isolated (separate users, keys, usage).

---

## Daily operations

Run from `deploy/saas` on the server:

```bash
docker compose ps
docker compose logs -f --tail=100 ebrouter
./backup.sh
```

Upgrade:

```bash
# Edit EBROUTER_IMAGE in .env to new version
docker compose pull ebrouter
docker compose up -d ebrouter
```

See also [../saas/SAAS-OPS.md](../saas/SAAS-OPS.md) for backups, logs, and rate limits.

---

## Optional — Custom domain + HTTPS

1. Point `app.yourdomain.com` A record → Oracle public IP
2. Update `.env`:

```env
BASE_URL=https://app.yourdomain.com
NEXT_PUBLIC_BASE_URL=https://app.yourdomain.com
AUTH_COOKIE_SECURE=true
EBROUTER_BIND=127.0.0.1:20128
```

3. Start with Caddy:

```bash
./install.sh --with-proxy
```

For wildcard org subdomains (`acme.app.yourdomain.com`), add `SAAS_BASE_DOMAIN` and `*.app.yourdomain.com` DNS — see [../saas/SAAS-OPS.md](../saas/SAAS-OPS.md).

For a single hostname, keep path URLs: `https://app.yourdomain.com/o/acme/login`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Can't SSH | Check security list allows port 22; instance is Running |
| Connection refused on :20128 | Open port 20128 in Oracle security list + VM firewall |
| `no matching manifest for linux/arm64` | Rebuild image with arm64 — see GHCR workflow |
| Register OK, login fails | `BASE_URL` must match browser URL exactly (include `:20128`) |
| Out of memory | Use 2 OCPU / 12 GB shape only; don't run other heavy services |
| Oracle signup fails | Try different region or use paid micro VM in another cloud |

---

## Related

- [../saas/README.md](../saas/README.md) — SaaS Docker stack
- [../saas/SAAS-OPS.md](../saas/SAAS-OPS.md) — Production runbook
- [../client/README-CLIENT.md](../client/README-CLIENT.md) — Per-client on-prem installs
