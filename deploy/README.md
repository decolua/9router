# VPS deploy với Nginx

## 1. Cài đặt trên VPS

```bash
# Nginx
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

# Node 20 (nếu chạy app bằng npm)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Hoặc dùng Docker (app + postgres)
# sudo apt install -y docker.io docker-compose-plugin
```

## 2. Deploy app

**Cách A — Docker (khuyến nghị)**

```bash
cd /path/to/9router
cp .env.example .env
# Sửa .env: DATABASE_URL, JWT_SECRET, INITIAL_PASSWORD, BASE_URL=https://your-domain.com
docker compose -f docker-compose.prod.yml up -d --build
# App chạy tại 127.0.0.1:20128 (map từ container)
```

**Cách B — Chạy trực tiếp (Node)**

```bash
cd /path/to/9router
cp .env.example .env
# Sửa .env, cần Postgres (docker compose up -d postgres hoặc Postgres trên VPS)
npm ci && npm run build
npm run db:migrate   # hoặc node scripts/db/migrate.js
PORT=20128 node .next/standalone/server.js
# Hoặc dùng pm2: pm2 start .next/standalone/server.js --name egs-proxy-ai -- --port 20128
```

## 3. Nginx

```bash
# Copy config, sửa your-domain.com thành domain thật
sudo cp deploy/nginx-egs-proxy-ai.conf /etc/nginx/sites-available/egs-proxy-ai
sudo sed -i 's/your-domain.com/TEN_DOMAIN_CUA_BAN/g' /etc/nginx/sites-available/egs-proxy-ai

# Nếu chưa có SSL: tạm comment block server 443, chỉ giữ server 80, sau đó:
sudo ln -s /etc/nginx/sites-available/egs-proxy-ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d TEN_DOMAIN_CUA_BAN
# Certbot sẽ sửa config SSL giúp. Reload nginx nếu cần.
```

## 4. Env trên VPS

Trong `.env` (hoặc env của docker-compose) nên set:

- `BASE_URL=https://your-domain.com`
- `NEXT_PUBLIC_BASE_URL=https://your-domain.com`
- `AUTH_COOKIE_SECURE=true` (khi chạy HTTPS)
- `DATABASE_URL`, `JWT_SECRET`, `INITIAL_PASSWORD` (bắt buộc)

Sau khi đổi env, restart app (hoặc `docker compose -f docker-compose.prod.yml up -d --force-recreate app`).
