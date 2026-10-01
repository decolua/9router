# ☁️ クラウドデプロイメント

リモートアクセスと本番利用のため、VPSまたはDockerに9Routerをデプロイ。

---

## 🖥️ VPSデプロイメント

### 前提条件

- Ubuntu 20.04+ または同様のLinuxディストリビューション
- Node.js 20以上
- Git
- rootまたはsudoアクセス

### ステップ1: リポジトリをクローン

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
```

### ステップ2: 依存関係をインストール

```bash
npm install
```

### ステップ3: アプリケーションをビルド

```bash
npm run build
```

### ステップ4: 環境変数を設定

`.env` ファイルを作成するか、変数をエクスポート:

```bash
export JWT_SECRET="your-secure-secret-change-this-to-random-string"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/9router"
export NODE_ENV="production"
```

**環境変数:**

| 変数 | デフォルト | 説明 |
|----------|---------|-------------|
| `JWT_SECRET` | 自動生成 | **本番環境では必ず変更!** JWTトークンの署名に使用 |
| `INITIAL_PASSWORD` | `123456` | ダッシュボードログインパスワード |
| `DATA_DIR` | `~/.9router` | データベースとデータの保存パス |
| `NODE_ENV` | `development` | デプロイ時は `production` に設定 |
| `ENABLE_REQUEST_LOGS` | `false` | デバッグリクエスト/レスポンスログを有効化 |

### ステップ5: データディレクトリを作成

```bash
sudo mkdir -p /var/lib/9router
sudo chown $USER:$USER /var/lib/9router
```

### ステップ6: アプリケーションを起動

```bash
npm run start
```

### ステップ7: 本番環境用にPM2をセットアップ

PM2はアプリケーションを稼働させ続け、クラッシュ時に再起動します:

```bash
# PM2をグローバルにインストール
npm install -g pm2

# PM2で9Routerを起動
pm2 start npm --name 9router -- start

# PM2設定を保存
pm2 save

# システム起動時にPM2を開始するようセットアップ
pm2 startup
# 上記コマンドが出力する指示に従ってください
```

**PM2管理コマンド:**

```bash
# ログを表示
pm2 logs 9router

# アプリケーションを再起動
pm2 restart 9router

# アプリケーションを停止
pm2 stop 9router

# ステータスを表示
pm2 status

# リソースをモニタリング
pm2 monit
```

---

## 🐳 Dockerデプロイメント

### オプション1: Dockerfileを使用

`app` ディレクトリに `Dockerfile` を作成:

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

**ビルドと実行:**

```bash
# イメージをビルド
docker build -t 9router .

# コンテナを実行
docker run -d \
  --name 9router \
  -p 3000:3000 \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret-change-this" \
  -e INITIAL_PASSWORD="your-secure-password" \
  -v 9router-data:/app/data \
  9router
```

### オプション2: Docker Compose

`docker-compose.yml` を作成:

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

**Docker Composeで実行:**

```bash
# サービスを起動
docker-compose up -d

# ログを表示
docker-compose logs -f

# サービスを停止
docker-compose down

# 再ビルドして再起動
docker-compose up -d --build
```

---

## 🌐 Nginxリバースプロキシ

### Nginxを使う理由

- SSL/TLS終端
- ドメイン名マッピング
- ロードバランシング
- セキュリティ強化

### ステップ1: Nginxをインストール

```bash
sudo apt update
sudo apt install nginx
```

### ステップ2: Nginxを設定

`/etc/nginx/sites-available/9router` を作成:

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

### ステップ3: サイトを有効化

```bash
# シンボリックリンクを作成
sudo ln -s /etc/nginx/sites-available/9router /etc/nginx/sites-enabled/

# 設定をテスト
sudo nginx -t

# Nginxをリロード
sudo systemctl reload nginx
```

### ステップ4: Let's EncryptでSSLをセットアップ

```bash
# certbotをインストール
sudo apt install certbot python3-certbot-nginx

# SSL証明書を取得
sudo certbot --nginx -d your-domain.com

# 自動更新は自動的に設定されます
# 更新をテスト
sudo certbot renew --dry-run
```

---

## 🔒 セキュリティ考慮事項

### 1. デフォルト認証情報を変更

**重要:** デプロイ前に `JWT_SECRET` と `INITIAL_PASSWORD` を変更:

```bash
# 安全なJWTシークレットを生成
openssl rand -base64 32

# この値をJWT_SECRETに使用
export JWT_SECRET="generated-secret-here"
```

### 2. ファイアウォール設定

```bash
# SSHを許可
sudo ufw allow 22/tcp

# HTTP/HTTPSを許可 (Nginx使用時)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# リバースプロキシを使用しない場合、9Routerポートを許可
sudo ufw allow 3000/tcp
sudo ufw allow 20128/tcp

# ファイアウォールを有効化
sudo ufw enable
```

### 3. ダッシュボードアクセスを制限

APIアクセスのみ必要な場合、ダッシュボードポートを制限:

```bash
# ダッシュボードへのlocalhostアクセスのみ許可
sudo ufw deny 3000/tcp
```

SSHトンネル経由でダッシュボードにアクセス:

```bash
ssh -L 3000:localhost:3000 user@your-server.com
# ブラウザで http://localhost:3000 を開く
```

### 4. 定期的な更新

```bash
# システムパッケージを更新
sudo apt update && sudo apt upgrade -y

# 9Routerを更新
cd /path/to/9router/app
git pull
npm install
npm run build
pm2 restart 9router
```

### 5. バックアップ戦略

```bash
# データディレクトリをバックアップ
tar -czf 9router-backup-$(date +%Y%m%d).tar.gz /var/lib/9router

# 自動毎日バックアップ (crontabに追加)
0 2 * * * tar -czf /backups/9router-$(date +\%Y\%m\%d).tar.gz /var/lib/9router
```

---

## 📊 モニタリング

### アプリケーションステータスを確認

```bash
# PM2ステータス
pm2 status

# ログを表示
pm2 logs 9router --lines 100

# リソースをモニタリング
pm2 monit
```

### Nginxログ

```bash
# アクセスログ
sudo tail -f /var/log/nginx/access.log

# エラーログ
sudo tail -f /var/log/nginx/error.log
```

### システムリソース

```bash
# CPUとメモリ使用量
htop

# ディスク使用量
df -h

# ネットワーク接続
netstat -tulpn | grep -E '3000|20128'
```

---

## 🚨 トラブルシューティング

### アプリケーションが起動しない

```bash
# ログを確認
pm2 logs 9router

# ポートが使用中か確認
sudo lsof -i :3000
sudo lsof -i :20128

# 環境変数を確認
pm2 env 9router
```

### Nginx 502 Bad Gateway

```bash
# 9Routerが実行中か確認
pm2 status

# Nginxエラーログを確認
sudo tail -f /var/log/nginx/error.log

# Nginx設定をテスト
sudo nginx -t
```

### SSEストリーミングが動作しない

SSEサポート用にNginx設定で `proxy_buffering off` が設定されていることを確認。

### Permission Deniedエラー

```bash
# データディレクトリ権限を修正
sudo chown -R $USER:$USER /var/lib/9router
chmod 755 /var/lib/9router
```

---

## 🔗 次のステップ

- [プロバイダーを接続](/providers/subscription.md)
- [コンボをセットアップ](/features/combos.md)
- [ツールと統合](/integration/cursor.md)
