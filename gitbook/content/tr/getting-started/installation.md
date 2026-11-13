# Kurulum

Sorun giderme ipuçlarıyla 9Router için ayrıntılı kurulum kılavuzu.

---

## Gereksinimler

### Sistem gereksinimleri

- **Node.js**: Sürüm 20.0.0 veya üzeri
- **npm**: Sürüm 10.0.0 veya üzeri (Node.js ile birlikte gelir)
- **İşletim sistemi**: macOS, Linux, Windows (WSL önerilir)
- **Disk alanı**: kurulum için ~200MB

### Sürümünüzü kontrol edin

```bash
node --version
# v20.x.x veya üzerini göstermeli

npm --version
# 10.x.x veya üzerini göstermeli
```

**Node.js'iniz yok mu?** [nodejs.org](https://nodejs.org/) adresinden kurun

---

## Kurulum yöntemleri

### Yöntem 1: Global kurulum (önerilir)

Her yerden kullanmak için 9Router'ı global olarak kurun:

```bash
npm install -g 9router
```

**9Router'ı başlatın:**

```bash
9router
```

**Avantajlar:**
- ✅ Her dizinden çalıştırın
- ✅ Basit komut: `9router`
- ✅ `npm update -g 9router` ile otomatik güncellenir

### Yöntem 2: Yerel kurulum

Belirli bir projeye kurun:

```bash
mkdir my-9router
cd my-9router
npm install 9router
```

**9Router'ı başlatın:**

```bash
npx 9router
```

**Avantajlar:**
- ✅ Proje başına izole
- ✅ Proje başına sürüm kontrolü
- ✅ Global isim alanı kirliliği yok

### Yöntem 3: Kaynak koddan (geliştirme)

GitHub'dan klonlayın ve derleyin:

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install
npm run build
npm start
```

**Avantajlar:**
- ✅ En yeni geliştirme özellikleri
- ✅ Geliştirmeye katkıda bulunun
- ✅ Özel değişiklikler

---

## İlk çalıştırma

### Sunucuyu başlatın

```bash
9router
```

**Ne olur:**
1. Sunucu `http://localhost:20128` üzerinde başlar
2. Panel tarayıcıda otomatik açılır
3. Veri dizini `~/.9router` altında oluşturulur
4. API anahtarı otomatik oluşturulur

### Panel girişi

**Varsayılan kimlik bilgileri:**
- Parola: `123456`

**⚠️ Parolayı hemen değiştirin:**
1. Panele giriş yapın
2. Settings → Change Password
3. Güçlü bir parola kullanın

### API anahtarınızı alın

```
Dashboard → Settings → API Keys
→ API anahtarınızı kopyalayın
→ CLI araçlarında kullanın
```

**Örnek API anahtarı biçimi:**
```
9r_1234567890abcdef1234567890abcdef
```

---

## Kurulumu doğrulama

### Sunucu durumunu kontrol edin

```bash
curl http://localhost:20128/health
```

**Beklenen yanıt:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### Kullanılabilir modelleri listeleyin

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**Beklenen yanıt:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### Sohbet tamamlamayı test edin

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## Yapılandırma

### Ortam değişkenleri

Bir `.env` dosyası oluşturun veya ortam değişkenlerini ayarlayın:

```bash
# Güvenlik (üretimde ZORUNLU)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# Depolama
export DATA_DIR="~/.9router"

# Sunucu
export PORT="20128"
export NODE_ENV="production"

# Günlükleme
export ENABLE_REQUEST_LOGS="false"
```

### Veri dizini

**Varsayılan konum:** `~/.9router`

**İçerik:**
```
~/.9router/
  ├── db.json           # Veritabanı (sağlayıcılar, kombolar, kullanım)
  ├── api-keys.json     # API anahtarları
  └── logs/             # İstek günlükleri (etkinse)
```

**Konumu değiştirin:**

```bash
export DATA_DIR="/custom/path"
9router
```

### Port yapılandırması

**Varsayılan port:** `20128`

**Portu değiştirin:**

```bash
export PORT="3000"
9router
```

**Veya komut satırını kullanın:**

```bash
9router --port 3000
```

---

## Sorun giderme

### Port zaten kullanımda

**Hata:**
```
Error: listen EADDRINUSE: address already in use :::20128
```

**Çözüm 1: Mevcut süreci sonlandırın**

```bash
# 20128 portunu kullanan süreci bulun
lsof -i :20128

# Süreci sonlandırın
kill -9 <PID>
```

**Çözüm 2: Farklı bir port kullanın**

```bash
9router --port 3000
```

### İzin reddedildi

**Hata:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/9router'
```

**Çözüm: sudo kullanın (önerilmez) veya npm izinlerini düzeltin**

```bash
# npm izinlerini düzeltin (önerilir)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Ardından yeniden kurun
npm install -g 9router
```

### Node.js sürümü çok eski

**Hata:**
```
Error: The engine "node" is incompatible with this module
```

**Çözüm: Node.js'i güncelleyin**

```bash
# nvm kullanarak (önerilir)
nvm install 20
nvm use 20

# Veya nodejs.org'dan indirin
```

### Panel açılmıyor

**Sorun:** Panel otomatik açılmıyor

**Çözüm 1: Elle açın**

```
http://localhost:20128
```

**Çözüm 2: Güvenlik duvarını kontrol edin**

```bash
# macOS: Sistem Tercihleri → Güvenlik bölümünde Node.js'e izin verin
# Linux: iptables'ı kontrol edin
# Windows: Windows Güvenlik Duvarı'nı kontrol edin
```

### Sağlayıcılara bağlanılamıyor

**Sorun:** OAuth girişi başarısız oluyor veya API anahtarı geçersiz

**Çözüm 1: İnternet bağlantısını kontrol edin**

```bash
ping google.com
```

**Çözüm 2: Sağlayıcı durumunu kontrol edin**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**Çözüm 3: API anahtarını yeniden oluşturun**

```
Dashboard → Provider → Disconnect → Reconnect
```

### Yüksek bellek kullanımı

**Sorun:** 9Router çok fazla RAM kullanıyor

**Çözüm: Sunucuyu yeniden başlatın**

```bash
# Durdurun
pkill -f 9router

# Başlatın
9router
```

**Veya otomatik yeniden başlatma için PM2 kullanın:**

```bash
npm install -g pm2
pm2 start 9router --name 9router
pm2 save
```

---

## Dağıtım seçenekleri

### Yerel geliştirme

```bash
npm install -g 9router
9router
```

**Kullanım durumu:** Kişisel kodlama, test

### VPS/Cloud sunucu

```bash
# Kurun
npm install -g 9router

# Yapılandırın
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# PM2 ile başlatın
npm install -g pm2
pm2 start 9router --name 9router
pm2 save
pm2 startup
```

**Kullanım durumu:** Ekip erişimi, uzaktan kodlama

### Docker

```bash
docker pull 9router/9router:latest

docker run -d \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v 9router-data:/root/.9router \
  --name 9router \
  9router/9router:latest
```

**Kullanım durumu:** Konteynerleştirilmiş dağıtım, Kubernetes

### Ters proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**Kullanım durumu:** HTTPS, özel alan adı, yük dengeleme

---

## Kaldırma

### Global kurulumu kaldırma

```bash
npm uninstall -g 9router
```

### Veri dizinini kaldırma

```bash
rm -rf ~/.9router
```

### Yapılandırmayı kaldırma

```bash
# Kabuk yapılandırmasından ortam değişkenlerini silin
nano ~/.bashrc  # or ~/.zshrc
# 9router ile ilgili export satırlarını silin
```

---

## Sonraki adımlar

- [Başlangıç kılavuzu](../getting-started.md) - Sağlayıcıları bağlayın ve kod yazmaya başlayın
- [Özellikler](../features/) - Kota takibi, kombolar, dağıtımı keşfedin
- [Sorun giderme](../troubleshooting.md) - Sık karşılaşılan sorunları çözün

---

## Yardım mı gerekiyor?

- **Web sitesi**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
