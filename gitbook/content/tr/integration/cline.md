# Cline Entegrasyonu

Yapay zeka isteklerinizi 9Router'ın akıllı yönlendirme sistemi üzerinden geçirmek için 9Router'ı Cline VSCode uzantısıyla entegre edin.

## Ön Koşullar

- Visual Studio Code kurulu
- VSCode marketplace'inden Cline uzantısı kurulu
- 9Router yerel olarak çalışıyor veya bulut uç noktası yapılandırılmış
- 9Router panelinden alınmış API anahtarı

## Kurulum

### 1. Cline Ayarlarını Açın

1. Visual Studio Code'u açın
2. Cline uzantı panelini açın (kenar çubuğundaki Cline simgesine tıklayın)
3. Cline panelindeki **Settings** simgesine (dişli simgesi) tıklayın

### 2. API Sağlayıcısını Seçin

1. Cline ayarlarında **API Provider** açılır menüsünü bulun
2. Listeden **Ollama**'yı seçin
   - Not: OpenAI tarzı API'lerle uyumlu olduğu için Ollama sağlayıcı türünü kullanıyoruz

### 3. Base URL'yi Yapılandırın

Base URL'yi 9Router uç noktanıza ayarlayın:

**Yerel 9Router için:**
```
http://localhost:20128/v1
```

**Bulut 9Router için:**
```
https://9router.com
```

**Adımlar:**
1. **Base URL** alanına 9Router uç noktanızı girin
2. Sona `/v1` eklediğinizden emin olun

### 4. API Anahtarı Ekleyin

1. **API Key** alanına 9Router API anahtarınızı girin
2. API anahtarınızı 9Router panelinde **Settings → API Keys** altında bulabilirsiniz
3. Anahtar `sk-9router-` ile başlamalıdır

### 5. Modeli Seçin

1. **Model** açılır menüsünde şunlardan birini yapabilirsiniz:
   - Kullanılabilir modellerden seçin (Cline bunları otomatik algılarsa)
   - 9Router yapılandırmanızdaki model adını elle girin

2. Yaygın model adları:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. Yapılandırmayı Kaydedin

**Save**'e tıklayın veya ayarlar panelini kapatın. Cline yapılandırmanızı otomatik olarak kaydeder.

## Yapılandırma Örneği

Cline ayarlarınız şöyle görünmelidir:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-9router-xxxxxxxxxxxxx
Model: gpt-4
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

### Yapay Zeka ile Sohbet

1. VSCode'da Cline panelini açın
2. Mesajınızı sohbet girişine yazın
3. Göndermek için Enter'a basın
4. Cline isteğinizi işlemek için 9Router'ı kullanır

### Kod Üretimi

1. Cline'dan kod üretmesini isteyin: "Create a React component for a login form"
2. Cline 9Router kullanarak kod üretir
3. Üretilen kodu inceleyin ve kabul edin

### Kod Açıklaması

1. Düzenleyicinizde kod seçin
2. Cline'a sorun: "Explain this code"
3. 9Router üzerinden yapay zeka destekli açıklamalar alın

### Dosya İşlemleri

1. Cline'dan dosya oluşturmasını, değiştirmesini veya silmesini isteyin
2. Cline bağlamı anlamak ve değişiklikleri yapmak için 9Router'ı kullanır
3. Değişiklikleri kabul etmeden önce inceleyin

## Sorun Giderme

### "Connection Failed" Hatası

1. 9Router'ın çalıştığını doğrulayın: `curl http://localhost:20128/health`
2. Base URL'nin doğru olduğundan ve `/v1` içerdiğinden emin olun
3. 20128 portunu engelleyen bir güvenlik duvarı olmadığından emin olun
4. VSCode'u yeniden başlatmayı deneyin

### "Invalid API Key" Hatası

1. API anahtarınızı 9Router panelinden doğrulayın
2. `sk-9router-` ön eki dahil anahtarın tamamını kopyaladığınızdan emin olun
3. API anahtarının süresinin dolmadığını kontrol edin
4. Yeni bir API anahtarı oluşturmayı deneyin

### "Model Not Found" Hatası

1. Model adının 9Router yapılandırmanızla tam olarak eşleştiğini doğrulayın
2. 9Router panelinde sağlayıcı bağlantısının etkin olduğunu kontrol edin
3. Modelin bağlı sağlayıcılarınızda kullanılabilir olduğundan emin olun
4. Tam model adını kullanmayı deneyin (örn. `gpt-4` yerine `openai/gpt-4`)

### Cline Yanıt Vermiyor

1. Hata mesajları için Cline çıktı panelini kontrol edin
2. 9Router örneğinizin çalıştığını ve sağlıklı olduğunu doğrulayın
3. VSCode penceresini yeniden yüklemeyi deneyin (Cmd/Ctrl + Shift + P → "Reload Window")
4. Hatalar için 9Router günlüklerini kontrol edin

## Gelişmiş Yapılandırma

### Bulut Uç Noktasını Kullanma

Localhost yerine 9Router bulut uç noktasını kullanmak için:

1. Cline ayarlarında Base URL'yi şuna ayarlayın: `https://9router.com`
2. API anahtarınızı 9Router bulut panelinde yapılandırdığınızdan emin olun
3. Bulut uç noktanızın etkin ve erişilebilir olduğundan emin olun

### Birden Fazla Model

Modeller arasında hızlıca geçiş yapabilirsiniz:

1. Cline ayarlarını açın
2. **Model** alanını farklı bir modelle değiştirin
3. Kaydedin ve yeni modelle sohbet etmeye devam edin

### Özel Zaman Aşımı

Büyük isteklerde zaman aşımı sorunları yaşıyorsanız:

1. VSCode ayarlarını açın (Cmd/Ctrl + ,)
2. "Cline timeout" ifadesini arayın
3. Zaman aşımı değerini artırın (varsayılan genellikle 30 saniyedir)

## En İyi Uygulamalar

1. **Uygun Modelleri Kullanın**: Basit görevler için daha hızlı modelleri (Haiku veya Flash gibi), karmaşık görevler için daha güçlü modelleri (Opus veya GPT-4 gibi) seçin
2. **Kullanımı İzleyin**: Kullanım istatistikleri ve maliyetler için 9Router panelini kontrol edin
3. **Bağlam Yönetimi**: Token kullanımını azaltmak için sohbetlerinizi odaklı tutun
4. **Model Değiştirme**: Maliyet ve performansı optimize etmek için görev karmaşıklığına göre model değiştirin
5. **API Anahtarı Güvenliği**: API anahtarınızı asla sürüm kontrolüne işlemeyin

## 9Router Özellikleriyle Entegrasyon

### Model Yönlendirme

9Router isteklerinizi şunlara göre mevcut en iyi sağlayıcıya otomatik olarak yönlendirir:
- Model kullanılabilirliği
- Sağlayıcı sağlık durumu
- Maliyet optimizasyonu
- Yük dengeleme

### Yedek Geçiş (fallback) Desteği

Bir sağlayıcı arızalanırsa 9Router, panelinizde yapılandırılmış alternatif sağlayıcılara otomatik olarak yedek geçiş yapar.

### Kullanım Takibi

Cline kullanımınızı 9Router panelinden izleyin:
- Toplam istek
- Token kullanımı
- Model başına maliyet
- Sağlayıcı dağılımı
