"use client";

import { useState } from "react";

export default function AmmailTutorialPage() {
  const [copiedStates, setCopiedStates] = useState({});

  const handleCopy = (val) => {
    navigator.clipboard.writeText(val);
    setCopiedStates((prev) => ({ ...prev, [val]: true }));
    setTimeout(() => {
      setCopiedStates((prev) => ({ ...prev, [val]: false }));
    }, 1500);
  };

  const CopyButton = ({ value, text = "Copy", className = "" }) => {
    const isCopied = copiedStates[value];
    return (
      <button
        type="button"
        onClick={() => handleCopy(value)}
        className={`text-xs px-3 py-1 rounded cursor-pointer transition-all duration-150 flex items-center gap-1 border font-semibold shrink-0 ${
          isCopied
            ? "text-green-400 bg-green-500/10 border-green-500/20"
            : "text-white/50 hover:text-white bg-white/5 hover:bg-white/10 border-transparent"
        } ${className}`}
      >
        <span className="material-symbols-outlined text-[14px]">{isCopied ? "check" : "content_copy"}</span>
        {isCopied ? "Copied" : text}
      </button>
    );
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 text-white space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-[28px]">auto_stories</span>
          <div>
            <h1 className="text-xl font-bold">Panduan Lengkap Deploy Temp Mail</h1>
            <p className="text-xs text-white/50 mt-0.5">Panduan integrasi Cloudflare Worker & D1 Database untuk 9router</p>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href="/dashboard/automation"
            className="px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold hover:bg-white/10 transition-colors cursor-pointer text-text-main"
          >
            Kembali ke Dashboard
          </a>
        </div>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-white/80">
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-xs text-primary/95 flex items-start gap-3">
          <span className="material-symbols-outlined shrink-0 mt-0.5">lightbulb</span>
          <p>
            <strong>Info Penting:</strong> Panduan ini ditujukan jika Anda ingin melakukan deployment secara manual ke Cloudflare menggunakan CLI. Jika Anda ingin setup otomatis, silakan kembali ke Dashboard dan gunakan form <strong>⚡ Auto Deploy (Cloudflare)</strong> untuk setup 1-klik.
          </p>
        </div>

        {/* Step 1 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
            Prasyarat & Login Cloudflare
          </h4>
          <p>
            Pastikan Node.js telah terinstal di komputer Anda. Buka terminal lalu autentikasikan akun Cloudflare Anda menggunakan Wrangler CLI:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">npx wrangler login</span>
            <CopyButton value="npx wrangler login" />
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
            Masuk Folder & Install Dependencies
          </h4>
          <p>
            Buka terminal pada direktori worker lokal Anda (`tempmail`) lalu install package dependencies:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">cd /home/data/Project/9router/tempmail && npm install</span>
            <CopyButton value="cd /home/data/Project/9router/tempmail && npm install" />
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span>
            Buat Database Cloudflare D1
          </h4>
          <p>
            Buat database baru bernama <code>tempmail</code> pada Cloudflare D1 untuk menyimpan data kotak surat dan isi pesan:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">npx wrangler d1 create tempmail</span>
            <CopyButton value="npx wrangler d1 create tempmail" />
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3.5 text-xs text-amber-300 flex items-start gap-2.5">
            <span className="material-symbols-outlined shrink-0 mt-0.5">warning</span>
            <span>
              Perintah di atas akan menghasilkan **database_id** (UUID). Salin ID tersebut, kemudian buka berkas <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-white">wrangler.jsonc</code> di folder proyek tempmail Anda, ganti nilai <code>database_id</code> di baris terbawah dengan ID baru Anda.
            </span>
          </div>
        </div>

        {/* Step 4 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">4</span>
            Jalankan Migrasi Database D1
          </h4>
          <p>
            Buat struktur tabel database yang diperlukan dengan menerapkan migrasi database baik secara lokal maupun langsung di Cloudflare:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">npx wrangler d1 migrations apply tempmail --remote</span>
            <CopyButton value="npx wrangler d1 migrations apply tempmail --remote" />
          </div>
        </div>

        {/* Step 5 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">5</span>
            Buat API Access Key untuk 9router
          </h4>
          <p>
            9router berkomunikasi dengan Worker menggunakan API Key yang aman. Jalankan perintah SQL berikut untuk mendaftarkan 9router admin ke database D1 Anda:
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
              <span className="break-all overflow-hidden text-ellipsis">
                npx wrangler d1 execute tempmail --remote --command="INSERT OR IGNORE INTO chats (chat_id, username, first_name, last_name, created_at, updated_at) VALUES ('9router', '9router_admin', '9Router', 'Admin', datetime('now'), datetime('now')); INSERT OR REPLACE INTO api_access (user_id, api_key, quota_daily, quota_used, quota_date, granted_by, granted_at, expires_at) VALUES ('9router', 'tm_YOUR_SECURE_API_KEY', 0, 0, strftime('%Y-%m-%d', 'now'), 'admin', datetime('now'), '2099-12-31T23:59:59Z');"
              </span>
              <CopyButton value={`npx wrangler d1 execute tempmail --remote --command="INSERT OR IGNORE INTO chats (chat_id, username, first_name, last_name, created_at, updated_at) VALUES ('9router', '9router_admin', '9Router', 'Admin', datetime('now'), datetime('now')); INSERT OR REPLACE INTO api_access (user_id, api_key, quota_daily, quota_used, quota_date, granted_by, granted_at, expires_at) VALUES ('9router', 'tm_YOUR_SECURE_API_KEY', 0, 0, strftime('%Y-%m-%d', 'now'), 'admin', datetime('now'), '2099-12-31T23:59:59Z');"`} />
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3.5 text-xs text-amber-300 flex items-start gap-2.5">
              <span className="material-symbols-outlined shrink-0 mt-0.5">info</span>
              <span>
                Ganti <code>tm_YOUR_SECURE_API_KEY</code> dengan API Key acak pilihan Anda. Salin API Key ini ke pengaturan 9router Anda.
              </span>
            </div>
          </div>
        </div>

        {/* Step 6 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">6</span>
            Atur Secret Tokens (Telegram & Webhook)
          </h4>
          <p>
            Simpan token bot Telegram dan webhook secret ke dalam Cloudflare secret variables secara aman:
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
              <span className="break-all">npx wrangler secret put TELEGRAM_BOT_TOKEN</span>
              <CopyButton value="npx wrangler secret put TELEGRAM_BOT_TOKEN" />
            </div>
            <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
              <span className="break-all">npx wrangler secret put TELEGRAM_WEBHOOK_SECRET</span>
              <CopyButton value="npx wrangler secret put TELEGRAM_WEBHOOK_SECRET" />
            </div>
          </div>
        </div>

        {/* Step 7 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">7</span>
            Deploy ke Cloudflare Workers
          </h4>
          <p>
            Buka file <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-white">wrangler.jsonc</code>, sesuaikan parameter <code>vars</code> (domain, base URL) agar sesuai dengan domain milik Anda. Setelah itu, deploy ke Cloudflare:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">npx wrangler deploy</span>
            <CopyButton value="npx wrangler deploy" />
          </div>
        </div>

        {/* Step 8 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">8</span>
            Daftarkan Webhook Telegram Bot (Opsional)
          </h4>
          <p>
            Daftarkan URL domain worker Anda ke API Telegram agar bot Anda dapat menerima chat command secara instan:
          </p>
          <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10 font-mono text-xs text-amber-300 gap-4">
            <span className="break-all">
              {'curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d \'{"url":"https://<worker-host>/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}\''}
            </span>
            <CopyButton value={`curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" -H "Content-Type: application/json" -d '{"url":"https://<worker-host>/telegram/webhook","secret_token":"<WEBHOOK_SECRET>"}'`} />
          </div>
        </div>

        {/* Step 9 */}
        <div className="bg-neutral-900 border border-white/5 rounded-xl p-6 space-y-4">
          <h4 className="text-base font-bold text-white flex items-center gap-2">
            <span className="bg-primary/20 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs">9</span>
            Konfigurasi Cloudflare Email Routing & DNS (Paling Penting!)
          </h4>
          <p>
            Ini adalah langkah krusial agar email dapat diterima dan diproses oleh Worker yang telah dideploy. Masuk ke panel Cloudflare Anda, lalu ikuti panduan berikut:
          </p>
          
          <div className="space-y-4 border-l-2 border-primary/30 pl-4 mt-2">
            <div>
              <h5 className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                Bagian A: Sinkronkan dan Kunci Rekaman DNS
              </h5>
              <p className="text-xs text-white/70 mt-1">
                Jika status DNS Anda tertulis <code className="bg-white/10 text-white px-1 rounded">Not configured</code> atau ada rekaman dengan status <code className="bg-amber-500/10 text-amber-300 px-1 rounded border border-amber-500/20">Unlocked</code>:
              </p>
              <ul className="list-disc list-inside text-xs text-white/70 mt-1.5 space-y-1 ml-2">
                <li>Buka menu <strong>Email Routing</strong> di panel domain Cloudflare Anda.</li>
                <li>Pilih tab **`Settings`** di sebelah atas.</li>
                <li>Di sebelah kanan DNS records, klik tombol **`Lock`** (ikon gembok). Cloudflare akan otomatis mengunci dan menerapkan semua MX dan TXT records yang dibutuhkan.</li>
              </ul>
            </div>

            <div>
              <h5 className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                Bagian B: Buat Aturan Rute Catch-All
              </h5>
              <p className="text-xs text-white/70 mt-1">
                Agar semua email masuk diteruskan ke database Worker Anda:
              </p>
              <ul className="list-disc list-inside text-xs text-white/70 mt-1.5 space-y-1 ml-2">
                <li>Klik tab **`Routing rules`** (tab ketiga dari kiri).</li>
                <li>Scroll ke bawah ke bagian **Catch-all address**.</li>
                <li>Klik **Edit** / **Configure**.</li>
                <li>Pada kolom **Action**, pilih opsi **`Send to a Worker`**.</li>
                <li>Pada kolom **Destination**, pilih nama Worker yang baru saja dideploy.</li>
                <li>Klik **Save** untuk menyimpan aturan perutean.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
