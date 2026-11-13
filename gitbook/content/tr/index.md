# 9Router'a Hoş Geldiniz

**Claude, Codex, Gemini'yi ÜCRETSİZ kullanın • $0.20/1M token'dan başlayan ultra ucuz alternatifler**

9Router, akıllı yönlendirme ve otomatik yedek geçiş (fallback) ile abonelik değerinizi en üst düzeye çıkaran ve maliyetleri en aza indiren bir AI model yönlendiricisidir.

---

## 9Router nedir?

9Router, kodlama araçlarınız (Cursor, Cline, Claude Desktop) ile AI sağlayıcıları arasında duran akıllı bir proxy'dir. İstekleri kota, maliyet ve kullanılabilirliğe göre otomatik olarak en uygun modele yönlendirir.

**Para israfını bırakın:**
- ❌ Abonelik kotası her ay kullanılmadan sona eriyor
- ❌ Hız sınırları sizi kod yazarken durduruyor
- ❌ Pahalı API'ler (sağlayıcı başına $20-50/ay)
- ❌ Sağlayıcılar arasında elle geçiş

**Değeri en üst düzeye çıkarmaya başlayın:**
- ✅ **Aboneliklerden maksimum verim** - Claude Code, Codex, Gemini kotasının her bitini izleyin ve kullanın
- ✅ **ÜCRETSİZ kullanılabilir** - iFlow, Qwen, Kiro modellerine CLI üzerinden erişin
- ✅ **Ultra ucuz yedek** - GLM ($0.6/1M), MiniMax M2.1 ($0.20/1M)
- ✅ **Akıllı yedek geçiş** - Abonelik → Ucuz → Ücretsiz, otomatik geçiş

---

## Öne çıkan özellikler

### 🔄 Akıllı 3 katmanlı yedek geçiş

```
Bir kez kurun, kod yazmayı hiç bırakmayın:

Katman 1 (ABONELİK): Claude Code → Codex → Gemini
  ↓ kota tükendi
Katman 2 (UCUZ): GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ bütçe sınırı
Katman 3 (ÜCRETSİZ): iFlow → Qwen → Kiro

→ Otomatik geçiş, sıfır kesinti!
```

### 📊 Kota takibi

- Sağlayıcı başına gerçek zamanlı token tüketimi
- Sıfırlama geri sayımı (5 saatlik, günlük, haftalık, aylık)
- Ücretli katmanlar için maliyet tahmini
- Aylık harcama raporları

### 🎯 Evrensel CLI desteği

Özel OpenAI uç noktalarını destekleyen her araçla çalışır:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **OpenAI uyumlu her araç**

### 💰 Maliyet optimizasyonu

**Gerçek örnek (ayda 100M token):**
```
60M Gemini CLI ile: $0 (ücretsiz katman)
30M Claude Code ile: $0 (zaten sahip olduğunuz abonelik)
8M GLM ile: $4.80
2M MiniMax ile: $0.40
Total: $5.20/ay vs ChatGPT API'de $2000!
```

---

## Neden 9Router?

### Aboneliklerden maksimum verim

Zaten Claude Code ($20-100/ay) veya Codex ($20-200/ay) için ödeme yapıyor musunuz? Karşılığını tam alın:

- Kota kullanımını gerçek zamanlı izleyin
- Kota yenilendiğinde otomatik geçiş yapın (5 saatlik, haftalık)
- Her tokenı süresi dolmadan kullanın
- Gemini CLI: ayda 180K tamamlama **ÜCRETSİZ**

### Ultra ucuz yedek

Abonelik kotası bitince kuruşlar ödeyin:

| Sağlayıcı | 1M token maliyeti | Yenilenme |
|----------|-------------------|-------|
| **GLM-4.7** | $0.60 giriş / $2.20 çıkış | Günlük 10:00 |
| **MiniMax M2.1** | $0.20 giriş / $1.00 çıkış | 5 saatlik kayan |
| **Kimi K2** | $9/ay (10M token) | Aylık |

**ChatGPT API'den ($20/1M) ~%90 daha ucuz!**

### Sonsuza kadar ücretsiz yedek geçiş

Diğer her şey kotaya takıldığında acil yedek:

- **iFlow**: 8 model (Kimi K2, Qwen3 Coder Plus, GLM 4.7, MiniMax M2)
- **Qwen**: 3 model (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: Claude Sonnet 4.5, Haiku 4.5 (AWS Builder ID)

---

## Hızlı başlangıç

2 dakikada başlayın:

```bash
# Global olarak kurun
npm install -g 9router

# Başlatın (panel otomatik açılır)
9router
```

🎉 **Panel açılır** → Sağlayıcıları bağlayın → Kod yazmaya başlayın!

**CLI aracınızda kullanın:**

```
Endpoint: http://localhost:20128/v1
API Key: [panelden]
Model: cc/claude-opus-4-5-20251101
```

[→ Tam başlangıç kılavuzu](getting-started.md)

---

## Kullanım senaryoları

### Bireysel geliştiriciler için

- Claude Code/Codex aboneliğinizden maksimum verim alın
- Gemini CLI ücretsiz katmanını kullanın (ayda 180K)
- Ultra ucuz modellere yedek geçiş yapın ($0.20/1M)
- Hız sınırı olmadan 7/24 kod yazın

### Ekipler için

- Ortak erişim için VPS/Cloud üzerine kurun
- Ekip harcamalarını gerçek zamanlı izleyin
- Katman başına bütçe sınırı belirleyin
- Merkezi sağlayıcı yönetimi

### Mobil/uzaktan kodlama için

- Bulut dağıtımını kullanın (https://9router.com)
- iPad'den, telefondan, her yerden erişin
- localhost kısıtlamaları yok
- Cloudflare edge ağı (300+ konum)

---

## Sırada ne var?

- [Başlangıç](getting-started.md) - 5 dakikada kurun ve yapılandırın
- [Kurulum kılavuzu](getting-started/installation.md) - Ayrıntılı kurulum talimatları
- [Özellikler](features/) - Tüm özellikleri keşfedin
- [SSS](faq.md) - Sık sorulan sorular

---

<div align="center">
  <sub>AI değerini en üst düzeye çıkaran geliştiriciler için ❤️ ile yapıldı</sub>
</div>
