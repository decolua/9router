# Ucuz Sağlayıcılar - Ultra Ucuz Yedek

Abonelik kotası tükendiğinde dolar yerine kuruş ödeyin. ChatGPT API'den ~%90 daha ucuz!

---

## Genel Bakış

Abonelik kotası tükendiğinde ucuz katman sağlayıcıları **yedeğinizdir**:

- 💰 **GLM-4.7** - 1M token başına $0.6/$2.2 (günlük sıfırlama)
- 💰 **MiniMax M2.1** - 1M token başına $0.2/$1.0 (5 saatlik sıfırlama)
- 💰 **Kimi K2** - $9/ay sabit (10M token)

**Strateji:** Abonelik kotası tükendikten sonra, ücretsiz katmandan önce kullanın. ChatGPT API'ye kıyasla büyük maliyet tasarrufu ($20/1M).

---

## GLM-4.7 (Günlük Sıfırlama)

### Fiyatlandırma

| Katman | Girdi | Çıktı | Sıfırlama |
|------|-------|--------|-------|
| Standard | $0.60/1M | $2.20/1M | Günlük 10:00 AM |
| Coding Plan | $0.60/1M | $2.20/1M | Günlük 10:00 AM (3× kota) |

**Maliyet Örneği (10M token):**
- Girdi: 10M × $0.60 = $6
- Çıktı: 10M × $2.20 = $22
- **Toplam: $6-22** - ChatGPT API'de $200!

### Kurulum

**Adım 1: Kaydolun**

1. [Zhipu AI](https://open.bigmodel.cn/) sitesini ziyaret edin
2. Hesap oluşturun (telefon doğrulaması)
3. Aynı fiyata 3× kota için **Coding Plan** seçin

**Adım 2: API Anahtarı Alın**

```bash
Dashboard → API Keys → Create New
→ Copy API key (starts with "zhipu-")
```

**Adım 3: 9Router'a Ekleyin**

```bash
9router
# Panel → Providers → Add API Key

Provider: glm
API Key: zhipu-your-api-key-here
```

**Adım 4: CLI'da Kullanın**

```
Model: glm/glm-4.7
       glm/glm-4.6v (vision)
```

### Kullanılabilir Modeller

| Model ID | Açıklama | Bağlam | İdeal Kullanım |
|----------|-------------|---------|----------|
| `glm/glm-4.7` | GLM 4.7 | 128K | Kodlama, genel görevler |
| `glm/glm-4.6v` | GLM 4.6V Vision | 128K | Görsel analizi |

### İpuçları

- **Coding Plan** - Aynı fiyata 3× kota ($0.6/$2.2)
- **Günlük sıfırlama** - 10:00 AM Pekin saatinde taze kota
- **Kodlama için ideal** - Kod üretimi için optimize edilmiş
- **128K bağlam** - Büyük dosyaların üstesinden gelin

### Kota Sıfırlaması

```
Günlük sıfırlama: 10:00 AM Pekin Saati (UTC+8)
→ 2:00 AM UTC
→ 6:00 PM PST (önceki gün)
→ 9:00 PM EST (önceki gün)

Yoğun görevlerinizi sıfırlama saatine göre planlayın!
```

---

## MiniMax M2.1 (5 Saatlik Sıfırlama)

### Fiyatlandırma

| Katman | Girdi | Çıktı | Sıfırlama |
|------|-------|--------|-------|
| Standard | $0.20/1M | $1.00/1M | 5 saatlik kayan |

**Maliyet Örneği (10M token):**
- Girdi: 10M × $0.20 = $2
- Çıktı: 10M × $1.00 = $10
- **Toplam: $2-10** - En ucuz seçenek!

### Kurulum

**Adım 1: Kaydolun**

1. [MiniMax](https://www.minimax.io/) sitesini ziyaret edin
2. Hesap oluşturun
3. E-posta/telefon doğrulayın

**Adım 2: API Anahtarı Alın**

```bash
Dashboard → API Management → Create Key
→ Copy API key
```

**Adım 3: 9Router'a Ekleyin**

```bash
9router
# Panel → Providers → Add API Key

Provider: minimax
API Key: your-minimax-api-key
```

**Adım 4: CLI'da Kullanın**

```
Model: minimax/MiniMax-M2.1
```

### Kullanılabilir Modeller

| Model ID | Açıklama | Bağlam | İdeal Kullanım |
|----------|-------------|---------|----------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 | 1M token | Uzun bağlam, kodlama |

### İpuçları

- **En ucuz seçenek** - $0.20/1M girdi (ChatGPT'den %90 daha ucuz)
- **5 saatlik kayan** - Kota her 5 saatte sıfırlanır
- **1M bağlam** - Devasa bağlam penceresi
- **Uzun dosyalar için ideal** - Tüm kod tabanlarının üstesinden gelin

### Kota Sıfırlaması

```
5 saatlik kayan pencere:
→ Kotayı kullan → 5 saat bekle → Taze kota

Örnek:
10:00 AM - 5M token kullan
3:00 PM - Taze kota hazır
8:00 PM - Taze kota hazır

Minimum maliyetle 24/7 kodlayın!
```

---

## Kimi K2 (Sabit $9/ay)

### Fiyatlandırma

| Plan | Aylık Maliyet | Dahil Token | Efektif Maliyet |
|------|--------------|-----------------|----------------|
| Subscription | $9 | 10M token | $0.90/1M |

**Maliyet Örneği:**
- $9/ay sabit
- 10M token dahil
- **Efektif: $0.90/1M** - Tutarlı kullanım için en iyi değer!

### Kurulum

**Adım 1: Abone Olun**

1. [Moonshot AI](https://platform.moonshot.ai/) sitesini ziyaret edin
2. Hesap oluşturun
3. $9/ay planına abone olun

**Adım 2: API Anahtarı Alın**

```bash
Dashboard → API Keys → Create New
→ Copy API key
```

**Adım 3: 9Router'a Ekleyin**

```bash
9router
# Panel → Providers → Add API Key

Provider: kimi
API Key: your-kimi-api-key
```

**Adım 4: CLI'da Kullanın**

```
Model: kimi/kimi-latest
```

### Kullanılabilir Modeller

| Model ID | Açıklama | Bağlam | İdeal Kullanım |
|----------|-------------|---------|----------|
| `kimi/kimi-latest` | Kimi Latest | 200K | Genel kodlama |

### İpuçları

- **Sabit maliyet** - Kullanımdan bağımsız $9/ay (10M'ye kadar)
- **Tutarlı kullanım için ideal** - Ayda 10M kullanırsanız yalnızca $0.90/1M
- **Aylık sıfırlama** - 10M token aylık sıfırlanır
- **Öngörülebilir faturalama** - Sürpriz maliyet yok

### Kota Sıfırlaması

```
Aylık sıfırlama: her ayın 1'i
→ 10M token yenilenir

Örnek aylık kullanım:
1. Hafta: 3M token
2. Hafta: 2M token
3. Hafta: 3M token
4. Hafta: 2M token
Toplam: 10M token = $9 sabit
```

---

## Fiyat Karşılaştırması

| Sağlayıcı | Girdi/1M | Çıktı/1M | Sıfırlama | 10M Maliyet | İdeal Kullanım |
|----------|----------|-----------|-------|----------|----------|
| **GLM-4.7** | $0.60 | $2.20 | Günlük 10AM | $6-22 | Günlük kota kullananlar |
| **MiniMax M2.1** | $0.20 | $1.00 | 5 saatlik | $2-10 | **En ucuz!** |
| **Kimi K2** | $0.90 | $0.90 | Aylık | **$9 sabit** | Tutarlı kullanım |
| ChatGPT API | $20.00 | $20.00 | Yok | $200 | ❌ Pahalı |

**Tasarruf:** ChatGPT API'den %90-95 daha ucuz!

---

## Kullanım Örneği

### Cursor IDE Kurulumu

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9router panelinden]
  Model: glm/glm-4.7
```

### Kombo Oluşturun (Önerilir)

```
Dashboard → Combos → Create New

Name: cheap-backup
Models:
  1. cc/claude-opus-4-5 (Birincil abonelik)
  2. glm/glm-4.7 (Ucuz yedek, günlük sıfırlama)
  3. minimax/MiniMax-M2.1 (En ucuz yedek geçiş)
  4. if/kimi-k2-thinking (ÜCRETSİZ acil durum)

CLI'da kullanın: cheap-backup
```

**Sonuç:** Abonelik → Ucuz → En ucuz → Ücretsiz

---

## Maliyet Optimizasyonu

### Strateji 1: Günlük Sıfırlama Rutini

```
Sabah (10AM): Taze GLM kotası
→ Yoğun görevler için GLM kullanın
→ Abonelik kotasını koruyun

Öğleden sonra: Abonelik kotası
→ Karmaşık görevler için Claude/Codex kullanın

Akşam: MiniMax (5 saatlik sıfırlama)
→ Geç saatteki işler için ucuz yedek

Gece: Ücretsiz katman (iFlow)
→ Sıfır maliyetli acil durum yedeği
```

### Strateji 2: Önce Bütçe

```
Aylık bütçe belirleyin: $20

Dağılım:
- $9 Kimi K2 (10M token sabit)
- $6 GLM günlük kota (10M token)
- $5 MiniMax taşma (25M token)

Total: $20'ye 45M token
vs ChatGPT API'de $20'ye 1M token!
```

### Strateji 3: Önce Abonelikleri En Üst Düzeye Çıkarın

```
Öncelik:
1. Gemini CLI (Ayda 180K ÜCRETSİZ)
2. Claude Code (zaten ödediğiniz abonelik)
3. GLM-4.7 (ucuz yedek, $0.6/1M)
4. MiniMax M2.1 (en ucuz, $0.2/1M)
5. iFlow (ÜCRETSİZ acil durum)

Aylık maliyet örneği (100M token):
- 60M Gemini CLI ile: $0 (ücretsiz)
- 30M Claude Code ile: $0 (abonelik)
- 8M GLM ile: $4.80
- 2M MiniMax ile: $0.40
Total: $5.20/ay!
```

---

## Gerçek Dünya Örnekleri

### Örnek 1: Yoğun Kodlama Ayı (100M token)

```
Dağılım:
- 60M abonelik ile (Claude/Codex): $0 ek
- 30M GLM-4.7 ile: $18
- 10M MiniMax M2.1 ile: $2

Total: $20/ay
vs ChatGPT API'de $2000!

Tasarruf: %99 daha ucuz!
```

### Örnek 2: Bütçeli Geliştirici ($10/ay)

```
Strateji:
- $9 Kimi K2 (10M token)
- $1 MiniMax taşma (5M token)

Total: $10'a 15M token
vs ChatGPT API'de $10'a 0.5M token!

30× daha fazla token!
```

### Örnek 3: Serbest Çalışan (Değişken Kullanım)

```
Hafif ay (20M token):
- 15M abonelik ile: $0
- 5M GLM ile: $3
Total: $3

Yoğun ay (150M token):
- 60M abonelik ile: $0
- 60M GLM ile: $36
- 30M MiniMax ile: $6
Total: $42

Ortalama: $22.50/ay
vs ChatGPT API'de $3400!
```

---

## En İyi Uygulamalar

### 1. Günlük Kotayı İzleyin

```
Panel şunu gösterir:
- GLM kotası: %75 kullanıldı (6 saat içinde sıfırlanır)
- MiniMax kotası: %50 kullanıldı (2 saat içinde sıfırlanır)
- Kimi kotası: 8M/10M kullanıldı (15 gün içinde sıfırlanır)

Yoğun görevlerinizi sıfırlama zamanlarına göre planlayın!
```

### 2. Coding Plan Kullanın (GLM)

```
Standard: 1× kota
Coding Plan: 3× kota (aynı fiyat!)

→ Her zaman Coding Plan seçin
```

### 3. Ücretsiz Katmanla Birleştirin

```
Kombo:
1. gc/gemini-3-flash (ÜCRETSİZ birincil)
2. glm/glm-4.7 (ucuz yedek)
3. minimax/MiniMax-M2.1 (en ucuz)
4. if/kimi-k2-thinking (ÜCRETSİZ acil durum)

Sonuç: Maliyetleri en aza indirin, çalışma süresini en üst düzeye çıkarın
```

### 4. Bütçe Uyarıları Kurun

```
Dashboard → Settings → Budget Alerts

Günlük: $2 sınır
Haftalık: $10 sınır
Aylık: $30 sınır

→ Sınıra ulaşıldığında ücretsiz katmana otomatik geçiş
```

---

## Sorun Giderme

### "Kota tükendi"

**Çözüm:**
- GLM: 10:00 AM Pekin saatini bekleyin
- MiniMax: İlk kullanımdan itibaren 5 saat bekleyin
- Kimi: Önümüzdeki ayın 1'ini bekleyin
- Ücretsiz katmana kombo yedek geçişi kullanın

### "API anahtarı geçersiz"

**Çözüm:**
- API anahtarının doğru kopyalandığını kontrol edin
- Hesabınızda kredi olduğunu doğrulayın
- Gerekirse API anahtarını yeniden oluşturun

### "Maliyetler yüksek"

**Çözüm:**
- Paneldeki kullanım istatistiklerini kontrol edin
- Bütçe uyarıları kurun
- MiniMax'e geçin ($0.2/1M en ucuz)
- Kritik olmayan görevler için ücretsiz katmanı kullanın

---

## Sonraki Adımlar

- **Ücretsiz yedek geçiş ekleyin:** [Ücretsiz Sağlayıcılar](./free.md)
- **Abonelikleri kurun:** [Abonelik Sağlayıcıları](./subscription.md)
- **Kombo oluşturun:** Dashboard → Combos → Create New
