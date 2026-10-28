# Başlangıç

9Router'ı 5 dakikada çalıştırın ve AI isteklerini akıllıca yönlendirmeye başlayın.

---

## Hızlı başlangıç

### 1. Kurulum

```bash
npm install -g 9router
```

**Gereksinimler:** Node.js 20+ ([Kurulum ayrıntıları](getting-started/installation.md))

### 2. Başlatma

```bash
9router
```

🎉 **Panel otomatik açılır**: `http://localhost:20128`

- Varsayılan parola: `123456` (panelden değiştirin)
- API anahtarı otomatik oluşturulur
- Sağlayıcıları bağlamaya hazır

### 3. Sağlayıcıları bağlama

Sağlayıcıları bağlamak için 3 yolunuz var:

#### Seçenek A: OAuth (abonelik sağlayıcıları)

**En uygun:** Claude Code, Codex, Gemini CLI, GitHub Copilot

```
Dashboard → Providers → Connect [Provider]
→ OAuth girişi → Otomatik token yenileme
→ Kota takibi etkin
```

**Örnek: Claude Code**
1. "Connect Claude Code" düğmesine tıklayın
2. Claude hesabınızla giriş yapın
3. 9Router'a yetki verin
4. ✅ Tamam! Modeli kullanın: `cc/claude-opus-4-5-20251101`

#### Seçenek B: API anahtarı (ucuz sağlayıcılar)

**En uygun:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Sağlayıcıyı seçin
→ API anahtarını yapıştırın
→ Kaydedin
```

**Örnek: GLM-4.7**
1. [Zhipu AI](https://open.bigmodel.cn/) üzerinde kaydolun
2. Coding Plan'dan API anahtarınızı alın
3. Dashboard → Add API Key → Provider: `glm` → Anahtarı yapıştırın
4. ✅ Tamam! Modeli kullanın: `glm/glm-4.7`

#### Seçenek C: Ücretsiz sağlayıcılar (maliyetsiz)

**En uygun:** iFlow, Qwen, Kiro

```
Dashboard → Providers → Connect [Free Provider]
→ Cihaz kodu veya OAuth
→ Sınırsız kullanım
```

**Örnek: iFlow**
1. "Connect iFlow" düğmesine tıklayın
2. iFlow hesabınızla giriş yapın
3. Yetkilendirin
4. ✅ Tamam! 8 modeli kullanın: `if/kimi-k2-thinking`, `if/qwen3-coder-plus` vb.

---

## 4. CLI araçlarında kullanma

Kodlama aracınızı 9Router'a yönlendirin:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9router panelinden]
  Model: cc/claude-opus-4-5-20251101
```

### Claude Desktop

`~/.claude/config.json` dosyasını düzenleyin:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [panelden]
Model: cc/claude-opus-4-5-20251101
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Akıllı kombolar oluşturma (isteğe bağlı)

Kombolar modeller arasında otomatik yedek geçiş (fallback) sağlar:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (Birincil abonelik)
  2. glm/glm-4.7 (Ucuz yedek, $0.6/1M)
  3. if/kimi-k2-thinking (Ücretsiz yedek geçiş)

CLI'da kullanım: premium-coding
```

**Nasıl çalışır:**
1. Önce Claude Opus'u dener (aboneliğiniz)
2. Kota tükenirse → GLM-4.7 (ultra ucuz)
3. Bütçe sınırına gelirse → iFlow (ücretsiz)
4. Sıfır kesinti, otomatik geçiş!

---

## Kullanılabilir modeller

### Abonelik modelleri (önce bunları kullanın)

**Claude Code (`cc/`)** - Pro/Max abonelik:
- `cc/claude-opus-4-5-20251101` - Claude 4.5 Opus
- `cc/claude-sonnet-4-5-20250929` - Claude 4.5 Sonnet
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Pro abonelik:
- `cx/gpt-5.2-codex` - GPT 5.2 Codex
- `cx/gpt-5.1-codex-max` - GPT 5.1 Codex Max

**Gemini CLI (`gc/`)** - ÜCRETSİZ 180K/ay:
- `gc/gemini-3-flash-preview` - Gemini 3 Flash Preview
- `gc/gemini-2.5-pro` - Gemini 2.5 Pro

**GitHub Copilot (`gh/`)** - Abonelik:
- `gh/gpt-5` - GPT-5
- `gh/claude-4.5-sonnet` - Claude 4.5 Sonnet

### Ucuz modeller (yedek)

**GLM (`glm/`)** - 1M başına $0.6/$2.2:
- `glm/glm-4.7` - GLM 4.7 (her gün 10:00'da sıfırlanır)

**MiniMax (`minimax/`)** - 1M başına $0.20/$1.00:
- `minimax/MiniMax-M2.1` - MiniMax M2.1 (5 saatlik sıfırlama)

**Kimi (`kimi/`)** - $9/ay (10M token):
- `kimi/kimi-latest` - Kimi Latest

### ÜCRETSİZ modeller (acil durum)

**iFlow (`if/`)** - 8 model ÜCRETSİZ:
- `if/kimi-k2-thinking` - Kimi K2 Thinking
- `if/qwen3-coder-plus` - Qwen3 Coder Plus
- `if/glm-4.7` - GLM 4.7
- `if/deepseek-r1` - DeepSeek R1

**Qwen (`qw/`)** - 3 model ÜCRETSİZ:
- `qw/qwen3-coder-plus` - Qwen3 Coder Plus
- `qw/qwen3-coder-flash` - Qwen3 Coder Flash

**Kiro (`kr/`)** - 2 model ÜCRETSİZ:
- `kr/claude-sonnet-4.5` - Claude Sonnet 4.5
- `kr/claude-haiku-4.5` - Claude Haiku 4.5

---

## Maliyet optimizasyon stratejisi

### Aylık bütçe: $10-20/ay

```
1. Hızlı işler için Gemini CLI ücretsiz katmanını kullanın (180K/ay)
2. Claude Code abonelik kotasını tamamen kullanın (zaten ödüyorsunuz)
3. Kota bitince GLM'e yedek geçiş yapın ($0.6/1M)
4. Acil durum: MiniMax M2.1 ($0.20/1M) veya iFlow (ücretsiz)

Gerçek örnek (ayda 100M token):
  60M Gemini CLI ile: $0 (ücretsiz katman)
  30M Claude Code ile: $0 (zaten sahip olduğunuz abonelik)
  8M GLM ile: $4.80
  2M MiniMax ile: $0.40
  Total: $5.20/ay + mevcut abonelikler
```

### Kota sıfırlama stratejisi

```
Günlük rutin:
1. Sabah: Taze Claude Code kotası (5 saatte bir yenilenir)
2. Öğleden sonra: Gemini CLI'ya geçin (1K/gün)
3. Akşam: GLM günlük kotası (ertesi gün 10:00'da sıfırlanır)
4. Gece geç saat: MiniMax (5 saatlik kayan) veya iFlow (ücretsiz)

→ Minimum ek maliyetle 7/24 kod yazın!
```

---

## Sonraki adımlar

- [Kurulum ayrıntıları](getting-started/installation.md) - Gereksinimler, sorun giderme
- [Özellikler](features/) - Kota takibi, kombolar, dağıtımı keşfedin
- [SSS](faq.md) - Sık sorulan sorular ve yanıtları
- [Sorun giderme](troubleshooting.md) - Sık karşılaşılan sorunları çözün

---

## Yardım mı gerekiyor?

- **Web sitesi**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
