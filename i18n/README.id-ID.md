<div align="center">
  <img src="../images/10router.png?1" alt="10router Dashboard" width="800"/>

  # 10router - Router AI Gratis

  **Jangan berhenti ngoding. Otomatis dialihkan ke model AI gratis & murah dengan smart fallback.**

  **Hubungkan semua tool AI coding (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) ke 40+ provider AI dan 100+ model.**

  [![npm](https://img.shields.io/npm/v/10router.svg)](https://www.npmjs.com/package/10router)
  [![Downloads](https://img.shields.io/npm/dm/10router.svg)](https://www.npmjs.com/package/10router)
  [![License](https://img.shields.io/npm/l/10router.svg)](https://github.com/some-du6e/10router/blob/main/LICENSE)

  [🚀 Mulai Cepat](#-mulai-cepat) • [💡 Fitur](#-fitur-utama) • [📖 Setup](#-panduan-setup)

  [🇻🇳 Tiếng Việt](./README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./README.ja-JP.md) • [🇮🇩 Bahasa Indonesia](./README.id-ID.md)
</div>

---

## 🤔 Kenapa 10router?

**Berhenti buang-buang uang dan terhambat limit:**

- ❌ Kuota langganan hangus tiap bulan tanpa terpakai
- ❌ Rate limit bikin ngoding berhenti di tengah jalan
- ❌ API mahal ($20–50/bulan per provider)
- ❌ Harus gonta-ganti provider secara manual

**10router menyelesaikan itu semua:**

- ✅ **Maksimalkan langganan** - lacak kuota dan habiskan sebelum reset
- ✅ **Fallback otomatis** - langganan → murah → gratis, tanpa downtime
- ✅ **Multi-akun** - round-robin antar akun untuk tiap provider
- ✅ **Universal** - mendukung Claude Code, Codex, Gemini CLI, Cursor, Cline, dan tool CLI apa pun

---

## 🔄 Cara Kerja

```
┌─────────────┐
│   Tool CLI  │  (Claude Code, Codex, Gemini CLI, OpenClaw, Cursor, Cline...)
│    kamu     │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────┐
│         10router (Smart Router)          │
│  • Konversi format (OpenAI ↔ Claude)    │
│  • Pelacakan kuota                      │
│  • Refresh token otomatis               │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1: Langganan] Claude Code, Codex, Gemini CLI
       │   ↓ kuota habis
       ├─→ [Tier 2: Murah] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ batas budget tercapai
       └─→ [Tier 3: Gratis] iFlow, Qwen, Kiro (unlimited)

Hasil: ngoding tanpa berhenti, biaya minimum
```

---

## ⚡ Mulai Cepat

**1. Install secara global:**

```bash
npm install -g 10router
10router
```

🎉 Dashboard terbuka di `http://localhost:20128`

**2. Hubungkan provider gratis (tanpa perlu daftar):**

Dashboard → Providers → hubungkan **Claude Code** atau **Antigravity** → login OAuth → selesai!

**3. Pakai di tool CLI kamu:**

```
Konfigurasi Claude Code/Codex/Gemini CLI/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [salin dari dashboard]
  Model: if/kimi-k2-thinking
```

**Cuma itu!** Mulai ngoding dengan model AI gratis.

**Alternatif: jalankan dari source (repo ini):**

Paket repo ini bersifat privat (`10router-app`), jadi menjalankan dari source/Docker adalah jalur yang diharapkan untuk pengembangan lokal.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Mode produksi:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URL default:
- Dashboard: `http://localhost:20128/dashboard`
- API kompatibel OpenAI: `http://localhost:20128/v1`

---

## 🎥 Video Tutorial

<div align="center">

### 📺 Panduan Setup Lengkap - 10router + Claude Code Gratis

[![10router + Claude Code Setup](https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg)](https://www.youtube.com/watch?v=raEyZPg5xE0)

**🎬 Tonton tutorial langkah demi langkah:**
- ✅ Install dan setup 10router
- ✅ Konfigurasi Claude Sonnet 4.5 gratis
- ✅ Integrasi dengan Claude Code
- ✅ Demo live coding

**⏱️ Durasi:** 20 menit | **👥 Dibuat oleh:** Developer Community

[▶️ Tonton di YouTube](https://www.youtube.com/watch?v=o3qYCyjrFYg)

</div>

---

## 🛠️ Tool CLI yang Didukung

10router bekerja mulus dengan semua tool AI coding utama:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 Provider yang Didukung

### 🔐 Provider OAuth

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Provider Gratis

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/iflow.png" width="70" alt="iFlow"/><br/>
        <b>iFlow AI</b><br/>
        <sub>8+ model • unlimited</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/qwen.png" width="70" alt="Qwen"/><br/>
        <b>Qwen Code</b><br/>
        <sub>3+ model • unlimited</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini-cli.png" width="70" alt="Gemini CLI"/><br/>
        <b>Gemini CLI</b><br/>
        <sub>180 ribu request/bulan gratis</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude • unlimited</sub>
      </td>
    </tr>
  </table>
</div>

### 🔑 Provider API Key (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...dan 20+ provider lain seperti Nebius, Chutes, Hyperbolic, serta endpoint custom yang kompatibel dengan OpenAI/Anthropic</i></p>
</div>

---

## 💡 Fitur Utama

| Fitur | Ringkasan | Manfaat |
|-------|-----------|---------|
| 🎯 **Smart Fallback 3 Tingkat** | Routing otomatis: langganan → murah → gratis | Ngoding tanpa berhenti, zero downtime |
| 📊 **Pelacakan Kuota Real-time** | Hitungan token live + hitung mundur reset | Nilai langganan termanfaatkan maksimal |
| 🔄 **Konversi Format** | OpenAI ↔ Claude ↔ Gemini mulus | Bekerja dengan tool CLI apa pun |
| 👥 **Dukungan Multi-akun** | Beberapa akun per provider | Load balancing + redundansi |
| 🔄 **Auto Refresh Token** | Token OAuth diperbarui otomatis | Tidak perlu login ulang manual |
| 🎨 **Combo Kustom** | Buat kombinasi model tanpa batas | Fallback sesuai kebutuhanmu |
| 📝 **Log Request** | Log lengkap request/response | Troubleshooting jadi mudah |
| 💾 **Cloud Sync** | Sinkronkan pengaturan antar perangkat | Setup sama di mana pun |
| 📊 **Analitik Penggunaan** | Lacak token, biaya, dan tren | Optimalkan pengeluaran |
| 🌐 **Deploy di Mana Saja** | Localhost, VPS, Docker, Cloudflare Workers | Opsi deployment fleksibel |

<details>
<summary><b>📖 Detail Fitur</b></summary>

### 🎯 Smart Fallback 3 Tingkat

Buat combo dengan fallback otomatis:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (langganan)
  2. glm/glm-4.7               (backup murah, $0.6/1M)
  3. if/kimi-k2-thinking       (fallback gratis)

→ Otomatis beralih saat kuota habis atau terjadi error
```

### 📊 Pelacakan Kuota Real-time

- Konsumsi token per provider
- Hitung mundur reset (5 jam, harian, mingguan)
- Estimasi biaya untuk tier berbayar
- Laporan pengeluaran bulanan

### 🔄 Konversi Format

Konversi mulus antar format:
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **OpenAI Responses**
- Tool CLI mengirim dalam format OpenAI → 10router mengonversi → provider menerima dalam format nativenya
- Bekerja dengan semua tool yang mendukung custom OpenAI endpoint

### 👥 Dukungan Multi-akun

- Tambahkan beberapa akun per provider
- Round-robin otomatis atau routing berbasis prioritas
- Saat satu akun mencapai kuota, fallback ke akun berikutnya

### 🔄 Auto Refresh Token

- Token OAuth di-refresh otomatis sebelum kedaluwarsa
- Tidak perlu autentikasi ulang manual
- Pengalaman mulus di semua provider

### 🎨 Combo Kustom

- Buat kombinasi model tanpa batas
- Campur tier langganan, murah, dan gratis
- Beri nama combo agar mudah diakses
- Bagikan combo antar perangkat lewat cloud sync

### 📝 Log Request

- Log lengkap request/response dalam mode debug
- Lacak API call, header, dan payload
- Troubleshoot masalah integrasi
- Ekspor log untuk dianalisis

### 💾 Cloud Sync

- Sinkronkan provider, combo, dan pengaturan antar perangkat
- Sinkronisasi latar belakang otomatis
- Penyimpanan terenkripsi yang aman
- Akses setup dari mana saja

#### Catatan tentang cloud runtime

- Untuk produksi, disarankan memakai variabel cloud sisi server:
  - `BASE_URL` (URL callback internal yang dipakai scheduler sinkronisasi)
  - `CLOUD_URL` (base URL endpoint cloud sync)
- `NEXT_PUBLIC_BASE_URL` dan `NEXT_PUBLIC_CLOUD_URL` masih didukung untuk kompatibilitas/UI, tetapi runtime server memprioritaskan `BASE_URL`/`CLOUD_URL`.
- Request cloud sync memakai timeout + perilaku fail-fast untuk menghindari UI menggantung saat DNS/jaringan cloud tidak tersedia.

### 📊 Analitik Penggunaan

- Lacak pemakaian token per provider dan per model
- Estimasi biaya dan tren pengeluaran
- Laporan dan insight bulanan
- Optimalkan pengeluaran AI

> **💡 PENTING - tentang biaya di dashboard:**
>
> "Biaya" yang ditampilkan pada analitik penggunaan **hanya untuk pelacakan dan perbandingan**.
> 10router sendiri **tidak menagih apa pun**. Kamu hanya membayar langsung ke provider jika memakai layanan berbayar.
>
> **Contoh:** jika dashboard menampilkan "Total biaya $290" untuk pemakaian model iFlow,
> itu adalah jumlah yang seharusnya kamu bayar bila memakai API berbayar secara langsung. Biaya sebenarnya = **$0** (iFlow gratis tanpa batas).
>
> Anggap saja ini "pelacak penghematan" yang menunjukkan berapa banyak yang kamu hemat lewat model gratis dan routing 10router!

### 🌐 Deploy di Mana Saja

- 💻 **Localhost** - default, jalan offline
- ☁️ **VPS/Cloud** - berbagi antar perangkat
- 🐳 **Docker** - deploy satu perintah
- 🚀 **Cloudflare Workers** - jaringan edge global

</details>

---

## 💰 Ringkasan Harga

| Tier | Provider | Biaya | Reset Kuota | Cocok Untuk |
|------|----------|-------|-------------|-------------|
| **💳 Langganan** | Claude Code (Pro) | $20/bulan | 5 jam + mingguan | Yang sudah punya langganan |
| | Codex (Plus/Pro) | $20-200/bulan | 5 jam + mingguan | Pengguna OpenAI |
| | Gemini CLI | **Gratis** | 180rb/bulan + 1rb/hari | Semua orang! |
| | GitHub Copilot | $10-19/bulan | Bulanan | Pengguna GitHub |
| **💰 Murah** | GLM-4.7 | $0.6/1M | Setiap hari jam 10.00 | Backup hemat |
| | MiniMax M2.1 | $0.2/1M | Rolling 5 jam | Opsi paling murah |
| | Kimi K2 | $9/bulan flat | 10 juta token/bulan | Biaya yang bisa diprediksi |
| **🆓 Gratis** | iFlow | $0 | Unlimited | 8 model gratis |
| | Qwen | $0 | Unlimited | 3 model gratis |
| | Kiro | $0 | Unlimited | Claude gratis |

**💡 Tips pro:** combo Gemini CLI (180rb request/bulan gratis) + iFlow (gratis unlimited) = biaya $0!

---

### 📊 Tentang Biaya dan Penagihan 10router

**Fakta soal penagihan 10router:**

✅ **Software 10router = gratis selamanya** (open source, tanpa tagihan)
✅ **"Biaya" di dashboard = tampilan/pelacakan saja** (bukan tagihan sungguhan)
✅ **Pembayaran langsung ke provider** (langganan atau biaya API)
✅ **Provider gratis tetap gratis** (iFlow, Kiro, Qwen = $0 unlimited)
❌ **10router tidak mengirim invoice** atau menagih kartumu

**Cara kerja tampilan biaya:**

Dashboard menampilkan **estimasi biaya** seandainya kamu memakai API berbayar secara langsung. Ini **bukan tagihan**, melainkan alat pembanding yang menunjukkan penghematanmu.

**Contoh skenario:**
```
Tampilan dashboard:
• Total request: 1.662
• Total token: 47 juta
• Biaya tertampil: $290

Kenyataannya:
• Provider: iFlow (gratis unlimited)
• Yang benar-benar dibayar: $0.00
• Arti $290: jumlah yang kamu hemat dengan memakai model gratis!
```

**Aturan pembayaran:**
- **Provider langganan** (Claude Code, Codex): bayar langsung di website masing-masing
- **Provider murah** (GLM, MiniMax): bayar langsung, 10router hanya melakukan routing
- **Provider gratis** (iFlow, Kiro, Qwen): benar-benar gratis selamanya, tanpa biaya tersembunyi
- **10router**: tidak menagih apa pun

---

## 🎯 Studi Kasus

### Kasus 1: "Saya punya langganan Claude Pro"

**Masalah:** kuota hangus tanpa terpakai, kena rate limit saat ngoding berat

**Solusi:**
```
Combo: "maximize-claude"
  1. cc/claude-opus-4-6        (manfaatkan langganan semaksimal mungkin)
  2. glm/glm-4.7               (backup murah saat kuota habis)
  3. if/kimi-k2-thinking       (fallback darurat gratis)

Biaya bulanan: $20 (langganan) + ~$5 (backup) = total $25
vs. $20 + kena limit = frustrasi
```

### Kasus 2: "Saya mau biaya nol"

**Masalah:** tidak mampu bayar langganan, tapi butuh AI coding yang andal

**Solusi:**
```
Combo: "free-forever"
  1. gc/gemini-3-flash         (180rb request/bulan gratis)
  2. if/kimi-k2-thinking       (gratis unlimited)
  3. qw/qwen3-coder-plus       (gratis unlimited)

Biaya bulanan: $0
Kualitas: model siap produksi
```

### Kasus 3: "Ngoding 24/7 tanpa terputus"

**Masalah:** deadline mepet, downtime tidak dapat ditoleransi

**Solusi:**
```
Combo: "always-on"
  1. cc/claude-opus-4-6        (kualitas terbaik)
  2. cx/gpt-5.2-codex          (langganan kedua)
  3. glm/glm-4.7               (murah, reset harian)
  4. minimax/MiniMax-M2.1      (paling murah, reset 5 jam)
  5. if/kimi-k2-thinking       (gratis unlimited)

Hasil: 5 lapis fallback = zero downtime
Biaya bulanan: $20-200 (langganan) + $10-20 (backup)
```

### Kasus 4: "Saya mau pakai AI gratis di OpenClaw"

**Masalah:** butuh asisten AI di aplikasi pesan (WhatsApp, Telegram, Slack...), sepenuhnya gratis

**Solusi:**
```
Combo: "openclaw-free"
  1. if/glm-4.7                (gratis unlimited)
  2. if/minimax-m2.1           (gratis unlimited)
  3. if/kimi-k2-thinking       (gratis unlimited)

Biaya bulanan: $0
Cara akses: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ FAQ

<details>
<summary><b>📊 Kenapa dashboard menampilkan biaya yang besar?</b></summary>

Dashboard melacak pemakaian token dan menampilkan **estimasi biaya** seandainya kamu memakai API berbayar secara langsung. Ini **bukan tagihan nyata**, melainkan acuan untuk melihat berapa banyak yang kamu hemat dengan memakai model gratis atau langganan yang sudah ada lewat 10router.

**Contoh:**
- **Tampilan dashboard:** "Total biaya $290"
- **Kenyataan:** sedang memakai iFlow (gratis unlimited)
- **Biaya sebenarnya:** **$0.00**
- **Arti $290:** jumlah yang **dihemat** karena memakai model gratis alih-alih API berbayar!

Tampilan biaya adalah "pelacak penghematan" untuk memahami pola pemakaian dan peluang optimasi.

</details>

<details>
<summary><b>💳 Apakah 10router menagih saya?</b></summary>

**Tidak.** 10router adalah software open source gratis yang berjalan di komputermu sendiri. Tidak ada penagihan sama sekali.

**Kamu membayar ke:**
- ✅ **Provider langganan** (Claude Code $20/bulan, Codex $20-200/bulan) → bayar langsung di website masing-masing
- ✅ **Provider murah** (GLM, MiniMax) → bayar langsung, 10router hanya me-routing request
- ❌ **10router sendiri** → **tidak menagih apa pun**

10router adalah proxy/router lokal. Ia tidak menyimpan informasi kartu kredit, tidak bisa mengirim invoice, dan tidak punya sistem penagihan. Sepenuhnya software gratis.

</details>

<details>
<summary><b>🆓 Apakah provider gratis benar-benar unlimited?</b></summary>

**Ya!** Provider yang ditandai gratis (iFlow, Kiro, Qwen) benar-benar unlimited dan **tanpa biaya tersembunyi**.

Ini adalah layanan gratis yang disediakan masing-masing perusahaan:
- **iFlow**: akses gratis unlimited ke 8+ model via OAuth
- **Kiro**: model Claude gratis unlimited via AWS Builder ID
- **Qwen**: akses gratis unlimited ke model Qwen via device authentication

10router hanya me-routing request — tidak ada "jebakan" atau tagihan di kemudian hari. Layanannya memang gratis, dan 10router membuatnya lebih mudah dipakai dengan dukungan fallback.

**Catatan:** beberapa provider langganan (Antigravity, GitHub Copilot) punya masa preview gratis dan bisa jadi berbayar nanti, tetapi hal itu diumumkan secara jelas oleh provider tersebut, bukan oleh 10router.

</details>

<details>
<summary><b>💰 Bagaimana cara menekan biaya AI seminimal mungkin?</b></summary>

**Strategi free-first:**

1. **Mulai dari combo 100% gratis:**
   ```
   1. gc/gemini-3-flash (180rb/bulan gratis dari Google)
   2. if/kimi-k2-thinking (gratis unlimited dari iFlow)
   3. qw/qwen3-coder-plus (gratis unlimited dari Qwen)
   ```
   **Biaya: $0/bulan**

2. **Tambahkan backup murah hanya bila perlu:**
   ```
   4. glm/glm-4.7 ($0.6 per 1 juta token)
   ```
   **Tambahan biaya: bayar sesuai pemakaian saja**

3. **Gunakan provider langganan paling akhir:**
   - Hanya jika kamu memang sudah punya
   - 10router memaksimalkan nilainya lewat pelacakan kuota

**Hasil:** sebagian besar pengguna bisa jalan dengan $0/bulan hanya dengan tier gratis!

</details>

<details>
<summary><b>📈 Bagaimana kalau pemakaian tiba-tiba melonjak?</b></summary>

Smart fallback 10router mencegah tagihan tak terduga:

**Skenario:** kuota habis di tengah sprint coding

**Tanpa 10router:**
- ❌ Kena rate limit → kerja berhenti → frustrasi
- ❌ Atau: tagihan API mahal tanpa disengaja

**Dengan 10router:**
- ✅ Langganan mencapai batas → otomatis fallback ke tier murah
- ✅ Tier murah jadi mahal → otomatis fallback ke tier gratis
- ✅ Ngoding tidak berhenti → biaya tetap terprediksi

**Kamu yang pegang kendali:** atur batas pengeluaran per provider di dashboard, dan 10router akan mematuhinya.

</details>

---

## 📖 Panduan Setup

<details>
<summary><b>🔐 Provider Langganan (maksimalkan nilainya)</b></summary>

### Claude Code (Pro/Max)

```bash
Dashboard → Providers → hubungkan Claude Code
→ login OAuth → refresh token otomatis
→ pelacakan kuota 5 jam + mingguan

Model:
  cc/claude-opus-4-6
  cc/claude-sonnet-4-5-20250929
  cc/claude-haiku-4-5-20251001
```

**Tips pro:** pakai Opus untuk tugas kompleks, Sonnet kalau mengutamakan kecepatan. 10router melacak kuota per model!

### OpenAI Codex (Plus/Pro)

```bash
Dashboard → Providers → hubungkan Codex
→ login OAuth (port 1455)
→ reset 5 jam + mingguan

Model:
  cx/gpt-5.2-codex
  cx/gpt-5.1-codex-max
```

### Gemini CLI (180rb request/bulan gratis!)

```bash
Dashboard → Providers → hubungkan Gemini CLI
→ Google OAuth
→ 180rb/bulan + 1rb/hari

Model:
  gc/gemini-3-flash-preview
  gc/gemini-2.5-pro
```

**Value terbaik:** free tier-nya besar sekali! Pakai ini sebelum tier berbayar.

### GitHub Copilot

```bash
Dashboard → Providers → hubungkan GitHub
→ OAuth via GitHub
→ reset bulanan (tanggal 1 tiap bulan)

Model:
  gh/gpt-5
  gh/claude-4.5-sonnet
  gh/gemini-3-pro
```

</details>

<details>
<summary><b>💰 Provider Murah (backup)</b></summary>

### GLM-4.7 (reset harian, $0.6/1M)

1. Daftar: [Zhipu AI](https://open.bigmodel.cn/)
2. Ambil API key dari Coding Plan
3. Dashboard → tambahkan API key:
   - Provider: `glm`
   - API Key: `your-key`

**Pemakaian:** `glm/glm-4.7`

**Tips pro:** Coding Plan memberi kuota 3x lipat dengan biaya 1/7! Reset setiap hari jam 10.00.

### MiniMax M2.1 (reset 5 jam, $0.20/1M)

1. Daftar: [MiniMax](https://www.minimax.io/)
2. Ambil API key
3. Dashboard → tambahkan API key

**Pemakaian:** `minimax/MiniMax-M2.1`

**Tips pro:** opsi termurah dengan konteks panjang (1 juta token)!

### Kimi K2 ($9/bulan flat)

1. Berlangganan: [Moonshot AI](https://platform.moonshot.ai/)
2. Ambil API key
3. Dashboard → tambahkan API key

**Pemakaian:** `kimi/kimi-latest`

**Tips pro:** $9/bulan flat untuk 10 juta token = biaya efektif $0.90/1M!

</details>

<details>
<summary><b>🆓 Provider Gratis (backup darurat)</b></summary>

### iFlow (8 model gratis)

```bash
Dashboard → hubungkan iFlow
→ login OAuth iFlow
→ pemakaian unlimited

Model:
  if/kimi-k2-thinking
  if/qwen3-coder-plus
  if/glm-4.7
  if/minimax-m2
  if/deepseek-r1
```

### Qwen (3 model gratis)

```bash
Dashboard → hubungkan Qwen
→ autentikasi device code
→ pemakaian unlimited

Model:
  qw/qwen3-coder-plus
  qw/qwen3-coder-flash
```

### Kiro (Claude gratis)

```bash
Dashboard → hubungkan Kiro
→ AWS Builder ID atau Google/GitHub
→ pemakaian unlimited

Model:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
```

</details>

<details>
<summary><b>🎨 Membuat Combo</b></summary>

### Contoh 1: maksimalkan langganan → backup murah

```
Dashboard → Combos → buat baru

Nama: premium-coding
Model:
  1. cc/claude-opus-4-6 (langganan, utama)
  2. glm/glm-4.7 (backup murah, $0.6/1M)
  3. minimax/MiniMax-M2.1 (fallback termurah, $0.20/1M)

Pemakaian di CLI: premium-coding

Contoh biaya bulanan (100 juta token):
  80 juta lewat Claude (langganan): tambahan $0
  15 juta lewat GLM: $9
  5 juta lewat MiniMax: $1
  Total: $10
```

### Contoh 2: combo 100% gratis

```
Nama: free-forever
Model:
  1. gc/gemini-3-flash (180rb request/bulan gratis)
  2. if/kimi-k2-thinking (gratis unlimited)
  3. qw/qwen3-coder-plus (gratis unlimited)
  4. kr/claude-sonnet-4.5 (gratis unlimited)

Biaya bulanan: $0
```

### Tips membuat combo

- Urutkan dari kualitas/prioritas tertinggi ke fallback paling murah
- Selalu taruh minimal satu provider gratis di posisi terakhir
- Pakai nama combo yang deskriptif agar mudah dipilih dari CLI
- Aktifkan cloud sync agar combo ikut tersedia di perangkat lain

</details>

---

## 🐳 Deployment

<details>
<summary><b>Docker</b></summary>

```bash
docker run -d \
  --name 10router \
  -p 20128:20128 \
  -v 10router-data:/app/data \
  -e PORT=20128 \
  -e BASE_URL=http://localhost:20128 \
  ghcr.io/some-du6e/10router:latest
```

Dashboard: `http://localhost:20128/dashboard`

</details>

<details>
<summary><b>VPS / Cloud</b></summary>

```bash
npm install -g 10router
PORT=20128 HOSTNAME=0.0.0.0 BASE_URL=https://your-domain.com 10router
```

Disarankan menaruhnya di belakang reverse proxy (Nginx/Caddy) dengan HTTPS, dan membatasi akses hanya untuk dirimu sendiri.

</details>

<details>
<summary><b>Cloudflare Workers</b></summary>

```bash
npm run build
npx wrangler deploy
```

Atur `BASE_URL` dan `CLOUD_URL` sebagai environment variable di dashboard Cloudflare.

</details>

---

## 🧪 Troubleshooting

| Masalah | Kemungkinan Penyebab | Solusi |
|---------|----------------------|--------|
| Tool CLI tidak bisa konek | Endpoint salah | Pastikan `http://localhost:20128/v1` |
| 401 / Unauthorized | API key salah | Salin ulang key dari dashboard |
| Model tidak ditemukan | Prefix provider salah | Pakai format `provider/model`, mis. `if/kimi-k2-thinking` |
| Selalu fallback ke gratis | Kuota langganan habis | Cek hitung mundur reset di dashboard |
| OAuth gagal | Port callback terpakai | Tutup proses lain (mis. port 1455 untuk Codex) |
| UI menggantung saat sync | DNS/jaringan cloud bermasalah | Cek `CLOUD_URL`; sync memakai timeout fail-fast |

Aktifkan mode debug di dashboard untuk melihat log lengkap request/response.

---

## 🤝 Kontribusi

Kontribusi sangat diterima!

1. Fork repo ini
2. Buat branch fitur (`git checkout -b feature/nama-fitur`)
3. Commit perubahanmu (`git commit -m 'feat: tambah fitur X'`)
4. Push ke branch (`git push origin feature/nama-fitur`)
5. Buka Pull Request

---

## 📄 Lisensi

MIT License — lihat [LICENSE](https://github.com/some-du6e/10router/blob/main/LICENSE) untuk detailnya.

---

<div align="center">

**Kalau 10router membantumu, kasih ⭐ di [GitHub](https://github.com/some-du6e/10router)!**

[📦 npm](https://www.npmjs.com/package/10router) • [🐛 Laporkan Bug](https://github.com/some-du6e/10router/issues)

</div>
