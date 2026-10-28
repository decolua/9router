# Sıkça Sorulan Sorular

9Router hakkında sık sorulan sorular.

---

## 9Router nedir?

**9Router, abonelik değerinizi en üst düzeye çıkarırken maliyetleri en aza indiren bir AI model yönlendiricisidir.**

İstekleri, 3 katmanlı yedek geçiş (fallback) sistemiyle birden fazla AI sağlayıcısı arasında akıllıca yönlendirir:
1. **Abonelik katmanı** - Zaten ödediğiniz Claude Code, Codex, Gemini kotalarını en üst düzeye çıkarın
2. **Ucuz katman** - Ultra ucuz alternatifler (1M token başına $0.20-$0.60)
3. **Ücretsiz katman** - Sınırsız ücretsiz model içeren acil durum yedeği

**Başlıca avantajlar:**
- Abonelik kotası asla boşa gitmez
- Kota tükendiğinde otomatik yedek geçiş
- Gerçek zamanlı kota takibi
- Doğrudan API kullanımına kıyasla %90 maliyet tasarrufu

---

## Fiyatlandırma nasıl işliyor?

**9Router 3 katmanlı bir fiyatlandırma stratejisi kullanır:**

### Katman 1: Abonelik (Önce En Üst Düzeye Çıkarın)
- **Claude Code** (Pro/Max): $20-100/ay - 5 saatlik + haftalık kota
- **OpenAI Codex** (Plus/Pro): $20-200/ay - 5 saatlik + haftalık kota
- **Gemini CLI**: ÜCRETSİZ - Ayda 180K tamamlama + Günde 1K
- **GitHub Copilot**: $10-19/ay - Aylık sıfırlama
- **Antigravity**: ÜCRETSİZ - Gemini'ye benzer

**Hedef:** Sıfırlanmadan önce kotanın her damlasını kullanın!

### Katman 2: Ucuz (Yedek)
- **GLM-4.7**: 1M token başına $0.60/$2.20 - Günlük sıfırlama 10:00
- **MiniMax M2.1**: 1M token başına $0.20/$1.00 - 5 saatlik kayan pencere
- **Kimi K2**: Sabit $9/ay (10M token)

**Hedef:** ChatGPT API'sinden ($20/1M) %90 daha ucuz!

### Katman 3: Ücretsiz (Acil Durum)
- **iFlow**: 8 model ÜCRETSİZ (Kimi K2, Qwen3, GLM, MiniMax...)
- **Qwen**: 3 model ÜCRETSİZ (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: 2 model ÜCRETSİZ (Claude Sonnet 4.5, Haiku 4.5)

**Hedef:** Diğer her şey kota sınırına takıldığında sıfır maliyetli yedek geçiş!

---

## 9Router ücretsiz mi?

**Evet, 9Router'ın kendisi %100 ücretsiz ve açık kaynaklıdır.**

**Kullanılabilir ücretsiz katman sağlayıcıları:**
- **Gemini CLI** - Ayda 180K tamamlama (ÜCRETSİZ Google hesabı)
- **iFlow** - 8 model sınırsız (ÜCRETSİZ OAuth)
- **Qwen** - 3 model sınırsız (ÜCRETSİZ OAuth)
- **Kiro** - Claude Sonnet/Haiku (ÜCRETSİZ AWS Builder ID)

**Yalnızca ücretsiz katman sağlayıcılarını kullanarak sonsuza kadar ÜCRETSİZ kodlayabilirsiniz!**

**İsteğe bağlı ücretli sağlayıcılar:**
- Zaten sahip olabileceğiniz abonelik hizmetleri (Claude Code, Codex, Copilot)
- Ultra ucuz alternatifler (1M token başına $0.20-$0.60)

---

## Hangi sağlayıcılar destekleniyor?

### Abonelik Sağlayıcıları
- **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- **Gemini CLI** (ÜCRETSİZ) - Gemini 3 Flash/Pro, 2.5 Pro/Flash
- **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

### Ucuz Sağlayıcılar
- **GLM** (Zhipu AI) - GLM 4.7, GLM 4.6V Vision
- **MiniMax** - MiniMax M2.1
- **Kimi** (Moonshot AI) - Kimi Latest
- **OpenRouter** - Herhangi bir OpenRouter modeline doğrudan geçiş

### Ücretsiz Sağlayıcılar
- **iFlow** - 8 model (Kimi K2, Qwen3, GLM, MiniMax, DeepSeek...)
- **Qwen** - 3 model (Qwen3 Coder Plus/Flash, Vision)
- **Kiro** - 2 model (Claude Sonnet 4.5, Haiku 4.5)

**Toplam: 15+ sağlayıcı, 50+ model**

Ayrıntılar için [sağlayıcı belgelerine](providers/subscription.md) bakın.

---

## Birden fazla sağlayıcı kullanabilir miyim?

**Evet! Bu, 9Router'ın temel özelliğidir.**

**Kombolar, birden fazla sağlayıcıyı otomatik yedek geçişle zincirlemenizi sağlar:**

```
Örnek kombo: "premium-coding"
1. cc/claude-opus-4-5 (birincil abonelik)
2. glm/glm-4.7 (ucuz yedek)
3. if/kimi-k2 (ücretsiz acil durum)

→ Kota tükendiğinde otomatik geçiş yapar
→ Kodlamayı asla durdurmaz
→ Minimum ek maliyet
```

**Kombo nasıl oluşturulur:**
```
Dashboard → Combos → Create New
→ Modelleri öncelik sırasına göre ekleyin
→ CLI'da kombo adını kullanın: "premium-coding"
```

**Avantajlar:**
- Kota tükendiğinde sıfır kesinti
- Otomatik maliyet optimizasyonu
- Tüm araçlar için tek model adı

Örnekler için [kombo belgelerine](features/combos.md) bakın.

---

## Kota takibi nasıl çalışır?

**9Router, tüm sağlayıcılar için kotayı gerçek zamanlı izler:**

**Özellikler:**
- **Token tüketimi** - İstek başına giriş/çıkış token'ları
- **Sıfırlama geri sayımı** - Kotanın yenilenmesine kalan süre
- **Kullanım istatistikleri** - Günlük/haftalık/aylık raporlar
- **Maliyet tahmini** - Öngörülen harcama (ücretli katmanlar)
- **Kota uyarıları** - Kota azaldığında bildirimler

**Kota türleri:**
- **5 saatlik kayan pencere** - Claude Code, Codex, MiniMax
- **Günlük sıfırlama** - Gemini CLI (günde 1K), GLM (10:00)
- **Haftalık sıfırlama** - Claude Code, Codex (ek kota)
- **Aylık sıfırlama** - Gemini CLI (180K), GitHub Copilot (ayın 1'i)

**Kotayı görüntüleyin:**
```
Dashboard → Providers → Quota Tracking
→ Gerçek zamanlı kullanım + sıfırlama geri sayımı
```

Ayrıntılar için [kota takibi belgelerine](features/quota-tracking.md) bakın.

---

## 9Router, Cursor ile çalışır mı?

**Evet, ancak Cursor bulut uç noktası gerektirir.**

**Sorun:** Cursor IDE, localhost uç noktalarını desteklemez.

**Çözüm:** 9Router bulut dağıtımını kullanın:

```
Cursor Settings → Models → Advanced:
  OpenAI API Base URL: https://9router.com/v1
  OpenAI API Key: [panelden]
  Model: cc/claude-opus-4-5-20251101
```

**Alternatif:** Genel bir alan adıyla VPS'te kendi sunucunuzda barındırın:
```bash
# VPS'e dağıtın
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build
npm start

# Nginx ters proxy'yi yapılandırın
# Cursor'ı şu adrese yönlendirin: https://your-domain.com/v1
```

**Diğer CLI araçları localhost ile çalışır:**
- Cline ✅
- Claude Desktop ✅
- Codex CLI ✅
- Continue ✅
- RooCode ✅

Ayrıntılar için [Cursor entegrasyon kılavuzuna](integration/cursor.md) bakın.

---

## 9Router'ı kendi sunucumda barındırabilir miyim?

**Evet! 9Router birden fazla dağıtım seçeneğini destekler:**

### Localhost (Varsayılan)
```bash
npm install -g 9router
9router
→ Dashboard: http://localhost:3000
→ API: http://localhost:20128/v1
```

### VPS/Cloud
```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
npm install && npm run build

export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

npm start
```

### Docker
```bash
docker build -t 9router .
docker run -d \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret" \
  -v 9router-data:/app/data \
  9router
```

### Cloudflare Workers
```bash
cd 9router/app
npm run deploy:cloudflare
```

**Ortam değişkenleri:**
- `JWT_SECRET` - **Üretimde mutlaka değiştirin!**
- `DATA_DIR` - Veritabanı depolama yolu (varsayılan: `~/.9router`)
- `INITIAL_PASSWORD` - Panel girişi (varsayılan: `123456`)
- `NODE_ENV` - Dağıtım için `production` olarak ayarlayın

Ayrıntılar için [dağıtım kılavuzuna](getting-started/installation.md#deployment) bakın.

---

## Verilerim güvende mi?

**Evet, 9Router güvenlik ve gizliliğe öncelik verir:**

**Yerel depolama:**
- Tüm veriler yerel olarak `~/.9router` içinde (veya özel `DATA_DIR` ile) saklanır
- 9Router sunucularına hiçbir veri gönderilmez
- OAuth token'ları JWT ile şifrelenir

**Telemetri yok:**
- Kullanım takibi yok
- Analitik yok
- Dışarıya veri gönderimi yok

**Açık kaynak:**
- Tam kaynak kodu GitHub'da mevcut
- Güvenliği kendiniz denetleyin
- Topluluk tarafından incelendi

**En iyi uygulamalar:**
- Üretimde `JWT_SECRET` değiştirin
- Güçlü bir `INITIAL_PASSWORD` kullanın
- Bulut dağıtımları için HTTPS'i etkinleştirin
- API anahtarlarını düzenli olarak yenileyin

**9Router'ın sakladıkları:**
- Sağlayıcı OAuth token'ları (şifreli)
- API anahtarları (şifreli)
- Kullanım istatistikleri (yalnızca yerel)
- Kombo yapılandırmaları

**9Router'ın saklamadıkları:**
- İstemleriniz veya yanıtlarınız
- Ürettiğiniz kod
- Kişisel bilgiler

---

## 9Router'ı nasıl güncellerim?

**Güncelleme yöntemleri kurulum türüne bağlıdır:**

### Global NPM Kurulumu
```bash
npm update -g 9router
```

### Yerel Kurulum
```bash
cd 9router/app
git pull origin main
npm install
npm run build
npm start
```

### Docker
```bash
docker pull 9router:latest
docker stop 9router
docker rm 9router
docker run -d \
  -p 3000:3000 \
  -v 9router-data:/app/data \
  9router:latest
```

**Sürümü kontrol edin:**
```bash
9router --version
```

**Kırıcı değişiklikler:**
- [CHANGELOG.md](https://github.com/decolua/9router/blob/main/CHANGELOG.md) dosyasına bakın
- Büyük güncellemelerden önce `~/.9router` yedeğini alın
- Büyük sürümler için geçiş kılavuzlarını inceleyin

---

## Nasıl katkıda bulunabilirim?

**Katkılara açığız!**

### Katkı yolları:

1. **Hata bildirin:**
   - [GitHub Issues](https://github.com/decolua/9router/issues)
   - Hata günlüklerini ve yeniden üretme adımlarını ekleyin

2. **Özellik isteyin:**
   - [GitHub Discussions](https://github.com/decolua/9router/discussions)
   - Kullanım senaryosunu ve faydalarını açıklayın

3. **Kod gönderin:**
   ```bash
   # Depoyu forklayın
   git clone https://github.com/YOUR_USERNAME/9router.git
   cd 9router
   
   # Dal oluşturun
   git checkout -b feature/your-feature
   
   # Değişiklikleri yapın
   npm install
   npm run dev
   
   # Test edin
   npm test
   
   # Commit'leyin ve gönderin
   git add .
   git commit -m "Add your feature"
   git push origin feature/your-feature
   
   # GitHub'da Pull Request oluşturun
   ```

4. **Belgeleri iyileştirin:**
   - Yazım hatalarını düzeltin, örnekler ekleyin
   - Diğer dillere çeviri yapın
   - Eğitimler yazın

5. **Sağlayıcı ekleyin:**
   - Yeni sağlayıcı adaptörleri yazın
   - Örnekler için `app/lib/providers/` dizinine bakın

**Katkı kuralları:**
- Mevcut kod stiline uyun
- Yeni özellikler için test ekleyin
- Belgeleri güncelleyin
- Commit'leri atomik ve açıklayıcı tutun

Ayrıntılar için [CONTRIBUTING.md](https://github.com/decolua/9router/blob/main/CONTRIBUTING.md) dosyasına bakın.

---

## Daha fazla yardıma mı ihtiyacınız var?

- **Belgeler:** [9router.com/docs](https://9router.com/docs)
- **GitHub:** [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Sorun giderme:** [troubleshooting.md](troubleshooting.md)
