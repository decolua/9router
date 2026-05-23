# ☁️ 云端部署

将 9Router 部署到 VPS 或 Docker,实现远程访问和生产使用。

---

## 🖥️ VPS 部署

### 前置要求

- Ubuntu 20.04+ 或类似 Linux 发行版
- Node.js 20+
- Git
- root 或 sudo 权限

### 步骤 1:克隆仓库

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
```

### 步骤 2:安装依赖

```bash
npm install
```

### 步骤 3:构建应用

```bash
npm run build
```

### 步骤 4:配置环境变量

创建 `.env` 文件或导出变量:

```bash
export JWT_SECRET="your-secure-secret-change-this-to-random-string"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/9router"
export NODE_ENV="production"
```

**环境变量:**

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `JWT_SECRET` | 自动生成 | **生产环境必须修改!** 用于 JWT token 签名 |
| `INITIAL_PASSWORD` | `123456` | 仪表盘登录密码 |
| `DATA_DIR` | `~/.9router` | 数据库与数据存储路径 |
| `NODE_ENV` | `development` | 部署时设为 `production` |
| `ENABLE_REQUEST_LOGS` | `false` | 启用 debug 请求/响应日志 |

### 步骤 5:创建数据目录

```bash
sudo mkdir -p /var/lib/9router
sudo chown $USER:$USER /var/lib/9router
```

### 步骤 6:启动应用

```bash
npm run start
```

### 步骤 7:用 PM2 部署到生产环境

PM2 让应用持续运行,崩溃时自动重启:

```bash
# 全局安装 PM2
npm install -g pm2

# 用 PM2 启动 9Router
pm2 start npm --name 9router -- start

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup
# 按上一条命令打印的提示执行
```

**PM2 管理命令:**

```bash
# 查看日志
pm2 logs 9router

# 重启应用
pm2 restart 9router

# 停止应用
pm2 stop 9router

# 查看状态
pm2 status

# 监控资源
pm2 monit
```

---

## 🐳 Docker 部署

### 方式 1:使用 Dockerfile

在 `app` 目录中创建 `Dockerfile`:

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

**构建并运行:**

```bash
# 构建镜像
docker build -t 9router .

# 运行容器
docker run -d \
  --name 9router \
  -p 3000:3000 \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret-change-this" \
  -e INITIAL_PASSWORD="your-secure-password" \
  -v 9router-data:/app/data \
  9router
```

### 方式 2:Docker Compose

创建 `docker-compose.yml`:

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

**使用 Docker Compose 运行:**

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重新构建并重启
docker-compose up -d --build
```

---

## 🌐 Nginx 反向代理

### 为什么使用 Nginx?

- SSL/TLS 终止
- 域名映射
- 负载均衡
- 更好的安全性

### 步骤 1:安装 Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 步骤 2:配置 Nginx

创建 `/etc/nginx/sites-available/9router`:

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

### 步骤 3:启用站点

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/9router /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx
```

### 步骤 4:使用 Let's Encrypt 配置 SSL

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取 SSL 证书
sudo certbot --nginx -d your-domain.com

# 自动续期已自动配置
# 测试续期
sudo certbot renew --dry-run
```

---

## 🔒 安全注意事项

### 1. 修改默认凭据

**关键:** 部署前修改 `JWT_SECRET` 和 `INITIAL_PASSWORD`:

```bash
# 生成安全的 JWT secret
openssl rand -base64 32

# 将该值用于 JWT_SECRET
export JWT_SECRET="generated-secret-here"
```

### 2. 防火墙配置

```bash
# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS(若使用 Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 若不使用反向代理,放开 9Router 端口
sudo ufw allow 3000/tcp
sudo ufw allow 20128/tcp

# 启用防火墙
sudo ufw enable
```

### 3. 限制仪表盘访问

如果只需要 API 访问,可限制仪表盘端口:

```bash
# 仅允许 localhost 访问仪表盘
sudo ufw deny 3000/tcp
```

通过 SSH 隧道访问仪表盘:

```bash
ssh -L 3000:localhost:3000 user@your-server.com
# 然后在浏览器打开 http://localhost:3000
```

### 4. 定期更新

```bash
# 更新系统包
sudo apt update && sudo apt upgrade -y

# 更新 9Router
cd /path/to/9router/app
git pull
npm install
npm run build
pm2 restart 9router
```

### 5. 备份策略

```bash
# 备份数据目录
tar -czf 9router-backup-$(date +%Y%m%d).tar.gz /var/lib/9router

# 每日自动备份(加入 crontab)
0 2 * * * tar -czf /backups/9router-$(date +\%Y\%m\%d).tar.gz /var/lib/9router
```

---

## 📊 监控

### 检查应用状态

```bash
# PM2 状态
pm2 status

# 查看日志
pm2 logs 9router --lines 100

# 监控资源
pm2 monit
```

### Nginx 日志

```bash
# 访问日志
sudo tail -f /var/log/nginx/access.log

# 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 系统资源

```bash
# CPU 和内存使用
htop

# 磁盘使用
df -h

# 网络连接
netstat -tulpn | grep -E '3000|20128'
```

---

## 🚨 故障排除

### 应用无法启动

```bash
# 查看日志
pm2 logs 9router

# 检查端口是否被占用
sudo lsof -i :3000
sudo lsof -i :20128

# 检查环境变量
pm2 env 9router
```

### Nginx 502 Bad Gateway

```bash
# 检查 9Router 是否运行
pm2 status

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 测试 Nginx 配置
sudo nginx -t
```

### SSE 流式输出无法工作

确保 Nginx 配置中已设置 `proxy_buffering off` 以支持 SSE。

### 权限被拒绝错误

```bash
# 修复数据目录权限
sudo chown -R $USER:$USER /var/lib/9router
chmod 755 /var/lib/9router
```

---

## 🔗 下一步

- [连接提供商](/providers/subscription.md)
- [配置组合](/features/combos.md)
- [集成工具](/integration/cursor.md)
