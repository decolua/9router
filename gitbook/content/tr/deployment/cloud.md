# ☁️ Bulut Dağıtımı

Uzak erişim ve üretim kullanımı için 9Router'ı VPS veya Docker üzerinde dağıtın.

---

## 🖥️ VPS Dağıtımı

### Ön Koşullar

- Ubuntu 20.04+ veya benzeri bir Linux dağıtımı
- Node.js 20+
- Git
- Root veya sudo erişimi

### Adım 1: Depoyu Klonlayın

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
```

### Adım 2: Bağımlılıkları Kurun

```bash
npm install
```

### Adım 3: Uygulamayı Derleyin

```bash
npm run build
```

### Adım 4: Ortam Değişkenlerini Yapılandırın

Bir `.env` dosyası oluşturun veya değişkenleri export edin:

```bash
export JWT_SECRET="your-secure-secret-change-this-to-random-string"
export INITIAL_PASSWORD="your-secure-password"
export DATA_DIR="/var/lib/9router"
export NODE_ENV="production"
```

**Ortam Değişkenleri:**

| Değişken | Varsayılan | Açıklama |
|----------|---------|-------------|
| `JWT_SECRET` | Otomatik oluşturulur | **Üretimde mutlaka değiştirin!** JWT token imzalamada kullanılır |
| `INITIAL_PASSWORD` | `123456` | Panel giriş parolası |
| `DATA_DIR` | `~/.9router` | Veritabanı ve veri depolama yolu |
| `NODE_ENV` | `development` | Dağıtım için `production` olarak ayarlayın |
| `ENABLE_REQUEST_LOGS` | `false` | Hata ayıklama istek/yanıt günlüklerini etkinleştirir |

### Adım 5: Veri Dizini Oluşturun

```bash
sudo mkdir -p /var/lib/9router
sudo chown $USER:$USER /var/lib/9router
```

### Adım 6: Uygulamayı Başlatın

```bash
npm run start
```

### Adım 7: Üretim için PM2 Kurun

PM2 uygulamanızı çalışır durumda tutar ve çökmelerde yeniden başlatır:

```bash
# PM2'yi global olarak kurun
npm install -g pm2

# 9Router'ı PM2 ile başlatın
pm2 start npm --name 9router -- start

# PM2 yapılandırmasını kaydedin
pm2 save

# PM2'yi sistem açılışında başlayacak şekilde ayarlayın
pm2 startup
# Yukarıdaki komutun yazdırdığı talimatları izleyin
```

**PM2 Yönetim Komutları:**

```bash
# Günlükleri görüntüleyin
pm2 logs 9router

# Uygulamayı yeniden başlatın
pm2 restart 9router

# Uygulamayı durdurun
pm2 stop 9router

# Durumu görüntüleyin
pm2 status

# Kaynakları izleyin
pm2 monit
```

---

## 🐳 Docker Dağıtımı

### Seçenek 1: Dockerfile Kullanma

`app` dizininde bir `Dockerfile` oluşturun:

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

**Oluşturun ve Çalıştırın:**

```bash
# İmaj oluşturun
docker build -t 9router .

# Konteyneri çalıştırın
docker run -d \
  --name 9router \
  -p 3000:3000 \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret-change-this" \
  -e INITIAL_PASSWORD="your-secure-password" \
  -v 9router-data:/app/data \
  9router
```

### Seçenek 2: Docker Compose

`docker-compose.yml` oluşturun:

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

**Docker Compose ile Çalıştırın:**

```bash
# Servisleri başlatın
docker-compose up -d

# Günlükleri görüntüleyin
docker-compose logs -f

# Servisleri durdurun
docker-compose down

# Yeniden derleyip başlatın
docker-compose up -d --build
```

---

## 🌐 Nginx ile Ters Proxy

### Nginx Neden Kullanılır?

- SSL/TLS sonlandırma
- Alan adı eşleme
- Yük dengeleme
- Daha iyi güvenlik

### Adım 1: Nginx Kurun

```bash
sudo apt update
sudo apt install nginx
```

### Adım 2: Nginx Yapılandırın

`/etc/nginx/sites-available/9router` dosyasını oluşturun:

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

### Adım 3: Siteyi Etkinleştirin

```bash
# Sembolik bağ oluşturun
sudo ln -s /etc/nginx/sites-available/9router /etc/nginx/sites-enabled/

# Yapılandırmayı test edin
sudo nginx -t

# Nginx'i yeniden yükleyin
sudo systemctl reload nginx
```

### Adım 4: Let's Encrypt ile SSL Kurun

```bash
# certbot'u kurun
sudo apt install certbot python3-certbot-nginx

# SSL sertifikası alın
sudo certbot --nginx -d your-domain.com

# Otomatik yenileme kendiliğinden yapılandırılır
# Yenilemeyi test edin
sudo certbot renew --dry-run
```

---

## 🔒 Güvenlik Değerlendirmeleri

### 1. Varsayılan Kimlik Bilgilerini Değiştirin

**KRİTİK:** Dağıtımdan önce `JWT_SECRET` ve `INITIAL_PASSWORD` değerlerini değiştirin:

```bash
# Güvenli JWT secret üretin
openssl rand -base64 32

# Bu değeri JWT_SECRET için kullanın
export JWT_SECRET="generated-secret-here"
```

### 2. Güvenlik Duvarı Yapılandırması

```bash
# SSH'a izin verin
sudo ufw allow 22/tcp

# HTTP/HTTPS'e izin verin (Nginx kullanıyorsanız)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Ters proxy kullanmıyorsanız 9Router portlarına izin verin
sudo ufw allow 3000/tcp
sudo ufw allow 20128/tcp

# Güvenlik duvarını etkinleştirin
sudo ufw enable
```

### 3. Panel Erişimini Kısıtlayın

Yalnızca API erişimine ihtiyacınız varsa panel portunu kısıtlayın:

```bash
# Panele yalnızca localhost erişimine izin verin
sudo ufw deny 3000/tcp
```

Panele SSH tüneli üzerinden erişin:

```bash
ssh -L 3000:localhost:3000 user@your-server.com
# Ardından tarayıcınızda http://localhost:3000 adresini açın
```

### 4. Düzenli Güncellemeler

```bash
# Sistem paketlerini güncelleyin
sudo apt update && sudo apt upgrade -y

# 9Router'ı güncelleyin
cd /path/to/9router/app
git pull
npm install
npm run build
pm2 restart 9router
```

### 5. Yedekleme Stratejisi

```bash
# Veri dizinini yedekleyin
tar -czf 9router-backup-$(date +%Y%m%d).tar.gz /var/lib/9router

# Günlük otomatik yedek (crontab'a ekleyin)
0 2 * * * tar -czf /backups/9router-$(date +\%Y\%m\%d).tar.gz /var/lib/9router
```

---

## 📊 İzleme

### Uygulama Durumunu Kontrol Edin

```bash
# PM2 durumu
pm2 status

# Günlükleri görüntüleyin
pm2 logs 9router --lines 100

# Kaynakları izleyin
pm2 monit
```

### Nginx Günlükleri

```bash
# Erişim günlükleri
sudo tail -f /var/log/nginx/access.log

# Hata günlükleri
sudo tail -f /var/log/nginx/error.log
```

### Sistem Kaynakları

```bash
# CPU ve bellek kullanımı
htop

# Disk kullanımı
df -h

# Ağ bağlantıları
netstat -tulpn | grep -E '3000|20128'
```

---

## 🚨 Sorun Giderme

### Uygulama Başlamıyor

```bash
# Günlükleri kontrol edin
pm2 logs 9router

# Portların kullanımda olup olmadığını kontrol edin
sudo lsof -i :3000
sudo lsof -i :20128

# Ortam değişkenlerini kontrol edin
pm2 env 9router
```

### Nginx 502 Bad Gateway

```bash
# 9Router'ın çalışıp çalışmadığını kontrol edin
pm2 status

# Nginx hata günlüklerini kontrol edin
sudo tail -f /var/log/nginx/error.log

# Nginx yapılandırmasını test edin
sudo nginx -t
```

### SSE Akışı Çalışmıyor

SSE desteği için Nginx yapılandırmasında `proxy_buffering off` ayarının yapıldığından emin olun.

### İzin Reddedildi Hataları

```bash
# Veri dizini izinlerini düzeltin
sudo chown -R $USER:$USER /var/lib/9router
chmod 755 /var/lib/9router
```

---

## 🔗 Sonraki Adımlar

- [Sağlayıcıları Bağlayın](/providers/subscription.md)
- [Komboları Kurun](/features/combos.md)
- [Araçlarla Entegre Edin](/integration/cursor.md)
