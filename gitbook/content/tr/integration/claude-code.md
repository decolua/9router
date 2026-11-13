# Claude Code Entegrasyonu

Anthropic API isteklerinizi 9Router'ın akıllı yönlendirme sistemi üzerinden geçirmek için 9Router'ı Claude Code CLI ile entegre edin.

## Önkoşullar

- Claude Code CLI kurulu
- 9Router yerel olarak çalışıyor veya bulut uç noktası yapılandırılmış
- 9Router panelinden API anahtarı

## Kurulum

### 1. Ortam Değişkenlerini Yapılandırın

Aşağıdaki ortam değişkenlerini kabuk yapılandırma dosyanızda (`~/.bashrc`, `~/.zshrc` veya `~/.bash_profile`) tanımlayın:

```bash
# 9Router için Base URL
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"

# İsteğe bağlı: Takma adlar için varsayılan modelleri ayarlayın
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-5-20251101"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Kabuk Yapılandırmasını Yeniden Yükleyin

```bash
source ~/.zshrc  # or ~/.bashrc
```

### 3. Yapılandırmayı Doğrulayın

Ortam değişkenlerinin doğru ayarlandığını kontrol edin:

```bash
echo $ANTHROPIC_BASE_URL
```

## Model Takma Adları

Claude Code, 9Router modellerine eşlenen şu model takma adlarını destekler:

| Takma Ad | Model | Ortam Değişkeni |
|-------|-------|---------------------|
| `opus` | Claude Opus 4.5 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | Claude Sonnet 4.5 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | Claude Haiku 4.5 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

## Kullanım Örnekleri

### Model Takma Adlarını Kullanma

```bash
# Opus modelini kullanın
claude --model opus "Explain quantum computing"

# Sonnet modelini kullanın
claude --model sonnet "Write a Python function"

# Haiku modelini kullanın
claude --model haiku "Quick code review"
```

### Tam Model Adlarını Kullanma

```bash
claude --model cc/claude-opus-4-5-20251101 "Your prompt here"
```

## Ayarlar Dosyası

Claude Code yapılandırmasını `~/.claude/settings.json` dosyasında saklar. Gerekirse bu dosyayı elle düzenleyebilirsiniz:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "defaultModel": "sonnet"
}
```

## Sorun Giderme

### Bağlantı Sorunları

Bağlantı hatalarıyla karşılaşırsanız:

1. 9Router'ın çalıştığını doğrulayın: `curl http://localhost:20128/health`
2. Ortam değişkenlerinin doğru ayarlandığını kontrol edin
3. 20128 portunu engelleyen bir güvenlik duvarı olmadığından emin olun

### Model Bulunamadı

"model not found" hatası alırsanız:

1. Model adının 9Router yapılandırmanızla eşleştiğini doğrulayın
2. 9Router panelinde sağlayıcı bağlantısının etkin olduğunu kontrol edin
3. Modelin bağlı sağlayıcılarınızda kullanılabilir olduğundan emin olun

## Bulut Uç Noktası

localhost yerine 9Router bulut uç noktasını kullanmak için:

```bash
export ANTHROPIC_BASE_URL="https://9router.com"
```

API anahtarınızı 9Router bulut panelinde yapılandırdığınızdan emin olun.
