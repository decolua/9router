# ☁️ Cloud Deployment

Deploy 9Router on VPS or Docker for remote access and production use.

---

## 🖥️ VPS Deployment

### Prerequisites

- Ubuntu 20.04+ or similar Linux distribution
- Node.js 20+
- Git
- Root or sudo access

### Step 1: Clone Repository

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Build Application

```bash
npm run build
```

### Step 4: Configure Environment Variables

Create a `.env` file or export variables:

```bash
export JWT_SECRET="your-secure-secret-change-this-to-random-string"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/9router"
export NODE_ENV="production"
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | Auto-generated | **MUST change in production!** Used for JWT token signing |
| `INITIAL_PASSWORD` | `123456` | Dashboard login password |
| `DATA_DIR` | `~/.9router` | Database and data storage path |
| `NODE_ENV` | `development` | Set to `production` for deployment |
| `ENABLE_REQUEST_LOGS` | `false` | Enable debug request/response logs |

### Step 5: Create Data Directory

```bash
sudo mkdir -p /var/lib/9router
sudo chown $USER:$USER /var/lib/9router
```

### Step 6: Start Application

```bash
npm run start
```

### Step 7: Setup PM2 for Production

PM2 keeps your application running and restarts it on crashes:

```bash
# Install PM2 globally
npm install -g pm2

# Start 9Router with PM2
pm2 start npm --name 9router -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions printed by the command above
```

**PM2 Management Commands:**

```bash
# View logs
pm2 logs 9router

# Restart application
pm2 restart 9router

# Stop application
pm2 stop 9router

# View status
pm2 status

# Monitor resources
pm2 monit
```

---

## 🐳 Docker Deployment

### Option 1: Using Dockerfile

Create a `Dockerfile` in the `app` directory:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Build application
RUN npm run build

# Expose ports
EXPOSE 3000 20128

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Create data directory
RUN mkdir -p /app/data

# Start application
CMD ["npm", "run", "start"]
```

**Build and Run:**

```bash
# Build image
docker build -t 9router .

# Run container
docker run -d \
  --name 9router \
  -p 3000:3000 \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret-change-this" \
  -e INITIAL_PASSWORD="your-secure-password" \
  -v 9router-data:/app/data \
  9router
```

### Option 2: Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  9router:
    build: .
    container_name: 9router
    ports:
      - "3000:3000"
      - "20128:20128"
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-secure-secret-change-this
      - INITIAL_PASSWORD=your-secure-password
      - DATA_DIR=/app/data
    volumes:
      - 9router-data:/app/data
    restart: unless-stopped

volumes:
  9router-data:
```

**Run with Docker Compose:**

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

---

## 🌐 Reverse Proxy with Nginx

### Why Use Nginx?

- SSL/TLS termination
- Domain name mapping
- Load balancing
- Better security

### Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx
```

### Step 2: Configure Nginx

Create `/etc/nginx/sites-available/9router`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (use certbot to generate)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Proxy to 9Router
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # SSE support - CRITICAL for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }

    # API endpoint
    location /v1 {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE support - CRITICAL for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

### Step 3: Enable Site

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/9router /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Step 4: Setup SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
# Test renewal
sudo certbot renew --dry-run
```

---

## 🔒 Security Considerations

### 1. Change Default Credentials

**CRITICAL:** Change `JWT_SECRET` and `INITIAL_PASSWORD` before deployment:

```bash
# Generate secure JWT secret
openssl rand -base64 32

# Use this value for JWT_SECRET
export JWT_SECRET="generated-secret-here"
```

### 2. Firewall Configuration

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS (if using Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# If NOT using reverse proxy, allow 9Router ports
sudo ufw allow 3000/tcp
sudo ufw allow 20128/tcp

# Enable firewall
sudo ufw enable
```

### 3. Restrict Dashboard Access

If you only need API access, restrict dashboard port:

```bash
# Only allow localhost access to dashboard
sudo ufw deny 3000/tcp
```

Access dashboard via SSH tunnel:

```bash
ssh -L 3000:localhost:3000 user@your-server.com
# Then open http://localhost:3000 in your browser
```

### 4. Regular Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update 9Router
cd /path/to/9router/app
git pull
npm install
npm run build
pm2 restart 9router
```

### 5. Backup Strategy

```bash
# Backup data directory
tar -czf 9router-backup-$(date +%Y%m%d).tar.gz /var/lib/9router

# Automated daily backup (add to crontab)
0 2 * * * tar -czf /backups/9router-$(date +\%Y\%m\%d).tar.gz /var/lib/9router
```

---

## 📊 Monitoring

### Check Application Status

```bash
# PM2 status
pm2 status

# View logs
pm2 logs 9router --lines 100

# Monitor resources
pm2 monit
```

### Nginx Logs

```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### System Resources

```bash
# CPU and memory usage
htop

# Disk usage
df -h

# Network connections
netstat -tulpn | grep -E '3000|20128'
```

---

## 🚨 Troubleshooting

### Application Won't Start

```bash
# Check logs
pm2 logs 9router

# Check if ports are in use
sudo lsof -i :3000
sudo lsof -i :20128

# Check environment variables
pm2 env 9router
```

### Nginx 502 Bad Gateway

```bash
# Check if 9Router is running
pm2 status

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Test Nginx configuration
sudo nginx -t
```

### SSE Streaming Not Working

Ensure `proxy_buffering off` is set in Nginx configuration for SSE support.

### Permission Denied Errors

```bash
# Fix data directory permissions
sudo chown -R $USER:$USER /var/lib/9router
chmod 755 /var/lib/9router
```

---

## 🔗 Next Steps

- [Connect Providers](/providers/subscription.md)
- [Setup Combos](/features/combos.md)
- [Integrate with Tools](/integration/cursor.md)
