# Kombolar - Özel Yedek Geçiş Zincirleri

Otomatik yedek geçiş (fallback) ile özel model kombinasyonları oluşturun. Kombolar; maliyet, kalite ve kullanılabilirliğe göre kendi yönlendirme stratejinizi tanımlamanızı sağlar.

---

## Kombolar Nedir?

Kombolar, panelde oluşturduğunuz **özel yedek geçiş zincirleridir**. Tek bir model kullanmak yerine, 9Router'ın sırayla denediği bir model dizisi tanımlarsınız.

**Örnek:**
```
Kombo adı: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (önce denenir)
  2. glm/glm-4.7 (#1'in kotası tükenirse)
  3. minimax/MiniMax-M2.1 (#2'nin kotası tükenirse)
```

**CLI'da kullanım:**
```
Model: premium-coding
```

9Router, biri başarılı olana kadar her modeli sırayla otomatik dener.

---

## Neden Kombo Kullanmalı?

### 1. Abonelik Değerini Maksimize Edin
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ Önce aboneliği kullanın, ucuz yedek, ücretsiz acil durum
→ Zaten ödediğiniz aboneliklerden tam değer alın
```

### 2. Maliyetleri Minimize Edin
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ En ucuz ücretli seçenekle başlayın ($0.60/1M)
→ Daha da ucuz seçeneğe geçin ($0.20/1M)
→ Acil durumda ücretsiz katman
→ Toplam maliyet: ~$5-10/ay (ChatGPT API'de $2000'a kıyasla)
```

### 3. 7/24 Kullanılabilirliği Sağlayın
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ Sona her zaman ücretsiz katmanı ekleyin
→ Kotanız asla tükenmesin
→ Her an, her yerde kodlayın
```

### 4. Kaliteyi Optimize Edin
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ Önce en iyi modeller
→ Diğer premium modellere yedek geçiş
→ Yedek geçiş zinciri boyunca yüksek kaliteyi koruyun
```

---

## Kombolar Nasıl Oluşturulur

### Adım 1: Paneli Açın

```
http://localhost:20128
→ Parolanızla giriş yapın
```

### Adım 2: Kombolar Bölümüne Gidin

```
Dashboard → Combos → Create New Combo
```

### Adım 3: Komboyu Yapılandırın

**Kombo Adı:**
```
premium-coding
```

**Açıklama (isteğe bağlı):**
```
Önce abonelik, ucuz yedek, ücretsiz acil durum
```

**Modelleri Seçin:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**Sürükleyerek yeniden sıralayın** - Öncelik yukarıdan aşağıya.

### Adım 4: Kaydedin

```
"Save Combo" düğmesine tıklayın
→ Kombo model listesinde görünür
```

### Adım 5: CLI'da Kullanın

```
Cursor/Cline/Herhangi bir araç:
  Model: premium-coding
```

---

## Cursor / Claude Varsayılan Komboları

Cursor ve Claude Code **öneksiz** model kimlikleri gönderir (`composer-2.5`, `claude-opus-5`, `opus`); 9Router ise sağlayıcı önekleriyle yönlendirme yapar (`cu/composer-2.5`, `cc/claude-opus-5`). Varsayılan kombo oluşturucuları bu boşluğu kapatır.

**Dashboard → Combos** sayfasında:

1. **Cursor Default** veya **Claude Default** düğmesine tıklayın
2. Önizlemeyi onaylayın (yeni ve mevcut adlar)
3. 9Router, her istemci model kimliği için eşleşen önekli rotaya sahip bir kombo oluşturur

**Örnekler:**

| Kombo adı (istemcinin gönderdiği) | Eklenen model (9Router'ın yönlendirdiği) |
|------------------------------------|------------------------------------|
| `composer-2.5` | `cu/composer-2.5` |
| `cursor-grok-4.6-high-fast` | `cu/cursor-grok-4.6-high-fast` |
| `claude-opus-5` | `cc/claude-opus-5` |
| `opus` | `cc/claude-opus-5` |

Mevcut kombo adları **atlanır** (üzerine yazılmaz). Oluşturulan komboları sonradan düzenleyerek yedek geçiş ekleyebilirsiniz. Yeni katalog kimliklerini almak için düğmeye daha sonra tekrar tıklayın.

> Bu kombolar, Cursor/Claude 9Router ile zaten konuşuyorsa (`/v1` veya `ANTHROPIC_BASE_URL`) ve kendi yerel model kimliklerini gönderiyorsa işe yarar. Cursor'ın yerleşik Models sekmesini kendi başlarına değiştirmezler.

---

## Örnek Kombolar

### Örnek 1: Premium Coding (Abonelik → Ucuz → Ücretsiz)

**Amaç**: Abonelik değerini maksimize etmek, ek maliyetleri minimize etmek.

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**Kullanım:**
```
Cursor IDE:
  Model: premium-coding
```

**Davranış:**
```
Sabah (taze kota):
  İstek → cc/claude-opus-4-5 ✅

Öğleden sonra (Claude kotası bitti):
  İstek → glm/glm-4.7 ✅ (otomatik geçiş)

Akşam (GLM kotası bitti):
  İstek → minimax/MiniMax-M2.1 ✅ (otomatik geçiş)
```

**Aylık maliyet (100M token):**
```
80M Claude Code üzerinden: $0 (abonelik)
15M GLM üzerinden: $9
5M MiniMax üzerinden: $1
Total: $10 + mevcut aboneliğiniz
```

**Tasarruf**: ChatGPT API'ye kıyasla ~%99 ($2000).

---

### Örnek 2: Bütçe Kombosu (Ucuz → Ücretsiz)

**Amaç**: Maliyetleri minimize etmek, ücretsiz katmanı yedek olarak kullanmak.

```
Dashboard → Combos → Create New

Name: budget-combo
Models:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**Kullanım:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**Davranış:**
```
İstek → glm/glm-4.7
  ✅ Günlük kota mevcut → GLM kullan ($0.60/1M)
  ❌ Kota tükendi → MiniMax dene ($0.20/1M)
  ❌ MiniMax kotası bitti → iFlow kullan (ÜCRETSİZ)
```

**Aylık maliyet (100M token):**
```
70M GLM üzerinden: $42
20M MiniMax üzerinden: $4
10M iFlow üzerinden: $0
Total: $46 (ChatGPT API'de $2000'a kıyasla)
```

**Tasarruf**: %97.

---

### Örnek 3: Ücretsiz Kombo (Sıfır Maliyet)

**Amaç**: %100 ücretsiz, hiç maliyet yok.

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**Kullanım:**
```
Claude Desktop:
  Model: free-combo
```

**Davranış:**
```
İstek → if/kimi-k2-thinking
  ✅ Kullanılabilir → iFlow kullan
  ❌ Hata → Qwen dene
  ❌ Hata → Kiro dene
```

**Aylık maliyet:**
```
Ücretsiz sağlayıcılar üzerinden 100M token: $0
Total: $0 sonsuza kadar
```

**Kullanım senaryosu**: Kişisel projeler, öğrenme, deneme.

---

### Örnek 4: Önce Kalite (Yalnızca Premium Modeller)

**Amaç**: En iyi kalite, ucuz yedek geçiş yok.

```
Dashboard → Combos → Create New

Name: quality-first
Models:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**Kullanım:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**Davranış:**
```
İstek → cc/claude-opus-4-5
  ❌ Kota bitti → cx/gpt-5.2-codex
  ❌ Kota bitti → gc/gemini-3-pro-preview
  ❌ Hepsi bitti → Hata döndür (ucuz yedek geçiş yok)
```

**Kullanım senaryosu**: Kritik üretim kodu, karmaşık refactoring.

---

### Örnek 5: Çoklu Abonelik (Tümünü Maksimize Edin)

**Amaç**: Ek ödeme yapmadan önce tüm abonelikleri kullanmak.

```
Dashboard → Combos → Create New

Name: multi-sub
Models:
  1. gc/gemini-3-flash-preview (ÜCRETSİZ 180K/ay)
  2. cc/claude-opus-4-5-20251101 (Pro abonelik)
  3. cx/gpt-5.2-codex (Plus abonelik)
  4. gh/gpt-5 (Copilot abonelik)
  5. glm/glm-4.7 (Ucuz yedek)
  6. if/kimi-k2-thinking (Ücretsiz acil durum)
```

**Aylık maliyet (200M token):**
```
50M Gemini CLI üzerinden: $0 (ücretsiz katman)
80M Claude Code üzerinden: $0 (abonelik)
40M Codex üzerinden: $0 (abonelik)
20M Copilot üzerinden: $0 (abonelik)
8M GLM üzerinden: $4.80
2M iFlow üzerinden: $0
Total: $4.80 + mevcut abonelikler
```

**Sonuç**: Aboneliklerden 190M token kullanılır, yalnızca $4.80 ek maliyet.

---

### Örnek 6: Kota Sıfırlama Optimizasyonu

**Amaç**: Kullanımı sıfırlama zamanlarına göre dağıtmak.

```
Dashboard → Combos → Create New

Name: reset-optimized
Models:
  1. cc/claude-opus-4-5 (5 saatte sıfırlanır, sabah kullanın)
  2. gc/gemini-3-flash (1K/gün, öğleden sonra kullanın)
  3. glm/glm-4.7 (her gün 10:00'da sıfırlanır, akşam kullanın)
  4. minimax/MiniMax-M2.1 (5 saatlik kayan pencere, gece kullanın)
  5. if/kimi-k2-thinking (sınırsız, acil durum)
```

**Günlük rutin:**
```
08:00 - 13:00: Claude Code (taze 5 saatlik kota)
13:00 - 18:00: Gemini CLI (1K/gün kota)
18:00 - 22:00: GLM (ertesi gün 10:00'da sıfırlanır)
22:00 - 08:00: MiniMax (5 saatlik kayan pencere) veya iFlow
```

**Sonuç**: Minimum maliyetle 7/24 kodlayın.

---

## Komboları CLI Araçlarında Kullanma

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [panelden]
  Model: premium-coding
```

### Claude Desktop

`~/.claude/config.json` dosyasını düzenleyin:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [panelden]
Model: free-combo
```

### API İsteği

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## En İyi Uygulamalar

### 1. Her Zaman Ücretsiz Katmanı Ekleyin

```
✅ İyi:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ Kötü:
cc/claude-opus → glm/glm-4.7
(ücretsiz yedek geçiş yok, kota tükenebilir)
```

**Neden**: 7/24 kullanılabilirlik sağlar, kota nedeniyle asla engellenmezsiniz.

### 2. Maliyete Göre Sıralayın (Ucuzdan Pahalıya)

```
✅ İyi:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ Kötü:
cc/claude-opus → glm/glm-4.7
(basit görevlerde abonelik kotasını harcar)
```

**İstisna**: Abonelik değerini maksimize etmek istiyorsanız aboneliği başa koyun.

### 3. Kalite Gereksinimlerini Karşılayın

```
Üretim kodu için:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

Hızlı görevler için:
glm/glm-4.7 → if/kimi-k2-thinking

Deneme için:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. Kota Sıfırlama Zamanlarını Göz Önünde Bulundurun

```
Sabah kombosu (taze kotalar):
cc/claude-opus → cx/gpt-5.2-codex

Akşam kombosu (kotalar muhtemelen tükendi):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. Farklı Kullanım Senaryoları için Birden Fazla Kombo Oluşturun

```
premium-coding: Karmaşık görevler için
budget-combo: Basit görevler için
free-combo: Deneme için
quality-first: Üretim kodu için
```

Görev gereksinimlerine göre **kombolar arasında geçiş yapın**.

### 6. Kombo Performansını İzleyin

```
Dashboard → Analytics → Combo Usage:
  premium-coding:
    80% cc/claude-opus üzerinden (iyi, abonelik kullanılıyor)
    15% glm/glm-4.7 üzerinden (kabul edilebilir yedek)
    5% minimax üzerinden (nadir yedek geçiş)
```

**Optimize edin**: Yedek geçiş kullanımı çok fazlaysa birincil kotayı artırın veya modelleri yeniden sıralayın.

---

## Gelişmiş Yapılandırma

### Kombo Başına Bütçe Sınırları Belirleyin

```
Dashboard → Combos → Edit → Budget:
  Günlük sınır: $5
  Aylık sınır: $50
```

Sınıra ulaşıldığında 9Router ücretli modelleri atlar ve yalnızca ücretsiz katmanı kullanır.

### Kombodaki Modelleri Etkinleştirin/Devre Dışı Bırakın

```
Dashboard → Combos → Edit → Models:
  ✅ cc/claude-opus-4-5 (etkin)
  ❌ glm/glm-4.7 (geçici olarak devre dışı)
  ✅ if/kimi-k2-thinking (etkin)
```

**Kullanım senaryosu**: Komboyu silmeden pahalı modelleri geçici olarak devre dışı bırakmak.

### Mevcut Komboyu Klonlayın

```
Dashboard → Combos → Clone "premium-coding"
→ "-copy" sonekli bir kopya oluşturur
→ Değiştirip yeni kombo olarak kaydedin
```

**Kullanım senaryosu**: Farklı senaryolar için varyasyonlar oluşturmak.

---

## Sorun Giderme

**Sorun: Kombo model listesinde görünmüyor**

**Çözüm:**
1. Paneli yenileyin
2. Kombonun kaydedildiğini kontrol edin (yeşil onay işareti)
3. Model listesini yenilemek için CLI aracını yeniden başlatın

**Sorun: Kombo her zaman son modeli kullanıyor (ücretsiz katman)**

**Çözüm:**
1. Birincil modellerin kotasını kontrol edin (Dashboard → Quota)
2. API anahtarlarının geçerli olduğunu doğrulayın (Dashboard → Providers)
3. Bütçe sınırlarının aşılmadığını kontrol edin

**Sorun: Kombo beklenenden pahalıya geliyor**

**Çözüm:**
1. Dashboard → Analytics → Kombo kullanımını inceleyin
2. Birincil modellerin kotasının tükenip tükenmediğini kontrol edin
3. Modelleri yeniden sıralayın (daha ucuzunu başa alın)
4. Bütçe sınırları belirleyin

---

## İlgili

- [Akıllı Yönlendirme](./smart-routing.md) - Otomatik yedek geçiş nasıl çalışır
- [Kota Takibi](./quota-tracking.md) - Kullanımı ve maliyetleri izleyin
