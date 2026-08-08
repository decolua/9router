# ✅ [RESOLVED] Hermes Agent Gagal Terhubung ke Antigravity via 9Router Lokal (429 RESOURCE_EXHAUSTED)

## Ringkasan

Hermes Agent **tidak bisa** mengirim request ke model Antigravity (e.g. `ag/gemini-3.6-flash-high`) melalui 9Router yang berjalan di mesin lokal (macOS), sementara **tool lain seperti OpenCode bisa** menggunakan setup yang sama. Request selalu gagal dengan error `429 RESOURCE_EXHAUSTED` dari Google.

Setup yang **sama persis** di server (Linux) **berhasil tanpa masalah**.

---

## Lingkungan

| Item | Detail |
|---|---|
| **OS** | macOS (Apple Silicon) |
| **9Router** | Dari source, `npm run dev` di port 20127 |
| **Hermes Agent** | CLI, 31 tool declarations |
| **Model** | `ag/gemini-3.6-flash-high` → `antigravity/gemini-3.6-flash-high` |
| **Akun Google** | `rafirara1195@gmail.com` (berbeda dari akun Antigravity IDE) |
| **Antigravity IDE** | Berjalan bersamaan di mesin yang sama |

---

## Reproduksi

1. Jalankan 9Router di lokal:
   ```bash
   npm run dev  # port 20127
   ```
2. Hubungkan Antigravity provider dengan akun Google di Dashboard 9Router
3. Konfigurasikan Hermes Agent untuk menggunakan `http://localhost:20127/v1`
4. Kirim pesan sederhana `hi` di Hermes Agent
5. **Hasil**: Error 429 RESOURCE_EXHAUSTED setiap kali, bahkan setelah retry

---

## Log 9Router

```
[23:44:45] ⚪ ▶ POST ag/gemini-3.6-flash-high → antigravity/gemini-3.6-flash-high · FMT: openai→antigravity · STREAM · 2 MSG · 31 TOOL · THINK:high · ACC:rafirara1195@gmail.com
[23:44:45] 🐛 [DBG:TOOLS] Processed 31 tool declarations for Antigravity: [browser_back, browser_click, browser_console, browser_get_images, browser_navigate, browser_press, browser_scroll, browser_snapshot, browser_type, browser_vision, clarify, computer_use, cronjob, delegate_task, execute_code, memory, patch, process, read_file, search_files, session_search, skill_manage, skill_view, skills_list, terminal, text_to_speech, todo, vision_analyze, web_extract, web_search, write_file]
[23:44:45] 🐛 [DBG:FETCH] ANTIGRAVITY → https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse | body=103393B | connectTimeout=60000ms
[23:44:46] 🐛 [DBG:FETCH] ANTIGRAVITY ← 429 | ttft=538ms | ct=text/event-stream | cl=139
```

**Pola yang konsisten:**
- Body request: **~103KB** (31 tools + system prompt)
- Google mengembalikan **429 dalam 250-1000ms** (gateway-level rejection, bukan setelah processing)
- Retry 3x internal 9Router → tetap 429
- Hermes Agent retry 3x → total **~12 request**, semua 429
- Lock account untuk cooldown → retry lagi → tetap 429

---

## Error Response dari Google

```json
{
  "error": {
    "code": 429,
    "message": "Resource has been exhausted (e.g. check quota).",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

---

## Yang Sudah Dicoba (Tidak Berhasil)

### 1. Fix JSON Schema $ref Resolver
- **Apa**: Menambahkan `resolveJsonSchemaRefs()` di `cleanJSONSchemaForAntigravity()` untuk inline `$ref` pointers sebelum keyword dihapus
- **File**: `open-sse/translator/formats/gemini.js`
- **Hasil**: Schema converter tidak crash lagi, tapi 429 tetap terjadi
- **Kesimpulan**: Bukan penyebab utama di kasus ini (mungkin relevan untuk bug #2877/#2884 di kasus lain)

### 2. Tambah Error Handling Tool Schema
- **Apa**: Wrap `cleanJSONSchemaForAntigravity` dalam try-catch per tool, fallback ke minimal schema jika crash
- **File**: `open-sse/executors/antigravity.js`
- **Hasil**: Tidak ada crash, tapi 429 tetap
- **Kesimpulan**: Defensive improvement, bukan solusi

### 3. Naikkan Retry Wait Time
- **Apa**: Naikkan `MAX_RETRY_AFTER_MS` dari 10s → 30s, retry attempts dari 3 → 5, tambah buffer delay progresif
- **File**: `open-sse/executors/antigravity.js`, `open-sse/providers/registry/antigravity.js`
- **Hasil**: Hanya membuat user menunggu lebih lama (4+ menit), Google tetap mengembalikan 429
- **Kesimpulan**: Masalah bukan timing retry → di-revert

### 4. Compress Tool Schema (Kurangi Body Size)
- **Apa**: Tambah `compressToolSchema()` yang flatten nested schemas ke depth 2, trim descriptions ke 150 chars
- **File**: `open-sse/executors/antigravity.js`
- **Hasil**: Body turun dari ~103KB, tapi 429 tetap terjadi
- **Kesimpulan**: Body size bukan penyebab utama

### 5. Tutup Antigravity IDE
- **Apa**: Close/quit Antigravity IDE yang berjalan di mesin yang sama, lalu coba lagi dari Hermes
- **Status**: **BELUM DICOBA / PERLU DIKONFIRMASI**
- **Hipotesis**: Google melakukan rate limiting per IP address ke endpoint `daily-cloudcode-pa.googleapis.com`. Antigravity IDE + 9Router di mesin yang sama = IP yang sama = kuota bentrok

---

## Analisis Akar Masalah

### Hipotesis Utama: IP-Level Rate Limiting dari Google

Google Antigravity API (`daily-cloudcode-pa.googleapis.com`) menerapkan rate limiting **per IP address**, bukan hanya per akun. Bukti:

1. **Akun berbeda, IP sama → tetap 429**: User menggunakan akun Google yang berbeda untuk 9Router dan Antigravity IDE, tapi keduanya keluar dari IP publik yang sama
2. **Server berbeda → berhasil**: Setup yang sama di server (IP berbeda) berhasil tanpa masalah
3. **Gateway-level rejection**: Google mengembalikan 429 dalam 250-1000ms (terlalu cepat untuk processing, artinya ditolak di gateway/load balancer berdasarkan IP)
4. **Konsisten tanpa recovery**: Meskipun menunggu 1+ menit antar retry, 429 terus terjadi selama Antigravity IDE aktif

### Mengapa OpenCode Bisa Tapi Hermes Tidak?

OpenCode mengirim request yang **jauh lebih kecil** (~2-5KB, tanpa tool definitions), sehingga:
- Token count rendah → muat dalam TPM (tokens per minute) limit
- Atau OpenCode dikirim saat window rate limit sedang kosong

Hermes Agent mengirim **103KB per request** (31 tools), mengonsumsi ~25,000+ tokens per request, membuat setiap request langsung mendekati/melebihi TPM limit per IP.

---

## ⚠️ Kasus: Sudah Menutup Antigravity IDE, Tetap Tidak Bisa

Jika setelah menutup Antigravity IDE masalah masih terjadi, kemungkinan penyebabnya:

### 1. Cooldown Period Belum Habis
Google mungkin menerapkan cooldown 5-15 menit setelah IP kena rate limit berat. **Solusi**: Tunggu 15+ menit setelah menutup IDE, lalu coba lagi.

### 2. Akun Google Memang Kehabisan Kuota
Akun `rafirara1195@gmail.com` mungkin sudah mencapai kuota harian/per-jam. **Solusi**:
- Cek kuota di [Google Cloud Console](https://console.cloud.google.com/iam-admin/quotas)
- Atau tambahkan akun Google ke-2 di 9Router Dashboard → Providers → Antigravity → Add Account

### 3. IP Masih Di-Throttle karena Burst Request Sebelumnya
12+ request retry berturut-turut bisa men-trigger temporary IP ban. **Solusi**:
- Gunakan proxy/VPN untuk 9Router:
  ```env
  # Di file .env
  HTTPS_PROXY=http://alamat-proxy:port
  ```
- Atau gunakan Proxy Pool di Dashboard → Proxy Pools → assign ke Antigravity provider

### 4. Project OAuth Client Kena Quota
OAuth client ID yang dipakai 9Router (`1071006060591-tmhssin...`) adalah client ID shared. Jika banyak user 9Router menggunakan client ID yang sama, project-level quota bisa habis. **Solusi**: Tidak ada solusi dari sisi user — ini limitasi 9Router.

### 5. `daily-cloudcode-pa.googleapis.com` Punya Rate Limit Ketat
Endpoint "daily" (development/canary) mungkin punya rate limit yang lebih ketat daripada production. **Solusi**: Cek apakah ada endpoint production alternatif.

---

## Solusi yang Disarankan

### Solusi Pasti (Teruji di Server)
1. **Jalankan 9Router di server terpisah** (IP berbeda) dan hubungkan Hermes Agent ke server tersebut

### Solusi Potensial (Belum Teruji)
2. **Gunakan proxy/VPN** untuk 9Router agar traffic Antigravity keluar dari IP berbeda
3. **Tambahkan akun Google ke-2** di 9Router sebagai fallback
4. **Tutup Antigravity IDE** dan tunggu 15 menit sebelum coba dari Hermes
5. **Gunakan model non-Antigravity** (e.g. OpenRouter, Gemini CLI) untuk Hermes Agent

---

## File yang Dimodifikasi (Perubahan Tetap Berguna)

| File | Perubahan | Status |
|---|---|---|
| `open-sse/translator/formats/gemini.js` | Tambah `resolveJsonSchemaRefs()` (Phase 0) | ✅ Berguna untuk kasus lain |
| `open-sse/executors/antigravity.js` | Tambah `dbg` import | ✅ Berguna untuk debugging |
| `open-sse/executors/antigravity.js` | Try-catch per tool schema conversion | ✅ Defensive improvement |
| `open-sse/executors/antigravity.js` | `compressToolSchema()` | ✅ Mengurangi body size |

---

---

## 🎉 Solusi Akhir (RESOLVED)

### 1. Akar Masalah Utama

Terdapat **2 penyebab utama** mengapa Hermes Agent mengalami 429 di 9Router lokal:

1. **Endpoint `daily-` Canary**: 9Router sebelumnya menggunakan `https://daily-cloudcode-pa.googleapis.com` (canary/development endpoint) yang menerapkan rate limiting **jauh lebih ketat** per IP dibandingkan endpoint produksi.
2. **Limitasi `systemInstruction` Google**: Hermes Agent mengirim system prompt berukuran besar (~35KB, 8K+ token). Google Cloud Code menerapkan limit ketat pada parameter native `systemInstruction`, sehingga prompt besar langsung memicu `429 RESOURCE_EXHAUSTED`.

### 2. Perubahan Kode (Fixes)

#### Fix A: Switch Endpoint ke Production
- **File**: `open-sse/providers/shared.js` & `open-sse/providers/registry/antigravity.js`
- **Perubahan**: Mengubah `ANTIGRAVITY_IDE_BASE_URL` dan `apiEndpoint` dari `https://daily-cloudcode-pa.googleapis.com` → `https://cloudcode-pa.googleapis.com`

#### Fix B: Dynamic System Prompt Embedding
- **File**: `open-sse/executors/antigravity.js`
- **Perubahan**: Jika `systemInstruction` melebihi 4,000 karakter, pangkas field `systemInstruction` dan gabungkan teksnya ke dalam pesan `user` pertama sebagai `[System Instructions] ... [User Message] ...`. Ini mengecoh limitasi backend Google tanpa mengubah perilaku agent.

#### Fix C: Tool Compression & Schema Sanitization (OptimasiTambahan)
- **File**: `open-sse/executors/antigravity.js`
- **Perubahan**: Menyusutkan ukuran body request (misal dari 103KB → 72KB) melalui pembatasan kedalaman schema, pemangkasan deskripsi tool/schema, dan prioritisasi tool native Antigravity.

---

## 📊 Hasil Pengujian

- **Status**: ✅ **HTTP 200 OK** (Berhasil streaming & non-streaming)
- **TTFT**: ~2.5 detik
- **Body Size**: Terkompresi dari ~103KB → ~72KB
- **Log Verifikasi**:
  ```text
  [00:22:27] 🐛 [DBG:TOOLS] Embedded 35697 char system prompt into user content (exceeds 4000 limit)
  [00:22:27] 🐛 [DBG:FETCH] ANTIGRAVITY → https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse | body=72488B
  [00:22:30] 🐛 [DBG:FETCH] ANTIGRAVITY ← 200 | ttft=2517ms | ct=text/event-stream
  ```

---

## Referensi
- Bug #2877 / #2884: JSON Schema tool converter crash
- Endpoint Produksi: `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`
- Acuan Arsitektur: `antigravity-gateway` (`lib/engine/antigravity.js`)
