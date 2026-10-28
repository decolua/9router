# OpenAI Codex CLI Entegrasyonu

OpenAI API isteklerinizi 9Router'ın akıllı yönlendirme sistemi üzerinden geçirmek için 9Router'ı OpenAI Codex CLI ile entegre edin.

## Önkoşullar

- OpenAI Codex CLI kurulu
- 9Router yerel olarak çalışıyor veya bulut uç noktası yapılandırılmış
- 9Router panelinden API anahtarı

## Kurulum

### 1. Ortam Değişkenlerini Yapılandırın

Aşağıdaki ortam değişkenlerini kabuk yapılandırma dosyanızda (`~/.bashrc`, `~/.zshrc` veya `~/.bash_profile`) tanımlayın:

```bash
# 9Router için Base URL
export OPENAI_BASE_URL="http://localhost:20128/v1"

# 9Router panelinden API anahtarı
export OPENAI_API_KEY="your-9router-api-key"
```

### 2. Kabuk Yapılandırmasını Yeniden Yükleyin

```bash
source ~/.zshrc  # or ~/.bashrc
```

### 3. Yapılandırmayı Doğrulayın

Ortam değişkenlerinin doğru ayarlandığını kontrol edin:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## Kullanılabilir Modeller

9Router şu Codex modellerini sunar:

| Model Kimliği | Açıklama |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - En son sürüm |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - Genişletilmiş bağlam |

## Kullanım Örnekleri

### Temel Kullanım

```bash
# GPT-5.2 Codex kullanın
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# GPT-5.1 Codex Max kullanın
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### Kod Üretimi

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### Kod Açıklaması

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## Yapılandırma Dosyası

Codex CLI için bir yapılandırma dosyası da kullanabilirsiniz. `~/.codex/config.json` dosyasını oluşturun veya düzenleyin:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "apiKey": "your-9router-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## Sorun Giderme

### Kimlik Doğrulama Hataları

Kimlik doğrulama hatalarıyla karşılaşırsanız:

1. API anahtarınızın 9Router panelinde doğru olduğunu doğrulayın
2. `OPENAI_API_KEY` ortam değişkeninin ayarlandığını kontrol edin
3. API anahtarının süresinin dolmadığından emin olun

### Bağlantı Sorunları

Bağlantı hatalarıyla karşılaşırsanız:

1. 9Router'ın çalıştığını doğrulayın: `curl http://localhost:20128/health`
2. Ortam değişkenlerinin doğru ayarlandığını kontrol edin
3. 20128 portunu engelleyen bir güvenlik duvarı olmadığından emin olun

### Model Kullanılamıyor

"model not available" hatası alırsanız:

1. Model adının 9Router yapılandırmanızla eşleştiğini doğrulayın
2. 9Router panelinde OpenAI sağlayıcı bağlantısının etkin olduğunu kontrol edin
3. Modelin bağlı sağlayıcılarınızda kullanılabilir olduğundan emin olun

## Bulut Uç Noktası

localhost yerine 9Router bulut uç noktasını kullanmak için:

```bash
export OPENAI_BASE_URL="https://9router.com"
```

API anahtarınızı 9Router bulut panelinde yapılandırdığınızdan emin olun.

## Gelişmiş Yapılandırma

### Özel Zaman Aşımı

```bash
export OPENAI_TIMEOUT=60  # seconds
```

### Hata Ayıklama Modu

Ayrıntılı istek/yanıt günlüklerini görmek için hata ayıklama modunu etkinleştirin:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
