# Akıllı Yönlendirme ve Otomatik Yedek Geçiş

9Router, isteklerinizi 3 katmanlı yedek geçiş (fallback) sistemiyle kullanılabilir en iyi sağlayıcı üzerinden otomatik yönlendirir. Kota sınırları veya hız sınırı yüzünden kodlamayı asla bırakmayın.

---

## Nasıl Çalışır

9Router; mevcut aboneliklerinizden maksimum değeri almak, maliyetleri en aza indirmek ve 7/24 kullanılabilirlik sağlamak için akıllı yönlendirme kullanır:

```
İstek → 9Router → Katman 1'i Kontrol Et (Abonelik)
                     ↓ kota tükendi
                     Katman 2'yi Kontrol Et (Ucuz)
                     ↓ bütçe sınırı
                     Katman 3'ü Kontrol Et (Ücretsiz)
                     ↓
                     Yanıt
```

### 3 Katmanlı Yedek Geçiş Sistemi

**Katman 1: ABONELİK (Birincil)**
- Claude Code (Pro/Max)
- OpenAI Codex (Plus/Pro)
- Gemini CLI (ÜCRETSİZ 180K/ay)
- GitHub Copilot
- Antigravity (Google)

**Amaç**: Zaten ödediğiniz aboneliklerden maksimum değeri almak.

**Katman 2: UCUZ (Yedek)**
- GLM-4.7 ($0.60/1M giriş)
- MiniMax M2.1 ($0.20/1M giriş)
- Kimi K2 ($9/ay sabit)

**Amaç**: Abonelik kotası tükendiğinde ultra ucuz yedek (ChatGPT API'ye kıyasla ~%90 daha ucuz).

**Katman 3: ÜCRETSİZ (Acil Durum)**
- iFlow (8 model)
- Qwen (3 model)
- Kiro (Claude ÜCRETSİZ)

**Amaç**: Sınırsız kodlama için sıfır maliyetli yedek geçiş.

---

## Otomatik Geçiş

9Router kotayı gerçek zamanlı izler ve sağlayıcıları otomatik değiştirir:

### Senaryo 1: Abonelik Kotası Tükendi

```
Kullanıcı isteği → cc/claude-opus-4-5
               ↓ kota tükendi (5 saatlik sınır doldu)
               Otomatik geçiş → glm/glm-4.7
               ↓ günlük kota tükendi
               Otomatik geçiş → minimax/MiniMax-M2.1
               ↓ 5 saatlik kota tükendi
               Otomatik geçiş → if/kimi-k2-thinking (ÜCRETSİZ)
               ↓
               Yanıt iletildi ✅
```

**Sonuç**: Sıfır kesinti, sorunsuz deneyim.

### Senaryo 2: Hız Sınırlaması

```
Kullanıcı isteği → cx/gpt-5.2-codex
               ↓ hız sınırına takıldı (çok fazla istek)
               Otomatik geçiş → glm/glm-4.7
               ↓
               Yanıt iletildi ✅
```

### Senaryo 3: Sağlayıcı Kullanılamıyor

```
Kullanıcı isteği → cc/claude-opus-4-5
               ↓ sağlayıcı hatası (503)
               Otomatik geçiş → sıradaki kullanılabilir model
               ↓
               Yanıt iletildi ✅
```

---

## Model Seçim Mantığı

9Router en iyi modeli şunlara göre seçer:

1. **Kalan kota** - Sağlayıcının kalan kotası olup olmadığını kontrol edin
2. **Maliyet katmanı** - Abonelik → ucuz → ücretsiz sırasını tercih edin
3. **Sıfırlama zamanı** - Kotanın ne zaman sıfırlandığını göz önünde bulundurun
4. **Sağlayıcı sağlığı** - Hata veren sağlayıcıları atlayın

### Öncelik Sırası Örneği

`cc/claude-opus-4-5` isteği için:

```
1. Claude Code kotasını kontrol et
   ✅ Kullanılabilir → cc/claude-opus-4-5 kullan
   ❌ Tükendi → 2. adıma geç

2. Yedek geçiş katmanını kontrol et (yapılandırıldıysa)
   ✅ GLM kotası kullanılabilir → glm/glm-4.7 kullan
   ❌ Tükendi → 3. adıma geç

3. Ücretsiz katmanı kontrol et
   ✅ iFlow kullanılabilir → if/kimi-k2-thinking kullan
   ❌ Hepsi tükendi → Kota hatası döndür
```

---

## Yapılandırma Seçenekleri

### Panel Ayarları

**1. Otomatik Yedek Geçişi Açın/Kapatın**

```
Dashboard → Settings → Smart Routing
→ "Auto Fallback" anahtarını ON/OFF yap
```

- **ON** (varsayılan): Otomatik katman geçişi
- **OFF**: Katı mod, birincil model kullanılamıyorsa hata döndürür

**2. Bütçe Sınırları Belirleyin**

```
Dashboard → Settings → Budget Control
→ Günlük sınır: $5
→ Aylık sınır: $50
```

Bütçeye ulaşıldığında 9Router otomatik olarak ücretsiz katmana geçer.

**3. Yedek Geçiş Sırasını Yapılandırın**

```
Dashboard → Settings → Fallback Priority
→ Her katmanda sağlayıcıları sürükleyerek yeniden sıralayın
```

Örnek özel sıralama:
```
Katman 1: Gemini CLI → Claude Code → Codex
Katman 2: MiniMax → GLM → Kimi
Katman 3: iFlow → Kiro → Qwen
```

**4. Kota Sıfırlama Bildirimleri**

```
Dashboard → Settings → Notifications
→ Kota sıfırlandığında e-posta gönder
→ Kota %80 kullanıldığında uyarı ver
```

---

## Örnekler

### Örnek 1: Temel Otomatik Yedek Geçiş

**Kurulum:**
```
Model: cc/claude-opus-4-5-20251101
Fallback: Auto (varsayılan 3 katman)
```

**Davranış:**
```
Sabah (taze kota):
  İstek → cc/claude-opus-4-5 ✅

Öğleden sonra (kota tükendi):
  İstek → glm/glm-4.7 ✅ (otomatik geçiş)

Akşam (GLM kotası bitti):
  İstek → minimax/MiniMax-M2.1 ✅ (otomatik geçiş)

Gece geç saatte (tüm ücretli kotalar bitti):
  İstek → if/kimi-k2-thinking ✅ (ücretsiz katman)
```

**Maliyet**: ~$5-10/ay ek (büyük ölçüde abonelikle karşılanır).

### Örnek 2: Bütçe Odaklı Yönlendirme

**Kurulum:**
```
Dashboard → Settings:
  Günlük bütçe: $2
  Aylık bütçe: $20
  Fallback: Enabled
```

**Davranış:**
```
Gün 1-15 (bütçe dahilinde):
  İstekler → glm/glm-4.7 (ucuz katman)
  Maliyet: $1.50/gün

Gün 16 (bütçeye ulaşıldı):
  İstekler → if/kimi-k2-thinking (ücretsiz katman)
  Maliyet: $0

Sonraki ay (bütçe sıfırlanır):
  İstekler → yine glm/glm-4.7
```

**Sonuç**: Ayda $20 asla aşılmaz, her zaman kullanılabilir.

### Örnek 3: Yalnızca Abonelik Modu

**Kurulum:**
```
Dashboard → Settings:
  Auto Fallback: OFF
  Strict mode: ON
```

**Davranış:**
```
İstek → cc/claude-opus-4-5
  ✅ Kota kullanılabilir → Başarılı
  ❌ Kota tükendi → Hata döndür (yedek geçiş yok)
```

**Kullanım senaryosu**: Yalnızca ücretli abonelikleri kullanmak istediğinizde, ek maliyet yok.

### Örnek 4: Yalnızca Ücretsiz Mod

**Kurulum:**
```
Model: if/kimi-k2-thinking
Fallback: qw/qwen3-coder-plus → kr/claude-sonnet-4.5
```

**Davranış:**
```
Tüm istekler → Yalnızca ücretsiz katman
Maliyet: $0 sonsuza kadar
```

**Kullanım senaryosu**: Kişisel projeler, öğrenme, deneme.

---

## En İyi Uygulamalar

### 1. Abonelik Değerini Maksimize Edin

```
Strateji:
- Abonelik modellerini Katman 1 olarak ayarlayın
- Panelde kota kullanımını izleyin
- Ucuz katmanı yalnızca abonelik tükendiğinde kullanın
```

**Örnek kombo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → if/kimi-k2-thinking
```

### 2. Maliyeti Optimize Edin

```
Strateji:
- Önce Gemini CLI ücretsiz katmanını kullanın (180K/ay)
- Yedek olarak GLM/MiniMax (ultra ucuz)
- Acil durum: iFlow (ücretsiz)
```

**Örnek kombo:**
```
gc/gemini-3-flash-preview → glm/glm-4.7 → if/kimi-k2-thinking
```

### 3. Kaliteyi Optimize Edin

```
Strateji:
- En iyi modelleri kullanın (Claude Opus, GPT-5.2)
- Yedek olarak iyi ve ucuz modeller (GLM-4.7)
- Son çare: Ücretsiz katman
```

**Örnek kombo:**
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → glm/glm-4.7
```

### 4. 7/24 Kullanılabilirlik

```
Strateji:
- Yedek geçişe her zaman ücretsiz katmanı ekleyin
- Kota sıfırlama zamanlarını izleyin
- Kullanımı sağlayıcılara dağıtın
```

**Örnek kombo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

**Sonuç**: Kota asla tükenmez, her an kodlayın.

---

## Kota Sıfırlama Stratejisi

Kullanımınızı kota sıfırlama zamanlarına göre planlayın:

| Sağlayıcı | Kota Sıfırlama | Strateji |
|----------|-------------|----------|
| **Claude Code** | 5 saatlik + haftalık | Sabah kullanın, kota taze |
| **Codex** | 5 saatlik + haftalık | Claude kotası bitince kullanın |
| **Gemini CLI** | Günlük (1K) + Aylık (180K) | Gün boyu kullanın |
| **GLM-4.7** | Her gün 10:00 | Akşam kullanın, ertesi sabah sıfırlanır |
| **MiniMax M2.1** | 5 saatlik kayan pencere | Her zaman kullanın, kayan pencereyi izler |
| **iFlow/Qwen/Kiro** | Sınır yok | Acil durum yedeği |

**Günlük rutin örneği:**
```
08:00 - 13:00: Claude Code (taze 5 saatlik kota)
13:00 - 18:00: Gemini CLI (1K/gün kota)
18:00 - 22:00: GLM-4.7 (ucuz, 10:00'da sıfırlanır)
22:00 - 08:00: MiniMax veya iFlow (5 saatlik kayan pencere veya ücretsiz)
```

---

## İzleme ve Uyarılar

### Panel Kota Takibi

```
Dashboard → Quota Overview:
  Claude Code: 2.5h / 5h kaldı (%50)
  Gemini CLI: bugün 450 / 1000 istek
  GLM-4.7: 5M / 10M token (8 saat içinde sıfırlanır)
  MiniMax: 3M / 5M token (5 saatlik kayan pencere)
```

### Gerçek Zamanlı Bildirimler

```
Dashboard → Notifications:
  ⚠️ Claude Code kotası %80 kullanıldı (1 saat kaldı)
  ✅ GLM-4.7 kotası sıfırlandı (10M token mevcut)
  💰 Günlük bütçe %50 kullanıldı ($2.50 / $5)
```

### Kullanım Analitiği

```
Dashboard → Analytics:
  Bugün: 50M token
    - 30M Claude Code üzerinden (abonelik)
    - 15M GLM-4.7 üzerinden ($9)
    - 5M iFlow üzerinden (ücretsiz)
  
  Maliyet: $9 (ChatGPT API'deki $1000'a kıyasla)
  Tasarruf: %99
```

---

## Sorun Giderme

**Sorun: "All providers quota exhausted"**

**Çözüm:**
1. Paneldeki kota takibini kontrol edin
2. Kota sıfırlanana kadar bekleyin (geri sayıma bakın)
3. Yedek geçiş zincirine ücretsiz katmanı ekleyin
4. Veya bütçe sınırını artırın

**Sorun: "Too many fallback switches"**

**Çözüm:**
1. Birincil sağlayıcının kapalı olup olmadığını kontrol edin
2. Kota sınırlarını artırın (aboneliği yükseltin)
3. Daha ucuz bir birincil model kullanın (Claude yerine GLM)

**Sorun: "Unexpected costs"**

**Çözüm:**
1. Dashboard → Analytics → Kullanımı inceleyin
2. Günlük/aylık bütçe sınırları belirleyin
3. Kritik olmayan görevler için ücretsiz katmana geçin
4. Ücretsiz yedek geçişli kombolar kullanın

---

## İlgili

- [Kombolar](./combos.md) - Özel yedek geçiş zincirleri oluşturun
- [Kota Takibi](./quota-tracking.md) - Kullanımı ve maliyetleri izleyin
