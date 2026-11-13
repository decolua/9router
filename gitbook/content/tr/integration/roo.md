# Roo AI Assistant Entegrasyonu

Birden çok AI modeline tek bir arayüzden erişmek için 9Router'ı Roo AI Assistant ile entegre edin.

## Önkoşullar

- Roo AI Assistant kurulu
- [panelden](https://9router.com/dashboard) alınan 9Router API anahtarı
- 9Router çalışıyor (yerel veya bulut)

## Yapılandırma Adımları

### 1. Roo Ayarlarını Açın

Roo AI Assistant'ı başlatın ve ayarlar panelini açın.

### 2. API Sağlayıcısını Yapılandırın

1. **API Provider** ayarlarına gidin
2. Sağlayıcı türü olarak **Ollama** seçin
3. Aşağıdaki ayarları yapılandırın:

**Yerel 9Router için:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**Bulut 9Router için:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. Model Seçin

Kullanılabilir 9Router modellerinden seçin:

**Claude Modelleri:**
- `cc/claude-opus-4-5-20251101` - En yetenekli
- `cc/claude-sonnet-4-20250514` - Dengeli
- `cc/claude-haiku-4-20250514` - Hızlı

**DeepSeek Modelleri:**
- `cx/deepseek-chat` - Genel amaçlı
- `cx/deepseek-reasoner` - Karmaşık akıl yürütme

**GLM Modelleri:**
- `glm/glm-4-plus` - Gelişmiş
- `glm/glm-4-flash` - Hızlı yanıtlar

### 4. Bağlantıyı Test Edin

Entegrasyonu doğrulamak için bir test mesajı gönderin:

```
Hello! Can you confirm you're connected through 9Router?
```

## Kullanım Örnekleri

### Temel Sohbet
```
Roo'ya sorun: "Explain quantum computing in simple terms"
Model: cc/claude-sonnet-4-20250514
```

### Kod Üretimi
```
Roo'ya sorun: "Write a Python function to calculate Fibonacci numbers"
Model: cx/deepseek-chat
```

### Karmaşık Akıl Yürütme
```
Roo'ya sorun: "Analyze the trade-offs between microservices and monolithic architecture"
Model: cx/deepseek-reasoner
```

## Model Seçimi İpuçları

- **Hızlı görevler**: `cc/claude-haiku-4-20250514` veya `glm/glm-4-flash` kullanın
- **Dengeli performans**: `cc/claude-sonnet-4-20250514` veya `cx/deepseek-chat` kullanın
- **Karmaşık akıl yürütme**: `cc/claude-opus-4-5-20251101` veya `cx/deepseek-reasoner` kullanın
- **Maliyet optimizasyonu**: DeepSeek veya GLM modellerini kullanın

## Sorun Giderme

### Bağlantı Başarısız
- 9Router'ın çalıştığını doğrulayın: `curl http://localhost:20128/health`
- API anahtarının doğru olduğunu kontrol edin
- Base URL'nin `/v1` son ekini içerdiğinden emin olun

### Model Kullanılamıyor
- Model adının tam olarak eşleştiğini kontrol edin (büyük/küçük harfe duyarlı)
- Modelin 9Router planınızda etkin olduğunu doğrulayın
- Listeden farklı bir model deneyin

### Yavaş Yanıtlar
- Daha hızlı modellere geçin (haiku, flash)
- Ağ bağlantısını kontrol edin
- Sorunlar için 9Router günlüklerini izleyin

## Gelişmiş Yapılandırma

### Özel Model Takma Adları

Roo ayarlarında sık kullanılan modeller için kısayollar oluşturabilirsiniz:

```
Alias: "fast" → cc/claude-haiku-4-20250514
Alias: "smart" → cc/claude-opus-4-5-20251101
Alias: "code" → cx/deepseek-chat
```

### Birden Çok Profil

Farklı kullanım durumları için farklı profiller kurun:
- **Geliştirme**: Kod için DeepSeek modelleri
- **Yazma**: İçerik için Claude modelleri
- **Araştırma**: Analiz için Reasoner modelleri

## Sonraki Adımlar

- IDE entegrasyonu için [Cursor'ı yapılandırın](cursor.md)
- VSCode için [Continue'yu kurun](continue.md)
- [CLI kullanımına göz atın](../cli/basic-usage.md)
