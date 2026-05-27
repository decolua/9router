# 🚀 Deploy 9Router ke Railway

## Cara Deploy (Step by Step)

### 1. Fork repo ini
Fork https://github.com/decolua/9router ke akun GitHub kamu sendiri, lalu upload/replace file-file berikut dari zip ini:
- `Dockerfile`
- `next.config.mjs`
- `src/lib/db/adapters/betterSqliteAdapter.js`

### 2. Buat project di Railway
1. Buka https://railway.app → **New Project**
2. Pilih **Deploy from GitHub repo**
3. Pilih fork repo kamu
4. Railway akan otomatis detect Dockerfile

### 3. Konfigurasi Build & Start

Di Railway → Settings → **Build**:
- **Builder:** `Dockerfile` (bukan Nixpacks)
- **Dockerfile Path:** `./Dockerfile`
- **Build Command:** *(kosongkan, sudah ada di Dockerfile)*

Di Railway → Settings → **Deploy**:
- **Start Command:** *(kosongkan, sudah pakai ENTRYPOINT + CMD di Dockerfile)*

### 4. Set Environment Variables

Di Railway → **Variables**, tambahkan variable berikut:

| Variable | Nilai | Keterangan |
|---|---|---|
| `PORT` | `20128` | **Wajib** — port app |
| `DATA_DIR` | `/app/data` | **Wajib** — lokasi database |
| `HOSTNAME` | `0.0.0.0` | **Wajib** — agar Railway bisa akses |
| `NODE_ENV` | `production` | **Wajib** |
| `NEXT_TELEMETRY_DISABLED` | `1` | Matikan telemetry Next.js |
| `INITIAL_PASSWORD` | `password_kamu` | Password login dashboard (default: `123456`) |
| `JWT_SECRET` | *(random string panjang)* | Secret untuk JWT token session. Bisa generate dengan: `openssl rand -hex 32` |
| `AUTH_COOKIE_SECURE` | `true` | Set `true` karena Railway pakai HTTPS |

**Variable opsional:**

| Variable | Nilai | Keterangan |
|---|---|---|
| `DEBUG` | `true` | Aktifkan debug logs |
| `ENABLE_REQUEST_LOGS` | `true` | Log semua request masuk |
| `HTTP_PROXY` | `http://...` | Jika perlu proxy |
| `HTTPS_PROXY` | `http://...` | Jika perlu proxy |

### 5. Set Volume (Persistent Storage)

Agar data tidak hilang saat redeploy:

1. Railway → project kamu → **+ Add Volume**
2. Mount path: `/app/data`
3. Klik **Add**

Tanpa volume, semua data (provider config, API keys, dll) akan hilang setiap deploy ulang.

### 6. Set Port

Railway → Settings → **Networking**:
- **Port:** `20128`
- Klik **Generate Domain** untuk dapat URL publik

---

## Setelah Deploy

1. Buka URL yang diberikan Railway (contoh: `https://9router-xxx.up.railway.app`)
2. Login dengan password yang kamu set di `INITIAL_PASSWORD` (default: `123456`)
3. **Ganti password segera** di Dashboard → Settings
4. Tambahkan provider AI di Dashboard → Providers
5. Copy API key dari dashboard, gunakan di tool kamu:
   ```
   Endpoint: https://9router-xxx.up.railway.app/v1
   API Key:  [copy dari dashboard]
   ```

---

## Troubleshooting

**Build gagal `package.json not found`**
→ Pastikan kamu sudah fork repo dan upload semua file yang diperlukan (bukan hanya Dockerfile).

**App jalan tapi tidak bisa login**
→ Cek `INITIAL_PASSWORD` di Variables, pastikan tidak ada spasi.

**Data hilang setelah redeploy**
→ Tambahkan Volume di `/app/data` (lihat langkah 5).

**Port tidak bisa diakses**
→ Pastikan `PORT=20128` dan `HOSTNAME=0.0.0.0` sudah diset.
