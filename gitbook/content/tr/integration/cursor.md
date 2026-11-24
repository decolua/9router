# Cursor Entegrasyonu

AI isteklerinizi 9Router'ın akıllı yönlendirme sistemi üzerinden geçirmek için 9Router'ı Cursor IDE ile entegre edin.

## Önkoşullar

- Cursor IDE kurulu
- Cursor Pro hesabı (özel API uç noktaları için gerekli)
- 9Router bulut uç noktası yapılandırılmış
- 9Router panelinden API anahtarı

## ⚠️ Önemli Notlar

> **Bulut uç noktası gerekli**: Cursor, istekleri kendi sunucusu üzerinden yönlendirir ve localhost uç noktalarını desteklemez. 9Router bulut uç noktasını kullanmanız gerekir: `https://9router.com`

> **Cursor Pro gerekli**: Bu özellik, özel API uç noktalarını kullanmak için Cursor Pro hesabı gerektirir.

## Kurulum

### 1. Cursor Ayarlarını Açın

1. Cursor IDE'yi açın
2. **Settings** bölümüne gidin (Cmd/Ctrl + ,)
3. **Models** bölümüne geçin

### 2. OpenAI API'yi Etkinleştirin

1. **OpenAI API key** seçeneğini bulun
2. Özel API yapılandırmasını etkinleştirmek için geçiş düğmesini açın

### 3. Base URL'yi Yapılandırın

Base URL'yi 9Router bulut uç noktasına ayarlayın:

```
https://9router.com
```

**Adımlar:**
1. Models ayarlarında **Base URL** alanını bulun
2. Şunu girin: `https://9router.com`
3. **Save** düğmesine tıklayın

### 4. API Anahtarı Ekleyin

1. **API Key** alanına 9Router API anahtarınızı girin
2. API anahtarınızı 9Router panelinde **Settings → API Keys** altında bulabilirsiniz
3. **Save** düğmesine tıklayın

### 5. Özel Model Ekleyin

1. **View All Models** düğmesine tıklayın
2. **Add Custom Model** seçeneğine tıklayın
3. 9Router yapılandırmanızdaki model adını girin (örn. `gpt-4`, `claude-opus-4-5` vb.)
4. **Add** düğmesine tıklayın

### 6. Model Seçin

1. Cursor sohbet arayüzünde model seçici açılır menüye tıklayın
2. Listeden özel modelinizi seçin
3. Cursor ile 9Router'ı kullanmaya başlayın!

## Yapılandırma Örneği

Cursor ayarlarınız şöyle görünmelidir:

```
OpenAI API: ✓ Enabled
Base URL: https://9router.com
API Key: sk-9router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## Kullanılabilir Modeller

9Router panelinizde yapılandırılmış herhangi bir modeli kullanabilirsiniz. Yaygın örnekler:

| Model Adı | Sağlayıcı | Açıklama |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Kullanım

### Sohbet Arayüzü

1. Cursor sohbetini açın (Cmd/Ctrl + L)
2. Açılır menüden modelinizi seçin
3. 9Router üzerinden AI ile sohbet etmeye başlayın

### Satır İçi Kod Üretimi

1. Düzenleyicinizde kod seçin
2. Cmd/Ctrl + K tuşlarına basın
3. İsteminizi girin
4. Cursor, kod üretmek için 9Router'ı kullanır

### Kod Açıklaması

1. Düzenleyicinizde kod seçin
2. Cmd/Ctrl + L tuşlarına basın
3. "Explain this code" diye sorun
4. 9Router üzerinden AI destekli açıklamalar alın

## Sorun Giderme

### "Invalid API Key" Hatası

1. 9Router panelinde API anahtarınızı doğrulayın
2. `sk-9router-` ön eki dahil anahtarın tamamını kopyaladığınızdan emin olun
3. API anahtarının süresinin dolmadığını kontrol edin
4. Yeni bir API anahtarı oluşturmayı deneyin

### "Model Not Found" Hatası

1. Model adının 9Router yapılandırmanızla tam olarak eşleştiğini doğrulayın
2. 9Router panelinde sağlayıcı bağlantısının etkin olduğunu kontrol edin
3. Modelin bağlı sağlayıcılarınızda kullanılabilir olduğundan emin olun
4. Tam model adını kullanmayı deneyin (örn. `gpt-4` yerine `openai/gpt-4`)

### Bağlantı Sorunları

1. Bulut uç noktasını kullandığınızı doğrulayın: `https://9router.com`
2. İnternet bağlantınızı kontrol edin
3. 9Router bulut hizmetinin çalışır durumda olduğundan emin olun
4. Etkinse VPN veya proxy'yi devre dışı bırakmayı deneyin

### Localhost Çalışmıyor

> **Unutmayın**: Cursor, localhost uç noktalarını desteklemez. `https://9router.com` bulut uç noktasını kullanmanız gerekir. Yerel bir 9Router örneği kullanmanız gerekiyorsa, yerel uç noktanızı dışarı açmak için ngrok gibi bir tünelleme hizmeti kullanmayı düşünün.

## Bulut Uç Noktası Kurulumu

9Router'ı yerel olarak çalıştırıyor ve Cursor ile kullanmak istiyorsanız:

1. 9Router ayarlarında bulut uç noktasını etkinleştirin
2. 9Router panelinde bulut uç noktası URL'nizi yapılandırın
3. Cursor ayarlarında bulut URL'sini kullanın
4. Yerel 9Router örneğinizin internetten erişilebilir olduğundan emin olun

## En İyi Uygulamalar

1. **Model Takma Adları Kullanın**: Sık kullanılan modeller için 9Router'da kısa takma adlar oluşturun
2. **Kullanımı İzleyin**: Kullanım istatistikleri ve maliyetler için 9Router paneline bakın
3. **API Anahtarlarını Döndürün**: Güvenlik için API anahtarlarınızı düzenli aralıklarla döndürün
4. **Modelleri Test Edin**: Kullanım durumunuz için en iyisini bulmak üzere farklı modeller deneyin
