# Continue VSCode Uzantısı Entegrasyonu

Yapay zeka desteğini doğrudan Visual Studio Code'a taşımak için 9Router'ı Continue uzantısıyla entegre edin.

## Ön Koşullar

- Visual Studio Code kurulu
- VSCode marketplace'inden Continue uzantısı kurulu
- [panelden](https://9router.com/dashboard) alınmış 9Router API anahtarı
- 9Router çalışıyor (yerel veya bulut)

## Yapılandırma Adımları

### 1. Continue Yapılandırmasını Açın

1. VSCode'u açın
2. `Cmd+Shift+P` (Mac) veya `Ctrl+Shift+P` (Windows/Linux) tuşlarına basın
3. "Continue: Open Config" yazın ve seçin
4. Bu, `~/.continue/config.json` dosyasını açar

### 2. 9Router Model Yapılandırmasını Ekleyin

`config.json` dosyanıza aşağıdaki yapılandırmayı ekleyin:

**Tek Model Kurulumu:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Çoklu Model Kurulumu:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus (Best)",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Sonnet (Balanced)",
      "provider": "openai",
      "model": "cc/claude-sonnet-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - DeepSeek Chat (Code)",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Haiku (Fast)",
      "provider": "openai",
      "model": "cc/claude-haiku-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Bulut 9Router için:**
`apiBase` değerini şununla değiştirin:
```json
"apiBase": "https://9router.com/v1"
```

### 3. Kaydedin ve Yeniden Yükleyin

1. Yapılandırma dosyasını kaydedin
2. VSCode penceresini yeniden yükleyin: `Cmd+Shift+P` → "Developer: Reload Window"
3. Continue uzantısı yeni yapılandırmayı yükler

### 4. Modeli Seçin

1. Continue kenar çubuğunu açın (sol paneldeki Continue simgesine tıklayın)
2. Üstteki model seçici açılır menüye tıklayın
3. Tercih ettiğiniz 9Router modelini seçin

## Kullanılabilir Modeller

### Claude Modelleri (Anthropic)
- `cc/claude-opus-4-5-20251101` - En yetenekli, karmaşık görevler için en uygunu
- `cc/claude-sonnet-4-20250514` - Dengeli performans ve hız
- `cc/claude-haiku-4-20250514` - En hızlı, basit görevler için ideal

### DeepSeek Modelleri
- `cx/deepseek-chat` - Kod üretimi için mükemmel
- `cx/deepseek-reasoner` - Karmaşık problem çözme için en iyisi

### GLM Modelleri (Zhipu AI)
- `glm/glm-4-plus` - Gelişmiş Çince ve İngilizce desteği
- `glm/glm-4-flash` - Hızlı yanıtlar

## Kullanım Örnekleri

### Kod Açıklaması
1. Düzenleyicide kod seçin
2. Continue kenar çubuğunu açın
3. Şunu yazın: "Explain this code"
4. Model: `cc/claude-sonnet-4-20250514`

### Kod Üretimi
1. Continue kenar çubuğunu açın
2. Şunu yazın: "Create a React component for user profile card"
3. Model: `cx/deepseek-chat`

### Yeniden Düzenleme
1. Yeniden düzenlenecek kodu seçin
2. Şunu yazın: "Refactor this to use async/await"
3. Model: `cc/claude-sonnet-4-20250514`

### Hata Düzeltme
1. Sorunlu kodu seçin
2. Şunu yazın: "Find and fix the bug in this code"
3. Model: `cx/deepseek-reasoner`

## Gelişmiş Yapılandırma

### Özel Sistem İstemleri

Belirli davranışlar için özel sistem istemleri ekleyin:

```json
{
  "models": [
    {
      "title": "9Router - Code Expert",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "systemMessage": "You are an expert programmer. Always provide clean, well-documented code with best practices."
    }
  ]
}
```

### Temperature ve Parametreler

Model davranışını parametrelerle ayarlayın:

```json
{
  "models": [
    {
      "title": "9Router - Creative Writer",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "temperature": 0.9,
      "topP": 0.95
    }
  ]
}
```

### Bağlam Sağlayıcıları

Continue'un modele hangi bağlamı göndereceğini yapılandırın:

```json
{
  "contextProviders": [
    {
      "name": "code",
      "params": {
        "maxLines": 100
      }
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    }
  ]
}
```

## Klavye Kısayolları

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - Continue sohbetini aç
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - Satır içi düzenleme
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - Yanıtı yeniden oluştur

## Sorun Giderme

### Model Yanıt Vermiyor
- 9Router'ın çalıştığını kontrol edin: `curl http://localhost:20128/health`
- config.json içindeki API anahtarını doğrulayın
- Hatalar için VSCode Developer Console'u kontrol edin: `Help` → `Toggle Developer Tools`

### Yanlış Model Seçildi
- Continue kenar çubuğundaki model açılır menüsüne tıklayın
- Doğru 9Router modelini seçin
- Model adı tam olarak eşleşmelidir (büyük/küçük harfe duyarlı)

### Yapılandırma Yüklenmiyor
- JSON söz diziminin geçerli olduğunu doğrulayın (bir JSON doğrulayıcı kullanın)
- Dosya konumunu kontrol edin: `~/.continue/config.json`
- Değişikliklerden sonra VSCode penceresini yeniden yükleyin

### Yavaş Performans
- Daha hızlı modellere geçin (haiku, flash)
- contextProviders içindeki bağlam boyutunu azaltın
- 9Router'a ağ gecikmesini kontrol edin

## En İyi Uygulamalar

### Model Seçme Stratejisi
- **Hızlı düzenlemeler**: `cc/claude-haiku-4-20250514` kullanın
- **Kod üretimi**: `cx/deepseek-chat` kullanın
- **Karmaşık yeniden düzenleme**: `cc/claude-opus-4-5-20251101` kullanın
- **Problem çözme**: `cx/deepseek-reasoner` kullanın

### Bağlam Yönetimi
- Sormadan önce yalnızca ilgili kodu seçin
- Belirli ve net istemler kullanın
- Karmaşık görevleri daha küçük adımlara bölün

### Maliyet Optimizasyonu
- Basit görevler için daha hızlı/daha ucuz modeller kullanın
- Mümkün olduğunda bağlam boyutunu sınırlayın
- Sık kullanılan yanıtları önbelleğe alın

## Sonraki Adımlar

- Gelişmiş IDE entegrasyonu için [Cursor'ı yapılandırın](cursor.md)
- Yapay zeka asistanı için [Roo'yu kurun](roo.md)
- [CLI kullanımını keşfedin](../cli/basic-usage.md)
- [Model seçimi hakkında bilgi edinin](../models/overview.md)
