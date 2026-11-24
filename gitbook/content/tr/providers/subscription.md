# Abonelik Sağlayıcıları - Değerinizi En Üst Düzeye Çıkarın

Mevcut AI aboneliklerinizi akıllı kota takibi ve otomatik yedek geçiş (fallback) ile en üst düzeye çıkarın. Aboneliğinizi sıfırlanmadan önce sonuna kadar kullanın!

---

## Genel Bakış

Abonelik katmanı sağlayıcıları **birincil** tercihinizdir - zaten ödeme yapıyorsunuz, karşılığını tam alın:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- ✅ **Gemini CLI** (ÜCRETSİZ katman!) - Ayda 180K tamamlama
- ✅ **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

**Strateji:** Önce bunları kullanın, kotayı gerçek zamanlı izleyin, tükendiğinde ucuz/ücretsiz katmana yedek geçiş yapın.

---

## Claude Code (Pro/Max)

### Fiyatlandırma

| Plan | Aylık Maliyet | Kota Sıfırlaması | Modeller |
|------|--------------|-------------|--------|
| Pro | $20 | 5 saatlik + Haftalık | Opus, Sonnet, Haiku |
| Max | $100 | 5 saatlik + Haftalık | Opus, Sonnet, Haiku |

### Kurulum

**Adım 1: Panelden Bağlanın**

```bash
9router
# Panel açılır → Providers → Connect Claude Code
```

**Adım 2: OAuth Girişi**

- "Connect Claude Code" seçeneğine tıklayın
- Tarayıcı açılır → Claude.ai'ye giriş yapın
- Otomatik token yenileme etkin
- Kota takibi başlar

**Adım 3: CLI'da Kullanın**

```
Model: cc/claude-opus-4-5-20251101
       cc/claude-sonnet-4-5-20250929
       cc/claude-haiku-4-5-20251001
```

### Kullanılabilir Modeller

| Model ID | Açıklama | İdeal Kullanım |
|----------|-------------|----------|
| `cc/claude-opus-4-5-20251101` | Claude 4.5 Opus | Karmaşık görevler, mimari |
| `cc/claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | Dengeli hız/kalite |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | Hızlı yanıtlar |

### İpuçları

- **Karmaşık görevlerde Opus kullanın** - Mimari kararlar, refactoring
- **Hız için Sonnet kullanın** - Hızlı düzenlemeler, kod üretimi
- **Model başına kota takibi** - Panel model başına kullanımı gösterir
- **5 saatlik sıfırlama** - Her 5 saatte taze kota + haftalık sıfırlama

---

## OpenAI Codex (Plus/Pro)

### Fiyatlandırma

| Plan | Aylık Maliyet | Kota Sıfırlaması | Modeller |
|------|--------------|-------------|--------|
| Plus | $20 | 5 saatlik + Haftalık | GPT 5.2, GPT 5.1 |
| Pro | $200 | 5 saatlik + Haftalık | GPT 5.2 Codex, GPT 5.1 Max |

### Kurulum

**Adım 1: Panelden Bağlanın**

```bash
9router
# Panel → Providers → Connect Codex
```

**Adım 2: OAuth Girişi**

- "Connect Codex" seçeneğine tıklayın
- Tarayıcı `http://localhost:1455` adresinde açılır
- OpenAI hesabınıza giriş yapın
- Otomatik token yenileme etkin

**Adım 3: CLI'da Kullanın**

```
Model: cx/gpt-5.2-codex
       cx/gpt-5.1-codex-max
       cx/gpt-5.2
       cx/gpt-5.1-codex
```

### Kullanılabilir Modeller

| Model ID | Açıklama | İdeal Kullanım |
|----------|-------------|----------|
| `cx/gpt-5.2-codex` | GPT 5.2 Codex | En yeni kodlama modeli |
| `cx/gpt-5.1-codex-max` | GPT 5.1 Codex Max | Maksimum bağlam |
| `cx/gpt-5.2` | GPT 5.2 | Genel görevler |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | Kararlı kodlama |

### Görsel Üretimi

Codex görsel kataloğu, mevcut GPT 5.5, 5.4 ve 5.3 görsel takma adlarının yanı sıra
`cx/gpt-5.6-sol-image`, `cx/gpt-5.6-terra-image` ve `cx/gpt-5.6-luna-image`
modellerini içerir. Bunları panelde **Image → OpenAI Codex** altından seçin veya bir
Codex hesabı bağladıktan sonra `GET /v1/models/image` ile keşfedin.

```bash
curl http://localhost:20128/v1/images/generations \
  -H "Authorization: Bearer $NINE_ROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"cx/gpt-5.6-sol-image","prompt":"A blue square","size":"1024x1024"}'
```

Bunlar 9Router takma adlarıdır: görsel adaptörü `-image` ekini kaldırır ve temel
modele Codex Responses API üzerinden bir `image_generation` aracı gönderir. Aynı
uç nokta, düzenlemeler için bir `image` referansı kabul eder. Görsel üretimi uygun
bir ChatGPT Plus veya üzeri hesap gerektirir; her temel modelin ve görsel aracının
kullanılabilirliği bağlı hesaba göre değişir.

### İpuçları

- **5 saatlik kayan kota** - Her 5 saatte taze kota
- **Haftalık sıfırlama** - Haftada bir tam kota sıfırlaması
- **Pro katmanı** - Plus'a göre 10× daha fazla kota

---

## Gemini CLI (ÜCRETSİZ 180K/ay!)

### Fiyatlandırma

| Plan | Aylık Maliyet | Kota | Sıfırlama |
|------|--------------|-------|-------|
| FREE | $0 | Ayda 180K tamamlama + Günde 1K | Günlük + Aylık |

**En İyi Değer:** Devasa ücretsiz katman! Ücretli katmanlardan önce bunu kullanın.

### Kurulum

**Adım 1: Panelden Bağlanın**

```bash
9router
# Panel → Providers → Connect Gemini CLI
```

**Adım 2: Google OAuth**

- "Connect Gemini CLI" seçeneğine tıklayın
- Tarayıcı açılır → Google hesabınıza giriş yapın
- İzinleri verin
- Otomatik token yenileme etkin

**Adım 3: CLI'da Kullanın**

```
Model: gc/gemini-3-flash-preview
       gc/gemini-3-pro-preview
       gc/gemini-2.5-pro
       gc/gemini-2.5-flash
```

### Kullanılabilir Modeller

| Model ID | Açıklama | İdeal Kullanım |
|----------|-------------|----------|
| `gc/gemini-3-flash-preview` | Gemini 3 Flash Preview | Hızlı yanıtlar |
| `gc/gemini-3-pro-preview` | Gemini 3 Pro Preview | Karmaşık görevler |
| `gc/gemini-2.5-pro` | Gemini 2.5 Pro | Kararlı üretim |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | Hızlı görevler |

### İpuçları

- **Ayda 180K tamamlama** - Devasa ücretsiz katman
- **Günde 1K sınırı** - Günlük kota gece yarısı sıfırlanır
- **Önce kullanın** - Ücretsiz katman, ücretli aboneliklerden önce kullanın
- **Kredi kartı gerekmez** - Google hesabıyla tamamen ücretsiz

---

## GitHub Copilot

### Fiyatlandırma

| Plan | Aylık Maliyet | Kota Sıfırlaması | Modeller |
|------|--------------|-------------|--------|
| Individual | $10 | Aylık (ayın 1'i) | GPT-5, Claude 4.5, Gemini 3 |
| Business | $19 | Aylık (ayın 1'i) | GPT-5, Claude 4.5, Gemini 3 |

### Kurulum

**Adım 1: Panelden Bağlanın**

```bash
9router
# Panel → Providers → Connect GitHub
```

**Adım 2: GitHub ile OAuth**

- "Connect GitHub" seçeneğine tıklayın
- Tarayıcı açılır → GitHub'a giriş yapın
- GitHub Copilot yetkilendirmesini onaylayın
- Otomatik token yenileme etkin

**Adım 3: CLI'da Kullanın**

```
Model: gh/gpt-5
       gh/gpt-5.1-codex-max
       gh/claude-4.5-sonnet
       gh/gemini-3-pro
```

### Kullanılabilir Modeller

| Model ID | Açıklama | İdeal Kullanım |
|----------|-------------|----------|
| `gh/gpt-5` | GPT-5 | En yeni OpenAI modeli |
| `gh/gpt-5.1-codex-max` | GPT-5.1 Codex Max | Maksimum bağlam |
| `gh/claude-4.5-sonnet` | Claude 4.5 Sonnet | Anthropic kalitesi |
| `gh/gemini-3-pro` | Gemini 3 Pro | Google kalitesi |

### İpuçları

- **Aylık sıfırlama** - Ayın 1'inde tam kota sıfırlaması
- **Çoklu model** - Tek abonelikte GPT, Claude, Gemini erişimi
- **Business katmanı** - Ekipler için daha yüksek kota

---

## Antigravity (Google Hesabı)

### Fiyatlandırma

| Plan | Aylık Maliyet | Kota | Modeller |
|------|--------------|-------|--------|
| FREE | $0 | Gemini CLI'ya benzer | Gemini 3 Pro, Claude Sonnet 4.5 |

### Kurulum

**Adım 1: Panelden Bağlanın**

```bash
9router
# Panel → Providers → Connect Antigravity
```

**Adım 2: Google OAuth**

- "Connect Antigravity" seçeneğine tıklayın
- Tarayıcı açılır → Google hesabınıza giriş yapın
- İzinleri verin
- Otomatik token yenileme etkin

**Adım 3: CLI'da Kullanın**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-opus-4-5-thinking
```

### Kullanılabilir Modeller

| Model ID | Açıklama | İdeal Kullanım |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | Yüksek kaliteli yanıtlar |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Anthropic kalitesi |
| `ag/claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking | Karmaşık akıl yürütme |

### İpuçları

- **Ücretsiz katman** - Google hesabıyla maliyetsiz
- **Claude erişimi** - Ücretsiz Claude Sonnet/Opus
- **Gemini CLI'ya benzer kota** - Günlük/aylık sınırlar

---

## Fiyat Karşılaştırması

| Sağlayıcı | Aylık Maliyet | Kota Sıfırlaması | Değer |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5 saatlik + Haftalık | ⭐⭐⭐⭐⭐ En iyi kalite |
| **Claude Code Max** | $100 | 5 saatlik + Haftalık | ⭐⭐⭐⭐⭐ En yüksek kota |
| **Codex Plus** | $20 | 5 saatlik + Haftalık | ⭐⭐⭐⭐ İyi değer |
| **Codex Pro** | $200 | 5 saatlik + Haftalık | ⭐⭐⭐⭐⭐ 10× kota |
| **Gemini CLI** | **$0** | Günlük + Aylık | ⭐⭐⭐⭐⭐ ÜCRETSİZ ayda 180K! |
| **GitHub Copilot** | $10-19 | Aylık (ayın 1'i) | ⭐⭐⭐⭐ Çoklu model |
| **Antigravity** | **$0** | Günlük + Aylık | ⭐⭐⭐⭐ ÜCRETSİZ Claude! |

---

## Kullanım Örneği

### Cursor IDE Kurulumu

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9router panelinden]
  Model: cc/claude-opus-4-5-20251101
```

### Kombo Oluşturun (Önerilir)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. gc/gemini-3-flash-preview (ÜCRETSİZ, önce kullanın)
  2. cc/claude-opus-4-5-20251101 (Abonelik)
  3. cx/gpt-5.2-codex (Abonelik yedeği)

CLI'da kullanın: premium-coding
```

**Sonuç:** Ücretsiz katmanı en üst düzeye çıkarın → Aboneliği kullanın → Otomatik yedek geçiş

---

## Kota Takibi

9Router kotayı gerçek zamanlı izler:

- **Token tüketimi** - İstek başına giriş/çıkış token'ları
- **Sıfırlama geri sayımı** - Sonraki kota sıfırlamasına kalan süre
- **Kullanım yüzdesi** - Kullanılan kota miktarı
- **Otomatik yedek geçiş** - Tükendiğinde sonraki katmana geçer

**Panel görünümü:**

```
Claude Code Pro
├─ Kota: %75 kullanıldı
├─ Sıfırlama: 2s 15dk (5 saatlik)
├─ Haftalık sıfırlama: 3 gün
└─ Yedek geçiş: glm/glm-4.7 (ucuz katman)
```

---

## En İyi Uygulamalar

### 1. Önce Ücretsiz Katmanı Kullanın

```
Öncelik:
1. Gemini CLI (Ayda 180K ÜCRETSİZ)
2. Antigravity (ÜCRETSİZ Claude)
3. Claude Code/Codex (ücretli abonelikler)
```

### 2. Kotayı Günlük İzleyin

- Her sabah paneli kontrol edin
- Yoğun görevleri kota sıfırlamalarına göre planlayın
- Kritik olmayan görevler için ucuz/ücretsiz katmanı kullanın

### 3. Akıllı Kombolar Oluşturun

```
Örnek kombo:
1. gc/gemini-3-flash-preview (ÜCRETSİZ birincil)
2. cc/claude-opus-4-5 (Karmaşık görevler)
3. glm/glm-4.7 (Ucuz yedek)
4. if/kimi-k2-thinking (ÜCRETSİZ yedek geçiş)
```

### 4. Zamana Göre Optimize Edin

```
Sabah: Taze 5 saatlik kota (Claude/Codex)
Öğleden sonra: Gemini CLI (Günde 1K)
Akşam: Abonelik kotası
Gece: Ucuz/ücretsiz katman
```

---

## Sorun Giderme

### "Kota tükendi"

**Çözüm:**
- Paneldeki kota takipçisini kontrol edin
- Sıfırlamayı bekleyin (5 saatlik veya günlük)
- Ucuz/ücretsiz katmana kombo yedek geçişi kullanın

### "OAuth token süresi doldu"

**Çözüm:**
- 9Router tarafından otomatik yenilenir
- Sorun olursa: Dashboard → Provider → Reconnect

### "Hız sınırlaması"

**Çözüm:**
- Abonelik kotası tükendi
- Yedek geçiş ekleyin: `cc/claude-opus → glm/glm-4.7`
- Ücretsiz katmanı kullanın: `if/kimi-k2-thinking`

---

## Sonraki Adımlar

- **Ucuz yedeği kurun:** [Ucuz Sağlayıcılar](./cheap.md)
- **Ücretsiz yedek geçiş ekleyin:** [Ücretsiz Sağlayıcılar](./free.md)
- **Kombo oluşturun:** Dashboard → Combos → Create New
