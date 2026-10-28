# Sorun Giderme

9Router kullanırken sık karşılaşılan sorunlar ve çözümleri.

---

## "Language model did not provide messages"

**Sorun:** İstek boş yanıt veya hata mesajıyla başarısız olur.

**Nedenler:**
- Sağlayıcı kotası tükendi
- API anahtarı geçersiz veya süresi dolmuş
- Model kullanılamıyor

**Çözümler:**

1. **Kota durumunu kontrol edin:**
   ```
   Dashboard → Providers → Kota izleyicisini görüntüleyin
   ```
   Kota tükendiyse sıfırlamayı bekleyin veya sağlayıcıyı değiştirin.

2. **Kombo yedek geçişini (fallback) kullanın:**
   ```
   Dashboard → Combos → Yedek geçiş zinciri oluşturun
   Örnek: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **Sağlayıcı bağlantısını doğrulayın:**
   ```
   Dashboard → Providers → Gerekirse yeniden bağlanın
   ```

---

## Hız Sınırı

**Sorun:** "Rate limit exceeded" veya "Too many requests" hataları.

**Nedenler:**
- Abonelik kotası tükendi (5 saatlik/günlük/haftalık sınırlar)
- API hız sınırlarına takıldı
- Çok fazla eşzamanlı istek

**Çözümler:**

1. **Sıfırlama zamanını kontrol edin:**
   ```
   Dashboard → Quota Tracking → Sıfırlama geri sayımını görüntüleyin
   ```

2. **Ucuz katmana geçin:**
   ```
   Kullanın: glm/glm-4.7 ($0.6/1M tokens)
             minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Yedek geçiş kombosu ekleyin:**
   ```
   Dashboard → Combos → Yedek modeller ekleyin
   Birincil: cc/claude-opus (abonelik)
   Yedek: glm/glm-4.7 (ucuz)
   Acil: if/kimi-k2 (ücretsiz)
   ```

---

## OAuth Token Süresi Doldu

**Sorun:** "Unauthorized" veya "Token expired" hataları.

**Nedenler:**
- OAuth tokenının süresi doldu (otomatik yenileme başarısız)
- Sağlayıcı oturumu geçersiz kılındı
- Yenileme sırasında ağ sorunları

**Çözümler:**

1. **Otomatik yenileme (varsayılan):**
   9Router tokenları otomatik yeniler. 30 saniye bekleyip yeniden deneyin.

2. **Elle yeniden bağlanma:**
   ```
   Dashboard → Providers → [Sağlayıcı Adı] → Reconnect
   → OAuth akışını yeniden tamamlayın
   ```

3. **Sağlayıcı durumunu kontrol edin:**
   Sağlayıcı hizmetinin çevrimiçi olduğunu doğrulayın (Claude Code, Codex, vb.)

---

## Yüksek Maliyetler

**Sorun:** Beklenmedik yüksek kullanım veya maliyetler.

**Nedenler:**
- Pahalı modellerin gereksiz kullanımı
- Daha ucuz katmanlara yedek geçiş olmaması
- Büyük bağlam pencereleri

**Çözümler:**

1. **Kullanım istatistiklerini kontrol edin:**
   ```
   Dashboard → Usage Stats → Token tüketimini görüntüleyin
   → Yüksek maliyetli modelleri belirleyin
   ```

2. **Daha ucuz modellere geçin:**
   ```
   Değiştirin: cc/claude-opus ($20-100/ay abonelik)
   Şununla: glm/glm-4.7 ($0.6/1M tokens)
            minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Ücretsiz katmanı kullanın:**
   ```
   if/kimi-k2-thinking (ÜCRETSİZ)
   qw/qwen3-coder-plus (ÜCRETSİZ)
   kr/claude-sonnet-4.5 (ÜCRETSİZ)
   gc/gemini-3-flash-preview (ÜCRETSİZ 180K/ay)
   ```

4. **Promptları optimize edin:**
   - Bağlam boyutunu küçültün
   - Uzun yanıtlarda akış kullanın
   - Sık kullanılan promptları önbelleğe alın

---

## Bağlantı Reddedildi

**Sorun:** "ECONNREFUSED" veya "Cannot connect to localhost:20128" hataları.

**Nedenler:**
- 9Router çalışmıyor
- 20128 portu engelli
- Güvenlik duvarı bağlantıyı engelliyor

**Çözümler:**

1. **9Router'ı başlatın:**
   ```bash
   9router
   ```
   Panel http://localhost:3000 adresinde açılmalıdır.

2. **20128 portunu doğrulayın:**
   ```bash
   # Port dinleniyor mu kontrol edin
   lsof -i :20128
   
   # Windows'ta
   netstat -ano | findstr :20128
   ```

3. **Güvenlik duvarını kontrol edin:**
   - macOS: System Settings → Network → Firewall
   - Windows: Windows Defender Firewall → Allow app
   - Linux: `sudo ufw allow 20128`

4. **Bulut uç noktasını kullanın:**
   localhost çalışmıyorsa (örn. Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## Panel Açılmıyor

**Sorun:** Panel http://localhost:3000 adresinde yüklenmiyor.

**Nedenler:**
- 3000 portu zaten kullanımda
- 9Router çöktü
- Tarayıcı önbelleği sorunları

**Çözümler:**

1. **9Router'ın çalışıp çalışmadığını kontrol edin:**
   ```bash
   # Süreci kontrol edin
   ps aux | grep 9router
   
   # 3000 portunu kontrol edin
   lsof -i :3000
   ```

2. **Çakışan süreci sonlandırın:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **9Router'ı yeniden başlatın:**
   ```bash
   # Durdurun
   pkill -f 9router
   
   # Başlatın
   9router
   ```

4. **Tarayıcı önbelleğini temizleyin:**
   - Chrome: Ctrl+Shift+Delete → Önbelleği temizle
   - Gizli modu deneyin

5. **Güvenlik duvarı ayarlarını kontrol edin:**
   3000 portunun engellenmediğinden emin olun.

---

## Model Bulunamadı

**Sorun:** "Model not found" veya "Invalid model" hataları.

**Nedenler:**
- Sağlayıcı bağlı değil
- Model ID yazım hatası
- Sağlayıcı etkin değil

**Çözümler:**

1. **Sağlayıcı bağlantısını doğrulayın:**
   ```
   Dashboard → Providers → Durumu kontrol edin (yeşil = etkin)
   ```

2. **Model ID biçimini kontrol edin:**
   ```
   Doğru: cc/claude-opus-4-5-20251101
   Yanlış: claude-opus-4-5-20251101
   
   Biçim: [provider-prefix]/[model-name]
   ```

3. **Kullanılabilir modelleri listeleyin:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **Sağlayıcıyı yeniden bağlayın:**
   ```
   Dashboard → Providers → [Sağlayıcı] → Reconnect
   ```

---

## Yavaş Yanıt

**Sorun:** İstekler çok uzun sürüyor veya zaman aşımına uğruyor.

**Nedenler:**
- Sağlayıcı gecikmesi
- Ağ sorunları
- Büyük bağlam/yanıt
- Sağlayıcı hız sınırlaması

**Çözümler:**

1. **Sağlayıcı durumunu kontrol edin:**
   ```
   Dashboard → Providers → Gecikme istatistiklerini görüntüleyin
   ```

2. **Daha hızlı bir modele geçin:**
   ```
   Hızlı: cc/claude-haiku-4-5 (Haiku, Opus'tan hızlıdır)
          gc/gemini-3-flash-preview
          qw/qwen3-coder-flash
   ```

3. **Akışı kullanın:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **Ağı kontrol edin:**
   ```bash
   # Gecikmeyi test edin
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **Bağlam boyutunu küçültün:**
   - Mesaj geçmişini kısaltın
   - Daha küçük promptlar kullanın
   - CLI aracında bağlam budamayı etkinleştirin

---

## API Anahtarı Geçersiz

**Sorun:** "Invalid API key" veya "Authentication failed" hataları.

**Nedenler:**
- Yanlış API anahtarı kopyalandı
- API anahtarının süresi doldu
- API anahtarı oluşturulmadı

**Çözümler:**

1. **API anahtarını yeniden oluşturun:**
   ```
   Dashboard → Settings → API Keys → Generate New Key
   → Yeni anahtarı kopyalayıp kullanın
   ```

2. **Anahtar biçimini doğrulayın:**
   ```
   Doğru: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   Yanlış: 9r_ öneki eksik
   ```

3. **CLI yapılandırmasındaki anahtarı kontrol edin:**
   ```bash
   # Cursor
   Settings → Models → OpenAI API Key
   
   # Cline
   Settings → API Key
   
   # Ortam değişkeni
   export OPENAI_API_KEY="9r_your_key"
   ```

4. **API anahtarını test edin:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer 9r_your_key"
   ```

---

## Daha Fazla Yardım?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Dokümantasyon:** [9router.com/docs](https://9router.com/docs)
- **SSS:** [faq.md](faq.md)
