**Date:** 2026-10-28
**Feature:** Wreq-JS and OpenCode Free Tier Fix

# Wreq-JS and OpenCode Free Tier Fix Proposal: Runtime TLS Impersonation & Docker Standalone Packaging

Penjelasan dan perbaikan terhadap error `wreq-js unavailable (Cannot read properties of undefined (reading 'resolve'))` pada provider OpenCode Free dan Grok Web di 9Router.

## 1. The Problem
Saat pengguna melakukan pengujian model pada provider OpenCode Free (`https://9router.vnot.my.id/dashboard/providers/opencode`), muncul pesan error:
```text
HTTP 502: [502]: wreq-js unavailable (Cannot read properties of undefined (reading 'resolve')) — install the optional wreq-js dependency to reach the OpenCode free tier
```
Akar masalah teridentifikasi dari dua hal:
1. **Inkompatibilitas Webpack dengan Dynamic `createRequire`:** Di file `open-sse/services/lazyRuntime.js`, pemanggilan `createRequire(path.join(getRuntimeDir(), "package.json"))` dievaluasi oleh Webpack saat proses `next build` menjadi `(void 0)`. Akibatnya, `(void 0).resolve(pkg)` melempar `TypeError: Cannot read properties of undefined (reading 'resolve')`. Karena error ini bertipe `TypeError` (bukan `MODULE_NOT_FOUND`), fungsi pengecekan menghentikan proses sebelum sempat mencoba mengunduh package secara otomatis.
2. **Missing Dependencies di Runner Image Docker:** File `Dockerfile` pada multi-stage build menyalin `node_modules` dari builder via output tracing standalone Next.js. Karena `wreq-js` diletakkan di `devDependencies` di `package.json`, tracing Next.js tidak menyalin direktori `node_modules/wreq-js` dan `@wreq-js` ke dalam image runner container.

## 2. The Solution
1. **Memperbaiki Resolusi Modul di `lazyRuntime.js`:**
   - Menggunakan `createRequire(import.meta.url)` yang dikenali secara statis oleh Webpack.
   - Menggunakan opsi `{ paths: [getRuntimeDir(), path.join(getRuntimeDir(), "node_modules")] }` pada `require.resolve()` untuk meresolusi dependency di direktori runtime data.
   - Menginisialisasi `package.json` minimal di direktori runtime sebelum `npm install` agar npm tidak mencari package.json di direktori induk.
2. **Menyertakan `wreq-js` di Dockerfile Runner Stage:**
   - Menambahkan instruksi `COPY --from=builder /app/node_modules/wreq-js ./node_modules/wreq-js` dan `COPY --from=builder /app/node_modules/@wreq-js ./node_modules/@wreq-js` pada stage `runner` di `Dockerfile`.
   - Hal ini memastikan binary prebuilt Rust untuk Alpine musl (`@wreq-js/binding-linux-x64-musl`) langsung tersedia di dalam kontainer tanpa perlu melakukan `npm install` saat runtime.

---

## 3. General Implementation Guide
1. **Modifikasi `Dockerfile`:**
   ```dockerfile
   # wreq-js and native rust binding for OpenCode free tier and Grok Web TLS impersonation
   COPY --from=builder /app/node_modules/wreq-js ./node_modules/wreq-js
   COPY --from=builder /app/node_modules/@wreq-js ./node_modules/@wreq-js
   ```
2. **Modifikasi `open-sse/services/lazyRuntime.js`:**
   Mengganti `createRequire(path.join(...))` dengan `createRequire(import.meta.url)` dan menggunakan parameter `paths` pada `nodeRequire.resolve()`.

---

## 4. Conclusion
Dengan perbaikan ini, request menuju endpoint OpenCode Free tier berhasil di-route melalui TLS client impersonation (`wreq-js`) dengan cipher list BoringSSL yang valid, mencegah error 502/429 dan mengembalikan respons chat completion secara normal.

**Last Updated:** 2026-10-28
