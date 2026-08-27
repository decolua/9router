# Cloud & Server Deployment

Deploy 9Router on a VPS or cloud instance for remote access or team sharing.

---

## Docker Deployment (Recommended)

Run the container using the official image:

```bash
docker run -d \
  --name 9router \
  --restart unless-stopped \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e INITIAL_PASSWORD="your-secure-password" \
  -e JWT_SECRET="your-jwt-secret" \
  -e REQUIRE_API_KEY=true \
  decolua/9router:latest
```

---

## VPS Systemd / PM2 Deployment

### 1. Build and Prepare
```bash
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build
```

### 2. Run with PM2
```bash
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

---

## Nginx Reverse Proxy (HTTPS)

```nginx
server {
    listen 443 ssl http2;
    server_name router.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/router.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/router.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Disable buffering for real-time SSE streaming
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```
