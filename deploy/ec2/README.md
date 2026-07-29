# ebRouter on AWS EC2 (SaaS multi-tenant)

Run ebRouter on **Amazon EC2** with `deploy/saas` (Docker + PostgreSQL).

| URL (IP demo) | Purpose |
|---------------|---------|
| `http://YOUR_IP:20128/register` | Create org |
| `http://YOUR_IP:20128/o/acme/login` | Org login |
| `http://YOUR_IP:20128/o/acme/dashboard` | Dashboard |

With a domain + Caddy: `https://acme.app.example.com` — see [Optional HTTPS](#optional--domain-and-https).

---

## What you need

- AWS account
- SSH key pair (`.pem` file)
- Docker image on GHCR — [../GHCR-PUBLISH.md](../GHCR-PUBLISH.md)
- **Recommended:** `t3.small` (2 vCPU, 2 GB RAM) or larger  
  `t2.micro` / `t3.micro` (1 GB) is tight for Postgres + Node; OK only for quick tests.

---

## Step 1 — Launch EC2 instance

1. Open [EC2 Console](https://console.aws.amazon.com/ec2/) → **Launch instance**

| Setting | Value |
|---------|--------|
| **Name** | `ebrouter` |
| **AMI** | **Ubuntu Server 22.04 LTS** (64-bit x86) |
| **Instance type** | **t3.small** (recommended) or t3.medium |
| **Key pair** | Create new → download `.pem` (keep safe) |
| **Network** | Default VPC, **Auto-assign public IP: Enable** |
| **Storage** | 30 GB gp3 (default is fine) |

2. **Security group** — create `ebrouter-sg` with inbound rules:

| Type | Port | Source | Notes |
|------|------|--------|-------|
| SSH | 22 | My IP | Restrict SSH to your IP |
| Custom TCP | 20128 | 0.0.0.0/0 | App (demo); lock down later |
| HTTP | 80 | 0.0.0.0/0 | Optional — Caddy |
| HTTPS | 443 | 0.0.0.0/0 | Optional — Caddy |

3. **Launch instance**
4. Wait until **Instance state = Running**
5. Copy **Public IPv4 address** (or allocate **Elastic IP** — recommended so IP doesn’t change on stop/start)

### Elastic IP (recommended)

1. **EC2 → Elastic IPs → Allocate**
2. **Actions → Associate** → select your `ebrouter` instance

---

## Step 2 — SSH into the server

**Windows (PowerShell):**

```powershell
ssh -i "C:\path\to\ebrouter.pem" ubuntu@YOUR_PUBLIC_IP
```

**Mac/Linux:**

```bash
chmod 400 ~/ebrouter.pem
ssh -i ~/ebrouter.pem ubuntu@YOUR_PUBLIC_IP
```

First connection: type `yes` if asked about host key.

---

## Step 3 — Install Docker

On the EC2 instance:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
exit
```

SSH in again, then verify:

```bash
docker --version
docker compose version
```

---

## Step 4 — Get deploy files on the server

### Option A — Git clone (public repo)

```bash
git clone https://github.com/YOUR_ORG/eb-router.git
cd eb-router/deploy/saas
```

### Option B — Copy from your PC

```powershell
scp -i "C:\path\to\ebrouter.pem" -r deploy\saas deploy\ec2 ubuntu@YOUR_PUBLIC_IP:~/ebrouter/
```

On server: `cd ~/ebrouter/saas`

---

## Step 5 — Configure `.env`

```bash
cp ../ec2/.env.example .env    # if copied via Option B
# or
cp .env.example .env && nano .env
```

**Required edits** (replace placeholders):

```env
EBROUTER_IMAGE=ghcr.io/YOUR_ORG/ebrouter:0.4.56
DEPLOY_MODE=saas
BASE_URL=http://YOUR_PUBLIC_IP:20128
NEXT_PUBLIC_BASE_URL=http://YOUR_PUBLIC_IP:20128
EBROUTER_BIND=0.0.0.0:20128
AUTH_COOKIE_SECURE=false
```

Generate secrets on the server:

```bash
openssl rand -hex 32    # JWT_SECRET
openssl rand -hex 32    # API_KEY_SECRET
openssl rand -hex 16    # MACHINE_ID_SALT
openssl rand -base64 32 # MASTER_KEY
openssl rand -hex 16    # POSTGRES_PASSWORD
```

Paste into `.env`. For IP-based demos, **leave `SAAS_BASE_DOMAIN` unset** (path URLs `/o/slug/...`).

---

## Step 6 — Start ebRouter

```bash
chmod +x install.sh backup.sh restore.sh
./install.sh
```

Or without install script:

```bash
docker compose pull
docker compose up -d
```

Check:

```bash
docker compose ps
curl -s http://127.0.0.1:20128/api/health
# {"ok":true}
```

From your browser: `http://YOUR_PUBLIC_IP:20128/register`

---

## Step 7 — Share with demo clients

| Action | URL |
|--------|-----|
| New organization | `http://YOUR_IP:20128/register` |
| Org workspace | `http://YOUR_IP:20128/o/{slug}/login` |

---

## Optional — Domain and HTTPS

1. Buy/use a domain (Route 53 or any registrar)
2. **A record** `app.yourdomain.com` → Elastic IP
3. For wildcard org subdomains: `*.app.yourdomain.com` → same IP
4. Update `.env`:

```env
SAAS_BASE_DOMAIN=app.yourdomain.com
BASE_URL=https://app.yourdomain.com
NEXT_PUBLIC_BASE_URL=https://app.yourdomain.com
AUTH_COOKIE_SECURE=true
EBROUTER_BIND=127.0.0.1:20128
ACME_EMAIL=you@yourdomain.com
CLOUDFLARE_API_TOKEN=...   # if using Caddy DNS challenge
```

5. Start with Caddy:

```bash
./install.sh --with-proxy
```

Path-only (no wildcard): keep `SAAS_BASE_DOMAIN` unset and use `https://app.yourdomain.com/o/acme/login`.

---

## Operations

```bash
cd ~/eb-router/deploy/saas   # or your path

docker compose logs -f --tail=100 ebrouter
./backup.sh
```

**Upgrade:**

```bash
# Edit EBROUTER_IMAGE in .env
docker compose pull ebrouter
docker compose up -d ebrouter
```

**Auto-start on reboot:**

```bash
sudo apt-get install -y systemd
# docker compose already uses restart: unless-stopped
```

See [../saas/SAAS-OPS.md](../saas/SAAS-OPS.md) for backups, logs, rate limits.

---

## Cost notes

| Resource | Typical cost |
|----------|----------------|
| t3.small | ~$15–18/month (varies by region) |
| t3.medium | ~$30/month |
| Elastic IP | Free while attached to running instance |
| 30 GB EBS | ~$3/month |
| **Free tier** | t2.micro/t3.micro 750 hrs/month for 12 months (1 GB RAM — tight) |

Stop the instance when not demoing to save money (Elastic IP stays; small charge if detached).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SSH timeout | Security group allows port 22 from your IP; instance is running |
| Connection refused :20128 | Open port 20128 in security group |
| Out of memory | Upgrade to t3.small+; `docker compose logs postgres` |
| Login redirect wrong | `BASE_URL` must match browser URL exactly |
| Image pull denied | `docker login ghcr.io` if image is private |
| IP changed after restart | Use Elastic IP |

---

## Related

- [../saas/README.md](../saas/README.md)
- [../saas/SAAS-OPS.md](../saas/SAAS-OPS.md)
- [../client/README-CLIENT.md](../client/README-CLIENT.md) — per-client on-prem installs
