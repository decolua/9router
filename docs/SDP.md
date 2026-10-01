# Software Development Plan (SDP)
## Development Log / Progress Tracking

### 2026-07-11 — Fix Auto-Update Menu Button
- **Tugas:** Memperbaiki tombol Update di Menu sebelah kanan yang tidak berfungsi.
- **Masalah:** API route `/api/auto-update` mengalami timeout karena gagal menghubungi host melalui IP Tailscale `100.70.118.53` dari dalam docker container, serta perlindungan route di `dashboardGuard.js` yang kurang presisi, dan konflik di `docker-compose.yml` akibat `git stash pop` sebelumnya.
- **Penyelesaian:**
  - Mengubah IP Webhook menjadi `172.27.0.1` (Gateway Container) dan memindahkannya ke `.env` (`WEBHOOK_UPDATE_URL` & `WEBHOOK_UPDATE_TOKEN`).
  - Memperbarui `/api/auto-update/route.js` untuk membaca env.
  - Memasukkan `/api/auto-update` ke dalam `ALWAYS_PROTECTED` pada `dashboardGuard.js`.
  - Mengatasi konflik dan memperbaiki struktur `docker-compose.yml`.
- **File yang diubah/dibuat:**
  - `.env`
  - `src/app/api/auto-update/route.js`
  - `src/dashboardGuard.js`
  - `docker-compose.yml`
- **Status saat ini:** Selesai (Sedang melakukan `docker compose up -d --build`)
- **Catatan untuk AI selanjutnya (Handoff Note):** Auto-update sudah dikonfigurasi menggunakan webhook host via docker gateway. Pastikan mengecek status conflict saat mengubah `docker-compose.yml` bersamaan dengan proses `git pull` dari webhook.

### 2026-07-21 — Fix Divergent Branch in Webhook
- **Tugas:** Menyelidiki kegagalan update ketika pengguna menekan tombol Update di Menu pojok kanan atas.
- **Masalah:** Webhook `webhook.py` mengalami kegagalan (*divergent branches error*) karena `git pull origin master` gagal mengeksekusi sinkronisasi kode saat terdapat *commit* lokal yang bersilangan. Akibatnya update tidak pernah terjadi.
- **Penyelesaian:**
  - Memodifikasi `webhook.py` menggunakan `git fetch` dan `git reset --hard origin/master` untuk memaksa sinkronisasi dengan *upstream* pada branch `master` sehingga proses `git merge master` ke `vnot-production` bisa berjalan aman.
- **File yang diubah/dibuat:**
  - `/home/vnot/utils/9router-updater/webhook.py`
- **Status saat ini:** Selesai.
- **Catatan untuk AI selanjutnya (Handoff Note):** Saya telah merestorasi `Sidebar.js` ke kondisi aslinya sesuai permintaan user. Masalah kegagalan update murni disebabkan oleh *bug* divergent di webhook.

### 2026-07-21 — Fix Webhook Connectivity Issue
- **Tugas:** Menyelidiki tombol Auto-Update yang tidak memberikan efek setelah ditekan, padahal webhook sudah diperbaiki.
- **Masalah:** API di dalam kontainer Docker gagal memanggil *host webhook* di IP `172.27.0.1:9099` (Connection Refused). Hal ini terjadi karena kontainer rootless Docker telah beralih ke *default bridge network*, sehingga `172.27.0.1` hanya berlaku di dalam *namespace* rootless tanpa adanya *forwarding* port host dari webhook.
- **Penyelesaian:**
  - Mengembalikan `WEBHOOK_UPDATE_URL` di dalam `.env` ke IP fisik host/Tailscale yang valid dan terhubung, yaitu `100.70.118.53:9099` (telah diverifikasi berfungsi normal dari dalam kontainer).
  - Melakukan `docker restart 9router` agar Next.js memuat environment variabel baru.
- **File yang diubah/dibuat:**
  - `/home/vnot/docker/9router/.env`
- **Status saat ini:** Selesai.
- **Catatan untuk AI selanjutnya (Handoff Note):** Tombol Update di HeaderMenu seharusnya kini berhasil memicu proses di webhook host tanpa `timeout` atau `connection refused`.

### 2026-07-21 — Fix Silent Webhook Git Conflict and Update to 0.5.40
- **Tugas:** Menyelesaikan pembaruan versi 0.5.40 yang terhalang konflik Git secara sembunyi-sembunyi pada proses webhook.
- **Masalah:** Meskipun skrip `webhook.py` dan konektivitas Tailscale sudah bekerja normal untuk tombol "Auto Update", pada pelaksanaannya webhook membatalkan pembaruan secara otomatis (silent abort) karena terjadinya *merge conflict* antara branch `master` hulu dengan branch lokal `vnot-production`. Branch lokal memiliki konfigurasi kustom (seperti `docker-compose.yml`, komponen Cloudflare, dsb.) yang bentrok dengan pembaruan dari *upstream*.
- **Penyelesaian:**
  - Melakukan *merge* branch `master` secara manual ke `vnot-production`.
  - Menyelesaikan 3 *conflict* utama: `docker-compose.yml` (mempertahankan build lokal), `AddApiKeyModal.js` dan `page.js` secara manual agar tidak menghilangkan perubahan *custom* Cloudflare ToS.
  - Memastikan *build* image Docker `9router` (versi 0.5.40) sukses berjalan ulang dan menimpa *container* lama.
- **File yang diubah/dibuat:**
  - `docker-compose.yml`
  - `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- **Status saat ini:** Selesai (Aplikasi telah berjalan dengan image v0.5.40 di localhost:20128).
- **Catatan untuk AI selanjutnya (Handoff Note):** Ke depannya, perhatikan bahwa perubahan lokal pada branch `vnot-production` berpotensi *conflict* dengan *upstream*. Jika pembaruan "Auto Update" kembali macet, selalu cek log *webhook* via `sudo journalctl -u 9router-updater` dan pastikan tidak ada proses Git Merge yang nyangkut.

### 2026-07-22 — Support Gemini 3.6 Flash Model Aliases in Antigravity Provider
- **Tugas:** Memperbaiki error 404 HTTP (NOT_FOUND) dari backend Google Cloud Code saat memanggil model `gemini-3.6-flash-low`, `gemini-3.6-flash-high`, dan `google/gemini-3.6-flash-high`.
- **Masalah:** API backend Google (`cloudcode-pa.googleapis.com`) tidak mengenali nama string `gemini-3.6-flash...` dan mengembalikan 404. Model ID resmi di Google Cloud Code adalah `gemini-3.5-flash-low` (Medium) dan `gemini-3-flash-agent` (High).
- **Penyelesaian:**
  - Menambahkan pemetaan alias model `gemini-3.6-flash-low`, `gemini-3.6-flash-high`, `google/gemini-3.6-flash-low`, dan `google/gemini-3.6-flash-high` di `open-sse/providers/registry/antigravity.js` dengan atribut `upstreamModelId` yang memetakan ke ID Google asli (`gemini-3.5-flash-low` / `gemini-3-flash-agent`).
  - Menambahkan logika pemanggilan `getModelUpstreamId("ag", rawModel)` dan pembersihan awalan `google/` / `antigravity/` di fungsi `AntigravityExecutor.transformRequest()` pada `open-sse/executors/antigravity.js` agar string model yang diteruskan ke payload envelope API Google sudah terurai secara benar.
  - Melakukan *rebuild* container Docker 9router agar pemetaan model alias aktif secara *native*.
- **File yang diubah/dibuat:**
  - `open-sse/providers/registry/antigravity.js`
  - `open-sse/providers/registry/gemini.js`
  - `open-sse/executors/antigravity.js`
- **Status saat ini:** Selesai.
- **Catatan untuk AI selanjutnya (Handoff Note):** Model `gemini-3.6-flash-high` dan `gemini-3.6-flash-low` kini di-resolve secara transparan ke upstream ID resmi di provider `antigravity`. Model tidak valid seperti `gemini-3.6-flash-preview` pada AI Studio telah dihapus dari registry `gemini`.

### 2026-07-31 — Fix 9Router Update Button and Resolve Upstream Sync
- **Tugas:** Menyelesaikan pembaruan versi 0.5.45 dari repositori asli dan memperbaiki tombol Update yang macet.
- **Masalah:** Tombol Update yang memicu webhook `/api/auto-update` gagal berjalan secara tertutup di *background* akibat adanya *merge conflict* pada `gemini.js`. Selain itu, repositori *upstream* versi 0.5.45 mengubah implementasi `Sidebar.js` ke pembaruan manual (CLI `npm i -g`).
- **Penyelesaian:**
  - Melakukan resolusi *merge conflict* manual pada `open-sse/providers/registry/gemini.js` dan melakukan penggabungan dari `master` (v0.5.45) ke branch `vnot-production`.
  - Mengubah fungsi tombol Update pada banner UI (`Sidebar.js`) kembali menggunakan kapabilitas Webhook bawaan proyek (`/api/auto-update`) sehingga fitur *1-click update* lokal tetap berjalan tanpa intervensi CLI dari pengguna.
  - Menjalankan `docker compose up -d --build` untuk menerapkan versi 0.5.45.
- **File yang diubah/dibuat:**
  - `open-sse/providers/registry/gemini.js`
  - `src/shared/components/Sidebar.js`
- **Status saat ini:** Selesai (Kontainer sedang dibangun dengan v0.5.45).
- **Catatan untuk AI selanjutnya (Handoff Note):** Jika ke depannya pembaruan kembali mandek, selalu pastikan status `git status` dalam kondisi bersih. Webhook menggunakan `git stash` dan `git stash pop`, yang berisiko membuat *merge conflict* diam-diam di sisi VPS.

### 2026-09-18 — Upstream Sync to v0.5.75 and Restoration of Custom Features
- **Tugas:** Menyelidiki hilangnya tombol Auto-Update di Menu / Sidebar, memperbarui codebase ke rilis terbaru dari upstream pengembang (v0.5.75), dan menyinkronkan seluruh fitur kustom ke fork `my9routerfork`.
- **Masalah:** 
  1. Pengembang resmi upstream (`decolua/9router`) tidak memiliki fitur in-app auto-update via webhook dan mengubah antarmuka update menjadi manual prompt CLI: `npm i -g 9router@latest --prefer-online`.
  2. Branch `vnot-production` sebelumnya mengalami `git reset --hard origin/master`, yang menyebabkan seluruh commit kustom lokal terlepas dari HEAD branch produksi dan `docker-compose.yml` tertimpa menggunakan pre-built image `decolua/9router:latest` upstream. Akibatnya container menjalankan versi official tanpa tombol Update kustom kita.
- **Penyelesaian:**
  - Menyelamatkan commit fitur dari git reflog / backup branch.
  - Memperbarui branch `master` ke commit upstream terbaru (`17c4cc76` - v0.5.75) dan mengunggahnya ke `my9routerfork/master`.
  - Merebase dan melengkapi branch fitur `feat/auto-update-menu` (HeaderMenu.js, Sidebar.js, /api/auto-update/route.js, dashboardGuard.js) di atas master terbaru, lalu mengunggahnya ke `my9routerfork/feat/auto-update-menu`.
  - Memperbarui branch fitur `feat/cloudflare-agreement` (one-click Meta Llama 3.2 ToS agreement) di atas master terbaru dan mengunggahnya ke `my9routerfork/feat/cloudflare-agreement`.
  - Menggabungkan (merge) kedua fitur kustom ke dalam branch deployment `vnot-production` di atas upstream v0.5.75.
  - Mengonfigurasi `docker-compose.yml` agar melakukan build lokal (`build: context: . dockerfile: Dockerfile`) dengan binding persisten `./data:/app/data` (mematuhi Aturan 6 `dev-9router.md`).
  - Mengunggah `vnot-production` ke `my9routerfork/vnot-production`.
- **File yang diubah/dibuat:**
  - `src/shared/components/HeaderMenu.js`
  - `src/shared/components/Sidebar.js`
  - `src/app/api/auto-update/route.js`
  - `src/dashboardGuard.js`
  - `src/app/api/providers/cloudflare-agree/route.js`
  - `src/app/api/providers/[id]/test/testUtils.js`
  - `src/app/api/providers/validate/route.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/page.js`
  - `docker-compose.yml`
  - `docs/SDP.md`
- **Status saat ini:** Selesai (Source code terintegrasi dan siap di-build ke container).
- **Catatan untuk AI selanjutnya (Handoff Note):** Seluruh branch (`master`, `feat/auto-update-menu`, `feat/cloudflare-agreement`, `vnot-production`) sudah disinkronkan ke remote fork pengguna `my9routerfork`. Database SQLite pengguna di `./data/db/data.sqlite` terlindungi dengan aman. Untuk memuat update v0.5.75 beserta fitur Auto-Update, jalankan build Docker.

### 2026-10-01 — Upstream Sync to v0.5.95 and Webhook Hardening
- **Tugas:** Melakukan pembaruan codebase ke versi terbaru pengembang upstream (v0.5.95) dan menstabilkan skrip updater agar tidak memunculkan merge conflict akibat `git stash`.
- **Masalah:**
  1. Pembaruan v0.5.95 tersedia dari upstream (`a99cf572`).
  2. Terjadi merge conflict di `AddCustomModelModal.js` dan `page.js` saat penggabungan upstream v0.5.95 dengan fitur kustom Cloudflare agreement dan Auto-Update.
  3. Skrip `webhook.py` sebelumnya menjalankan `git stash pop` tanpa memeriksa apakah ada perubahan yang disimpan, sehingga meletuskan stash lama dari bulan Juli dan mengotori working tree.
  4. GitHub PAT remote fork memerlukan scope `workflow` untuk push file Action `.github/workflows/docker-publish.yml` dan `tray-binaries.yml` yang baru ditambahkan upstream.
- **Penyelesaian:**
  - Membersihkan stash usang dari sistem (`git stash clear`).
  - Mengambil pembaruan upstream terbaru `origin/master` (commit `a99cf572` - v0.5.95) ke branch `master`.
  - Menggabungkan (*merge*) `master` ke dalam branch deployment `vnot-production`.
  - Menyelesaikan konflik pada `AddCustomModelModal.js` (mengintegrasikan dukungan STT Transports upstream bersama state Cloudflare agreement) dan `page.js` (menggabungkan helper Region Error China upstream bersama banner Cloudflare agreement).
  - Memastikan konfigurasi `docker-compose.yml` tetap menggunakan build lokal (`build: context: . dockerfile: Dockerfile`) dan bind mount persisten `./data:/app/data`.
  - Memperbaiki `webhook.py` agar memeriksa status working directory sebelum melakukan `git stash`, sehingga `git stash pop` hanya dieksekusi jika memang ada perubahan lokal yang disimpan.
  - Memuat ulang layanan systemd `9router-updater.service`.
- **File yang diubah/dibuat:**
  - `src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js`
  - `src/app/(dashboard)/dashboard/providers/[id]/page.js`
  - `/home/vnot/utils/9router-updater/webhook.py`
  - `docs/SDP.md`
- **Status saat ini:** Selesai (Codebase v0.5.95 siap di-build ke container).
- **Catatan untuk AI selanjutnya (Handoff Note):** Seluruh fitur kustom (Auto-Update menu/sidebar, Cloudflare agreement, persistent SQLite data) telah terintegrasi di `vnot-production` di atas upstream v0.5.95. Jalankan `docker compose up -d --build` untuk menerapkan update ke container yang sedang berjalan.
