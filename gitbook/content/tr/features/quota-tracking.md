# Kota Takibi ve Kullanım İzleme

Gerçek zamanlı token tüketimini izleyin, kota sınırlarını takip edin, maliyetleri tahmin edin ve tükenmeden önce uyarı alın. Abonelik kotasını boşa harcamayın, bütçe sınırlarını aşmayın.

---

## Genel Bakış

9Router tüm sağlayıcılar için kapsamlı kota takibi sunar:

- **Gerçek zamanlı token tüketimi** - İstek başına kullanılan tokenları görün
- **Kota sınırları ve kalan** - Kullanımı sınırlarla karşılaştırın
- **Sıfırlama geri sayımı** - Kotanın ne zaman yenileneceğini görün
- **Maliyet tahmini** - Ücretli katmanlar için harcamayı hesaplayın
- **Aylık raporlar** - Kullanım desenlerini analiz edin
- **Uyarılar ve bildirimler** - Sınırlara ulaşmadan uyarı alın

---

## Panele Genel Bakış

### Kota Özeti

```
Dashboard → Home → Quota Overview

┌─────────────────────────────────────────────┐
│ Claude Code (cc/)                           │
│ ████████████░░░░░░░░ 2.5h / 5h (%50)       │
│ Sıfırlanma: 2h 30m                          │
│ Maliyet: $0 (abonelik)                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Gemini CLI (gc/)                            │
│ ████████░░░░░░░░░░░░ 450 / 1000 (%45)      │
│ Günlük sıfırlama: 18h 30m                   │
│ Aylık: 45K / 180K (%25)                     │
│ Maliyet: $0 (ücretsiz katman)               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ GLM-4.7 (glm/)                              │
│ ██████████████░░░░░░ 7M / 10M tokens (%70)  │
│ Sıfırlama: Günlük 10:00 AM (5h 35m sonra)  │
│ Bugünkü maliyet: $4.20                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ MiniMax M2.1 (minimax/)                     │
│ ████████████████░░░░ 4M / 5M tokens (%80)   │
│ 5 saatlik kayan pencere                     │
│ Maliyet (5h): $0.80                         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ iFlow (if/)                                 │
│ ████████████████████ Sınırsız               │
│ Maliyet: $0 (sonsuza dek ücretsiz)          │
└─────────────────────────────────────────────┘
```

---

## Gerçek Zamanlı Token Tüketimi

### İstek Bazında Takip

Her istek ayrıntılı token kullanımını gösterir:

```
Dashboard → Activity → Recent Requests

Request #1234
Model: cc/claude-opus-4-5-20251101
Timestamp: 2026-02-04 04:15:32

Tokens:
  Input: 1,250 tokens
  Output: 850 tokens
  Total: 2,100 tokens

Maliyet: $0 (abonelik kotası)
Süre: 3.2s
Durum: ✅ Başarılı
```

### Canlı Kullanım İzleyici

```
Dashboard → Live Monitor

Şu anki istek:
  Model: glm/glm-4.7
  Aktarılan token: 450 / ~800 tahmini
  Şu ana kadarki maliyet: $0.0009
  Süre: 1.8s
```

### Model Bazında Token Dağılımı

```
Dashboard → Analytics → Token Usage

Bugün (Feb 4, 2026):
  cc/claude-opus-4-5: 15M tokens ($0, abonelik)
  glm/glm-4.7: 8M tokens ($4.80)
  if/kimi-k2-thinking: 3M tokens ($0, ücretsiz)
  
Total: 26M tokens
Maliyet: $4.80
```

---

## Kota Sınırları ve Sıfırlama Zamanları

### Abonelik Sağlayıcıları

**Claude Code (Pro/Max)**
```
Kota türü: Zamana dayalı (5 saatlik kayan)
Sınır: 5 saatlik kullanım
Sıfırlama: 5 saatlik kayan pencere + Haftalık yenilenme
İzleme: Model başına kullanım süresi

Panelde görünen:
  Opus: 2.5h / 5h kullanıldı
  Sonnet: 1.2h / 5h kullanıldı
  Haiku: 0.8h / 5h kullanıldı
  
Haftalık sıfırlama: Her Pazartesi 00:00 UTC
```

**OpenAI Codex (Plus/Pro)**
```
Kota türü: Zamana dayalı (5 saatlik kayan)
Sınır: 5 saat (Plus) / 10 saat (Pro)
Sıfırlama: 5 saatlik kayan pencere + Haftalık yenilenme

Panelde görünen:
  GPT-5.2 Codex: 3.5h / 5h kullanıldı
  Sıfırlanma: 1h 30m
```

**Gemini CLI (ÜCRETSİZ)**
```
Kota türü: İstek sayısı + Aylık token
Günlük sınır: 1,000 istek
Aylık sınır: 180,000 tamamlama
Sıfırlama: Günlük 00:00 UTC + Her ayın 1'i

Panelde görünen:
  Bugün: 450 / 1,000 istek (%45)
  Bu ay: 45K / 180K tamamlama (%25)
  Günlük sıfırlama: 18h 30m
  Aylık sıfırlama: 26 gün
```

**GitHub Copilot**
```
Kota türü: Aylık kullanım
Sınır: Plana göre değişir
Sıfırlama: Her ayın 1'i

Panelde görünen:
  Kullanım: aylık kotanın %60'ı
  Sıfırlanma: March 1, 2026 (25 gün sonra)
```

### Ucuz Sağlayıcılar

**GLM-4.7**
```
Kota türü: Günlük token sınırı
Sınır: 10M token/gün (Coding Plan)
Sıfırlama: Günlük 10:00 AM Pekin saati (UTC+8)

Panelde görünen:
  Kullanılan: 7M / 10M token (%70)
  Kalan: 3M token
  Sıfırlanma: 5h 35m
  Bugünkü maliyet: $4.20
```

**MiniMax M2.1**
```
Kota türü: 5 saatlik kayan pencere
Sınır: 5 saatte 5M token
Sıfırlama: Sürekli kayan pencere

Panelde görünen:
  Kullanılan (5h): 4M / 5M token (%80)
  En eski kullanımın süresi doluyor: 45m
  Maliyet (5h): $0.80
```

**Kimi K2**
```
Kota türü: Aylık abonelik
Sınır: 10M token/ay ($9 sabit)
Sıfırlama: Abonelik tarihinde aylık

Panelde görünen:
  Kullanılan: 6M / 10M token (%60)
  Sıfırlanma: Feb 15, 2026 (11 gün sonra)
  Maliyet: $9/ay (peşin ödendi)
```

### Ücretsiz Sağlayıcılar

**iFlow / Qwen / Kiro**
```
Kota türü: Sınırsız (hız sınırlı)
Sınır: Katı sınır yok
Sıfırlama: N/A

Panelde görünen:
  Bugün kullanılan: 5M token
  Maliyet: $0 (sonsuza dek ücretsiz)
  Durum: ✅ Kullanılabilir
```

---

## Maliyet Tahmini

### Gerçek Zamanlı Maliyet Takibi

```
Dashboard → Costs → Today

Abonelik sağlayıcıları: $0
  Claude Code: 15M tokens ($0, dahil)
  Gemini CLI: 3M tokens ($0, ücretsiz katman)

Ücretli sağlayıcılar: $4.80
  GLM-4.7: 8M tokens ($4.80)
    Input: 6M × $0.60/1M = $3.60
    Output: 2M × $2.20/1M = $4.40
    Total: $4.80

Ücretsiz sağlayıcılar: $0
  iFlow: 3M tokens ($0)

Bugün toplam: $4.80
```

### Aylık Harcama Raporu

```
Dashboard → Costs → This Month (February 2026)

1. Hafta (Feb 1-7):
  Abonelik: $0 (80M tokens)
  Ücretli: $15.20 (25M tokens)
  Ücretsiz: $0 (10M tokens)
  Total: $15.20

2. Hafta (Feb 8-14):
  Abonelik: $0 (75M tokens)
  Ücretli: $12.80 (20M tokens)
  Ücretsiz: $0 (8M tokens)
  Total: $12.80

Ayın başından bugüne: $28.00
Tahmini (30 gün): ~$120

Sağlayıcıya göre dağılım:
  GLM-4.7: $22.00 (%78)
  MiniMax M2.1: $6.00 (%22)
  
1M token başına ortalama maliyet: $0.62
ChatGPT API'ye kıyasla tasarruf: %97 ($4,000 → $120)
```

### Maliyet Projeksiyonu

```
Dashboard → Costs → Projections

Son 7 günün kullanımına göre:
  Günlük ortalama: 50M tokens
  Günlük maliyet: $4.50

Aylık projeksiyon:
  Tokens: 1,500M (1.5B)
  Maliyet: $135
  
Dağılım:
  Abonelik: 900M tokens ($0)
  GLM-4.7: 450M tokens ($90)
  MiniMax: 120M tokens ($24)
  Ücretsiz: 30M tokens ($0)

Bütçe durumu:
  Günlük sınır: $5 → bugün %90 kullanıldı
  Aylık sınır: $150 → %90 projeksiyon
  ⚠️ Uyarı: Aylık bütçe aşılabilir
```

---

## Kullanım Paneli

### Genel İstatistikler

```
Dashboard → Analytics → Overview

Bugün (Feb 4, 2026):
  İstekler: 1,234
  Tokens: 26M
  Maliyet: $4.80
  Ort. yanıt süresi: 2.1s

Bu hafta:
  İstekler: 8,456
  Tokens: 180M
  Maliyet: $28.00
  Başarı oranı: %99.2

Bu ay:
  İstekler: 15,234
  Tokens: 320M
  Maliyet: $52.00
  En çok kullanılan model: cc/claude-opus-4-5 (%45)
```

### Model Bazında Kullanım

```
Dashboard → Analytics → Models

En çok kullanılan modeller (bu ay):
1. cc/claude-opus-4-5: 145M tokens (%45)
2. glm/glm-4.7: 95M tokens (%30)
3. if/kimi-k2-thinking: 50M tokens (%16)
4. minimax/MiniMax-M2.1: 20M tokens (%6)
5. gc/gemini-3-flash: 10M tokens (%3)

Maliyet dağılımı:
  cc/claude-opus: $0 (abonelik)
  glm/glm-4.7: $45.00
  if/kimi-k2-thinking: $0 (ücretsiz)
  minimax/MiniMax-M2.1: $7.00
  gc/gemini-3-flash: $0 (ücretsiz)
```

### Zamana Göre Kullanım

```
Dashboard → Analytics → Timeline

Saatlik kullanım (bugün):
00:00 - 01:00: 0.5M tokens
01:00 - 02:00: 0.2M tokens
...
08:00 - 09:00: 3.2M tokens (zirve)
09:00 - 10:00: 2.8M tokens
...
23:00 - 00:00: 0.8M tokens

Yoğun saatler: 08:00 - 12:00 (sabah kodlaması)
Sakin saatler: 00:00 - 06:00 (gece)
```

### Kombo Bazında Kullanım

```
Dashboard → Analytics → Combos

premium-coding:
  İstekler: 456
  Tokens: 12M
  Maliyet: $2.40
  
  Dağılım:
    cc/claude-opus: 8M tokens (%67, $0)
    glm/glm-4.7: 3M tokens (%25, $1.80)
    minimax/MiniMax-M2.1: 1M tokens (%8, $0.20)

budget-combo:
  İstekler: 234
  Tokens: 6M
  Maliyet: $1.20
  
  Dağılım:
    glm/glm-4.7: 4M tokens (%67, $2.40)
    if/kimi-k2-thinking: 2M tokens (%33, $0)
```

---

## Uyarılar ve Bildirimler

### Kota Uyarıları

```
Dashboard → Settings → Alerts

Kota uyarıları:
  ✅ Kota kullanımı %80 olduğunda uyar
  ✅ Kota kullanımı %90 olduğunda uyar
  ✅ Kota tükendiğinde uyar
  ✅ Kota sıfırlandığında bildir

Teslimat:
  ✅ Panel bildirimi
  ✅ Email (opsiyonel)
  ✅ Webhook (opsiyonel)
```

**Örnek bildirimler:**
```
⚠️ Claude Code kotası %80 kullanıldı
   2.5h kaldı (1h 30m sonra sıfırlanır)
   
⚠️ GLM-4.7 kotası %90 kullanıldı
   1M token kaldı (5h sonra sıfırlanır)
   
✅ Gemini CLI kotası sıfırlandı
   1,000 istek kullanılabilir (günlük sınır)
```

### Bütçe Uyarıları

```
Dashboard → Settings → Budget Alerts

Günlük bütçe: $5
  ✅ %80'de uyar ($4)
  ✅ %100'de uyar ($5)
  ✅ Aşıldığında ücretsiz katmana otomatik geç

Aylık bütçe: $150
  ✅ %50'de uyar ($75)
  ✅ %80'de uyar ($120)
  ✅ %100'de uyar ($150)
```

**Örnek bildirimler:**
```
⚠️ Günlük bütçenin %80'i kullanıldı
   Bugün $4.00 / $5.00 harcandı
   
⚠️ Aylık bütçenin %50'sine ulaşıldı
   Bu ay $75 / $150 harcandı
   Projeksiyon: $135 (bütçe içinde)
   
🚨 Günlük bütçe aşıldı
   Bugün $5.20 / $5.00 harcandı
   Ücretsiz katmana otomatik geçildi
```

### Maliyet Anormalliği Tespiti

```
Dashboard → Settings → Anomaly Detection

✅ Olağandışı harcama desenlerini algıla
✅ Maliyet artışlarında uyar (>2× günlük ortalama)
✅ Kota tükenme desenlerinde uyar

Örnek uyarı:
⚠️ Maliyet artışı tespit edildi
   Bugün: $12.50 (günlük ortalamanın 2.5 katı)
   Neden: Yüksek GLM-4.7 kullanımı (20M tokens)
   Öneri: Birincil modellerin kotası tükenmiş olabilir, kontrol edin
```

---

## En İyi Uygulamalar

### 1. Kotayı Günlük İzleyin

```
Günlük rutin:
1. Panel kota özetini kontrol edin (30 saniye)
2. Sıfırlama zamanlarını gözden geçirin
3. Kullanımı kota durumuna göre planlayın
```

**Örnek:**
```
Sabah kontrolü:
  ✅ Claude Code: 5h kullanılabilir (yeni sıfırlandı)
  ✅ Gemini CLI: 1K istek kullanılabilir
  ⚠️ GLM-4.7: 2M token kaldı (10AM sıfırlanır)
  
Eylem: Sabah işleri için Claude Code kullanın
```

### 2. Bütçe Sınırları Belirleyin

```
Dashboard → Settings → Budget:
  Günlük: $5 (aşırı harcamayı önler)
  Aylık: $150 (bütçeyle uyumlu)
```

**Sonuç**: Sınıra ulaşıldığında ücretsiz katmana otomatik geçilir.

### 3. Kombo Kullanımını Optimize Edin

```
Dashboard → Analytics → Combos:
  Hangi modellerin en çok kullanıldığını inceleyin
  Maliyetleri en aza indirmek için kombo sırasını ayarlayın
```

**Örnek:**
```
Mevcut: cc/claude-opus → glm/glm-4.7
  %80 Claude üzerinden (iyi)
  %20 GLM üzerinden (aylık $12)

Optimize: gc/gemini-3-flash → cc/claude-opus → glm/glm-4.7
  %50 Gemini üzerinden (ücretsiz)
  %40 Claude üzerinden (abonelik)
  %10 GLM üzerinden (aylık $6)
  
Tasarruf: aylık $6
```

### 4. Sıfırlama Zamanlarını Takip Edin

```
Dashboard → Quota → Reset Schedule:
  Claude Code: 5h kayan + Haftalık Pazartesi
  Gemini CLI: Günlük 00:00 UTC + Her ayın 1'i
  GLM-4.7: Günlük 10:00 AM Pekin saati
  MiniMax: 5h kayan pencere
```

**Strateji**: Kota yeni sıfırlanmışken sağlayıcıları kullanın.

### 5. Aylık Raporları İnceleyin

```
Dashboard → Analytics → Monthly Report:
  Toplam token: 1.5B
  Toplam maliyet: $120
  Tasarruf: ChatGPT API'ye kıyasla %97
  
Analiz:
  - Kullanımın %60'ı abonelikler üzerinden ($0)
  - %30'u GLM üzerinden ($90)
  - %10'u ücretsiz katman üzerinden ($0)
  
Optimizasyon:
  - Gemini CLI kullanımını artırın (ücretsiz)
  - GLM kullanımını azaltın (pahalı)
```

---

## API Erişimi

### Kota Durumunu Alma

```bash
GET http://localhost:20128/api/quota
Authorization: Bearer your-api-key

Response:
{
  "providers": [
    {
      "id": "cc",
      "name": "Claude Code",
      "quota": {
        "used": 2.5,
        "limit": 5,
        "unit": "hours",
        "percentage": 50
      },
      "reset": {
        "type": "rolling",
        "window": "5h",
        "nextReset": "2026-02-04T06:45:00Z"
      },
      "cost": {
        "today": 0,
        "month": 0,
        "currency": "USD"
      }
    },
    {
      "id": "glm",
      "name": "GLM-4.7",
      "quota": {
        "used": 7000000,
        "limit": 10000000,
        "unit": "tokens",
        "percentage": 70
      },
      "reset": {
        "type": "daily",
        "time": "10:00 AM UTC+8",
        "nextReset": "2026-02-04T10:00:00+08:00"
      },
      "cost": {
        "today": 4.20,
        "month": 52.00,
        "currency": "USD"
      }
    }
  ]
}
```

### Kullanım İstatistiklerini Alma

```bash
GET http://localhost:20128/api/usage?period=today
Authorization: Bearer your-api-key

Response:
{
  "period": "today",
  "date": "2026-02-04",
  "summary": {
    "requests": 1234,
    "tokens": 26000000,
    "cost": 4.80
  },
  "byModel": [
    {
      "model": "cc/claude-opus-4-5",
      "requests": 456,
      "tokens": 15000000,
      "cost": 0
    },
    {
      "model": "glm/glm-4.7",
      "requests": 234,
      "tokens": 8000000,
      "cost": 4.80
    }
  ]
}
```

---

## Sorun Giderme

**Sorun: Kota %0 görünüyor ama istekler başarısız**

**Çözüm:**
1. Sağlayıcı bağlantısını kontrol edin (Dashboard → Providers)
2. API anahtarlarının geçerli olduğunu doğrulayın
3. Sağlayıcı kapalı mı kontrol edin (durum sayfası)
4. OAuth sağlayıcılarını yeniden bağlamayı deneyin

**Sorun: Maliyet tahmini yanlış**

**Çözüm:**
1. Dashboard → Settings → Pricing
2. Sağlayıcı başına fiyatlandırmanın güncel tarifelerle eşleştiğini doğrulayın
3. Sağlayıcı tarifeleri değiştiyse fiyatlandırmayı güncelleyin
4. Tutarsızlık devam ederse destek ekibiyle iletişime geçin

**Sorun: Sıfırlama zamanı güncellenmiyor**

**Çözüm:**
1. Paneli yenileyin (F5)
2. Sistem saatini kontrol edin
3. Saat dilimi ayarlarını doğrulayın
4. Sorun sürerse 9Router'ı yeniden başlatın

**Sorun: Uyarılar alınmıyor**

**Çözüm:**
1. Dashboard → Settings → Alerts
2. Email adresinin doğru olduğunu doğrulayın
3. Spam klasörünü kontrol edin
4. Bildirimi test edin (Send Test düğmesi)

---

## İlgili

- [Akıllı Yönlendirme](./smart-routing.md) - Kotaya göre otomatik yedek geçiş (fallback)
- [Kombolar](./combos.md) - Özel yedek geçiş zincirleri oluşturun
