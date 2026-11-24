# Ücretsiz Sağlayıcılar - Sıfır Maliyetli Yedek Geçiş (Fallback)

Diğer her şey kota sınırına takıldığında acil yedek. 24/7 sıfır maliyetle kodlayın!

---

## Genel Bakış

Abonelik ve ucuz kota tükendiğinde ücretsiz katman sağlayıcıları **yedek geçiş** seçeneğinizdir:

- 🆓 **iFlow** - 8 model ÜCRETSİZ (Kimi K2, Qwen3, GLM 4.7, MiniMax M2...)
- 🆓 **Qwen** - 3 model ÜCRETSİZ (Qwen3 Coder Plus/Flash, Vision)
- 🆓 **Kiro** - 2 model ÜCRETSİZ (Claude Sonnet 4.5, Haiku 4.5)

**Strateji:** Acil yedek olarak kullanın. Sınırsız kullanım, sonsuza kadar sıfır maliyet!

---

## iFlow (8 ÜCRETSİZ Model)

### Fiyatlandırma

| Plan | Aylık maliyet | Model | Kota |
|------|--------------|--------|-------|
| FREE | $0 | 8 model | Sınırsız |

**En iyi değer:** Ücretsiz katmandaki en fazla model! Kimi K2, Qwen3, GLM, MiniMax, DeepSeek.

### Kurulum

**Adım 1: Panel üzerinden bağlanın**

```bash
9router
# Dashboard → Providers → Connect iFlow
```

**Adım 2: iFlow OAuth girişi**

- "Connect iFlow" seçeneğine tıklayın
- Tarayıcı açılır → iFlow giriş sayfası
- Hesap oluşturun veya giriş yapın
- İzinleri verin
- Otomatik token yenileme etkin

**Adım 3: CLI'de kullanın**

```
Model: if/kimi-k2-thinking
       if/kimi-k2
       if/qwen3-coder-plus
       if/glm-4.7
       if/minimax-m2
       if/deepseek-r1
       if/deepseek-v3.2-chat
       if/deepseek-v3.2-reasoner
```

### Kullanılabilir Modeller

| Model ID | Açıklama | En uygun |
|----------|-------------|----------|
| `if/kimi-k2-thinking` | Kimi K2 Thinking | Karmaşık akıl yürütme |
| `if/kimi-k2` | Kimi K2 | Genel kodlama |
| `if/qwen3-coder-plus` | Qwen3 Coder Plus | Kod üretimi |
| `if/glm-4.7` | GLM 4.7 | Çince + İngilizce |
| `if/minimax-m2` | MiniMax M2 | Uzun bağlam |
| `if/deepseek-r1` | DeepSeek R1 | Akıl yürütme görevleri |
| `if/deepseek-v3.2-chat` | DeepSeek V3.2 Chat | Sohbet odaklı |
| `if/deepseek-v3.2-reasoner` | DeepSeek V3.2 Reasoner | Karmaşık mantık |

### İpuçları

- **8 model ÜCRETSİZ** - Ücretsiz katmandaki en geniş çeşitlilik
- **Sınırsız kullanım** - Kota sınırı yok
- **Kimi K2 Thinking** - Karmaşık akıl yürütme için en iyisi
- **DeepSeek R1** - Güçlü akıl yürütme yetenekleri

---

## Qwen (3 ÜCRETSİZ Model)

### Fiyatlandırma

| Plan | Aylık maliyet | Model | Kota |
|------|--------------|--------|-------|
| FREE | $0 | 3 model | Sınırsız |

### Kurulum

**Adım 1: Panel üzerinden bağlanın**

```bash
9router
# Dashboard → Providers → Connect Qwen
```

**Adım 2: Cihaz kodu yetkilendirmesi**

- "Connect Qwen" seçeneğine tıklayın
- Panel cihaz kodunu gösterir
- Yetkilendirme URL'sini ziyaret edin
- Cihaz kodunu girin
- Qwen hesabına giriş yapın
- Otomatik token yenileme etkin

**Adım 3: CLI'de kullanın**

```
Model: qw/qwen3-coder-plus
       qw/qwen3-coder-flash
       qw/vision-model
```

### Kullanılabilir Modeller

| Model ID | Açıklama | En uygun |
|----------|-------------|----------|
| `qw/qwen3-coder-plus` | Qwen3 Coder Plus | İleri düzey kodlama |
| `qw/qwen3-coder-flash` | Qwen3 Coder Flash | Hızlı yanıtlar |
| `qw/vision-model` | Qwen3 Vision | Görsel analizi |

### İpuçları

- **Qwen3 Coder Plus** - Güçlü kodlama yetenekleri
- **Qwen3 Coder Flash** - Hızlı görevler için ideal
- **Görsel modeli** - ÜCRETSİZ görsel analizi
- **Sınırsız kullanım** - Kota sınırı yok

---

## Kiro (ÜCRETSİZ Claude)

### Fiyatlandırma

| Plan | Aylık maliyet | Model | Kota |
|------|--------------|--------|-------|
| FREE | $0 | Claude Sonnet 4.5, Haiku 4.5 | Sınırsız |

**En iyi değer:** ÜCRETSİZ Claude! Ücretli Claude Code ile aynı kalite.

### Kurulum

**Adım 1: Panel üzerinden bağlanın**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**Adım 2: AWS Builder ID veya OAuth**

- "Connect Kiro" seçeneğine tıklayın
- Giriş yöntemini seçin:
  - AWS Builder ID (önerilir)
  - Google hesabı
  - GitHub hesabı
- İzinleri verin
- Otomatik token yenileme etkin

**Adım 3: CLI'de kullanın**

```
Model: kr/claude-sonnet-4.5
       kr/claude-haiku-4.5
```

### Kullanılabilir Modeller

| Model ID | Açıklama | En uygun |
|----------|-------------|----------|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | Dengeli kalite/hız |
| `kr/claude-haiku-4.5` | Claude Haiku 4.5 | Hızlı yanıtlar |

### İpuçları

- **ÜCRETSİZ Claude** - Ücretli katmanla aynı kalite
- **AWS Builder ID** - AWS hesabıyla kolay kurulum
- **Sınırsız kullanım** - Kota sınırı yok
- **En iyi kalite** - Claude 4.5 ücretsiz!

---

## Özellik Karşılaştırması

| Sağlayıcı | Model | En iyi model | Kurulum | Kota |
|----------|--------|------------|-------|-------|
| **iFlow** | 8 | Kimi K2 Thinking | OAuth | Sınırsız |
| **Qwen** | 3 | Qwen3 Coder Plus | Cihaz kodu | Sınırsız |
| **Kiro** | 2 | Claude Sonnet 4.5 | AWS Builder ID | Sınırsız |

**Kazanan:** Çeşitlilikte iFlow, kalitede Kiro!

---

## Kullanım Örneği

### Cursor IDE Kurulumu

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9router panelinden]
  Model: if/kimi-k2-thinking
```

### Kombo Oluşturun (Önerilir)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking (iFlow birincil)
  2. qw/qwen3-coder-plus (Qwen yedek)
  3. kr/claude-sonnet-4.5 (Kiro kalite)

CLI'de kullanım: free-combo
```

**Sonuç:** Sıfır maliyet, maksimum çalışma süresi!

---

## Tam Yedek Geçiş Stratejisi

### Eksiksiz 3 Katmanlı Kombo

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. gc/gemini-3-flash-preview (ÜCRETSİZ abonelik)
  2. cc/claude-opus-4-5 (Ücretli abonelik)
  3. glm/glm-4.7 (Ucuz yedek, $0.6/1M)
  4. minimax/MiniMax-M2.1 (En ucuz, $0.2/1M)
  5. if/kimi-k2-thinking (ÜCRETSİZ yedek geçiş)
  6. kr/claude-sonnet-4.5 (ÜCRETSİZ kalite)

CLI'de kullanım: complete-fallback
```

**Sonuç:**
- Katman 1: ÜCRETSİZ abonelik (Gemini CLI)
- Katman 2: Ücretli abonelik (Claude Code)
- Katman 3: Ucuz yedek (GLM, MiniMax)
- Katman 4: ÜCRETSİZ yedek geçiş (iFlow, Kiro)

**Kodlamayı asla bırakmayın!**

---

## En İyi Uygulamalar

### 1. Acil Yedek Olarak Kullanın

```
Öncelik:
1. Abonelik katmanı (ücretli kotayı maksimize edin)
2. Ucuz katman (1M token başına birkaç kuruş)
3. ÜCRETSİZ katman (sınırsız, sıfır maliyet)

Ücretsiz katmanı yalnızca şu durumlarda kullanın:
- Abonelik kotası tükendiğinde
- Bütçe sınırına ulaşıldığında
- Test/kritik olmayan görevlerde
```

### 2. Doğru Modeli Seçin

```
Karmaşık akıl yürütme: if/kimi-k2-thinking
Hızlı kodlama: qw/qwen3-coder-flash
En iyi kalite: kr/claude-sonnet-4.5
Uzun bağlam: if/minimax-m2
Görsel görevler: qw/vision-model
```

### 3. Yalnızca Ücretsiz Kombo Oluşturun

```
Sıfır maliyetli kodlama için:

Name: zero-cost
Models:
  1. kr/claude-sonnet-4.5 (En iyi kalite)
  2. if/kimi-k2-thinking (Karmaşık görevler)
  3. qw/qwen3-coder-plus (Hızlı kodlama)

Maliyet: $0, sonsuza kadar!
```

### 4. Üretimden Önce Test Edin

```
Ücretsiz katmanı şunun için kullanın:
- Prompt testi
- Özellik prototipleme
- Yeni framework'ler öğrenme
- Kritik olmayan görevler

Ücretli kotayı şunlara ayırın:
- Üretim kodu
- Karmaşık refactoring
- Kritik özellikler
```

---

## Gerçek Dünya Örnekleri

### Örnek 1: Öğrenci (Sıfır Bütçe)

```
Kurulum:
1. kr/claude-sonnet-4.5 (En iyi kalite)
2. if/kimi-k2-thinking (Karmaşık akıl yürütme)
3. qw/qwen3-coder-plus (Hızlı kodlama)

Aylık maliyet: $0
Kullanım: Sınırsız

Şunlar için ideal:
- Kodlamayı öğrenmek
- Kişisel projeler
- Ödevler
```

### Örnek 2: Serbest Çalışan (Bütçe Bilinçli)

```
Kurulum:
1. gc/gemini-3-flash-preview (ÜCRETSİZ 180K/ay)
2. glm/glm-4.7 (Ucuz yedek, $0.6/1M)
3. if/kimi-k2-thinking (ÜCRETSİZ yedek geçiş)

Aylık maliyet: $5-10
Kullanım: 100M+ token

Şunlar için ideal:
- Müşteri projeleri (ücretli katman)
- Test (ücretsiz katman)
- Acil yedek
```

### Örnek 3: Yoğun Kullanıcı (Her Şeyi Maksimize Edin)

```
Kurulum:
1. gc/gemini-3-flash-preview (ÜCRETSİZ 180K/ay)
2. cc/claude-opus-4-5 (Abonelik $20-100)
3. cx/gpt-5.2-codex (Abonelik $20-200)
4. glm/glm-4.7 (Ucuz $0.6/1M)
5. minimax/MiniMax-M2.1 (En ucuz $0.2/1M)
6. if/kimi-k2-thinking (ÜCRETSİZ sınırsız)
7. kr/claude-sonnet-4.5 (ÜCRETSİZ kalite)

Aylık maliyet: $40-320 (abonelikler) + $10-20 (ucuz katman)
Kullanım: 500M+ token

Şunlar için ideal:
- Profesyonel geliştirme
- Ekip projeleri
- 24/7 kodlama
```

---

## Maliyet Karşılaştırması

### Senaryo: Ayda 100M token

**Seçenek 1: Yalnızca ChatGPT API**
```
100M × $20/1M = $2,000/ay
```

**Seçenek 2: Yalnızca 9Router Ücretsiz Katmanı**
```
Ücretsiz katmanla 100M = $0/ay
Tasarruf: $2,000/ay (100%)
```

**Seçenek 3: 9Router Eksiksiz Stratejisi**
```
Gemini CLI üzerinden 60M (ÜCRETSİZ): $0
Claude Code üzerinden 30M (abonelik): $0 ek
GLM üzerinden 8M (ucuz): $4.80
iFlow üzerinden 2M (ÜCRETSİZ): $0
Total: $4.80/ay + mevcut abonelikleriniz
Tasarruf: $1,995/ay (99.76%)
```

---

## Sorun Giderme

### "OAuth failed"

**Çözüm:**
- İnternet bağlantısını kontrol edin
- Farklı bir tarayıcı deneyin
- Tarayıcı önbelleğini temizleyin
- Panelden yeniden bağlanın

### "Model kullanılamıyor"

**Çözüm:**
- Sağlayıcının panelde bağlı olduğunu kontrol edin
- OAuth token'ının geçerli olduğunu doğrulayın
- Gerekirse sağlayıcıyı yeniden bağlayın

### "Yanıtlar yavaş"

**Çözüm:**
- Ücretsiz katmanın önceliği daha düşük olabilir
- Yoğun olmayan saatlerde kullanın
- Farklı bir ücretsiz sağlayıcıya geçin
- Hız için ucuz katmana geçin

---

## Sınırlamalar

### Ücretsiz Katman Değerlendirmeleri

- **Hız** - Ücretli katmanlardan yavaş olabilir
- **Öncelik** - Yoğun saatlerde daha düşük öncelik
- **Hız sınırları** - Hız sınırlaması olabilir (ancak kota sınırsız)
- **Kullanılabilirlik** - Ara sıra kesinti olabilir

**Çözüm:** Güvenilirlik için 3 katmanlı yedek geçiş stratejisini kullanın!

---

## Sonraki Adımlar

- **Abonelikleri kurun:** [Abonelik Sağlayıcıları](./subscription.md)
- **Ucuz yedek ekleyin:** [Ucuz Sağlayıcılar](./cheap.md)
- **Kombolar oluşturun:** Dashboard → Combos → Create New
- **Kodlamaya başlayın:** Maksimum güvenilirlik için `complete-fallback` kombosunu kullanın
