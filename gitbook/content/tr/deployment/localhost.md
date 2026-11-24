# 🏠 Localhost Dağıtımı

Geliştirme ve kişisel kullanım için 9Router'ı kendi makinenizde çalıştırın.

---

## 📦 Kurulum

9Router'ı npm ile global olarak kurun:

```bash
npm install -g 9router
```

**Gereksinimler:**
- Node.js 20 veya üzeri
- npm 9 veya üzeri

---

## 🚀 Sunucuyu Başlatma

9Router'ı tek komutla başlatın:

```bash
9router
```

Panel, tarayıcınızda `http://localhost:3000` adresinde otomatik olarak açılır

**Varsayılan Yapılandırma:**
- **Panel**: `http://localhost:3000`
- **API Uç Noktası**: `http://localhost:20128/v1`
- **Veri Dizini**: `~/.9router`

---

## 🔧 Yapılandırma

### Özel Veri Dizini

Ortam değişkeniyle özel bir veri dizini ayarlayın:

```bash
DATA_DIR=/path/to/data 9router
```

### Özel Port

API portu (20128) ve panel portu (3000) uygulama içinde tanımlıdır. Bunları değiştirmek için kaynak kodu düzenlemeniz veya destekleniyorsa ortam değişkenlerini kullanmanız gerekir.

---

## 🛑 Sunucuyu Durdurma

9Router'ın çalıştığı terminalde `Ctrl+C` tuşlarına basın.

```bash
# 9router'ın çalıştığı terminalde
^C  # Press Ctrl+C
```

Sunucu düzgün şekilde kapanır ve tüm verileri kaydeder.

---

## 🔄 Sunucuyu Yeniden Başlatma

Başlatma komutunu yeniden çalıştırmanız yeterli:

```bash
9router
```

Tüm yapılandırmalarınız, API anahtarlarınız ve kombolarınız veri dizininde korunur.

---

## 📊 9Router'ı Güncelleme

En son sürüme güncelleyin:

```bash
npm update -g 9router
```

Mevcut sürümünüzü kontrol edin:

```bash
npm list -g 9router
```

---

## 🔍 Sorun Giderme

### Port Zaten Kullanımda

20128 veya 3000 portu zaten kullanımdaysa:

```bash
# Portu kullanan süreci bulun (macOS/Linux)
lsof -i :20128
lsof -i :3000

# Süreci sonlandırın
kill -9 <PID>
```

### İzin Hataları

Kurulum sırasında izin hatalarıyla karşılaşırsanız:

```bash
# sudo kullanın (önerilmez)
sudo npm install -g 9router

# Veya npm izinlerini düzeltin (önerilir)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Veri Dizini Sorunları

Veri dizinine erişilemiyorsa:

```bash
# İzinleri kontrol edin
ls -la ~/.9router

# İzinleri düzeltin
chmod 755 ~/.9router
```

---

## 📁 Veri Dizini Yapısı

```
~/.9router/
├── db.json           # Ana veritabanı (sağlayıcılar, kombolar, ayarlar)
├── logs/             # Uygulama günlükleri
└── cache/            # Geçici önbellek dosyaları
```

**Verilerinizi Yedekleyin:**

```bash
# Yedekleme
cp -r ~/.9router ~/.9router.backup

# Geri yükleme
cp -r ~/.9router.backup ~/.9router
```

---

## 🔗 Sonraki Adımlar

- [Sağlayıcıları Bağlayın](/providers/subscription.md)
- [Kombo Oluşturun](/features/combos.md)
- [CLI Araçlarıyla Entegre Edin](/integration/cursor.md)
