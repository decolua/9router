/**
 * production-server.js — Прокси для production-сборки Next.js
 *
 * Запускает server.js из .next/standalone, который был создан
 * командой: npm run build
 *
 * Это аналог того, что делает Docker (COPY из .next/standalone),
 * но без копирования файлов — просто chdir в папку standalone.
 *
 * Запуск: node production-server.js
 * Через PM2: pm2 start ecosystem.config.js
 */

const path = require('path');
const fs = require('fs');

const standaloneDir = path.join(__dirname, '.next', 'standalone');
const serverScript = path.join(standaloneDir, 'server.js');

// Проверка существования standalone-сборки перед запуском
if (!fs.existsSync(serverScript)) {
  console.error('');
  console.error('=== PRODUCTION-SERVER ERROR ===');
  console.error('Standalone build not found at: ' + serverScript);
  console.error('Please run "npm run build" first to create the production build.');
  console.error('Or use "npm run dev" for development mode.');
  console.error('===============================');
  console.error('');
  process.exit(1);
}

try {
  // Ensure static files exist in standalone
  const staticSrc = path.join(__dirname, '.next', 'static');
  const staticDst = path.join(standaloneDir, '.next', 'static');
  if (fs.existsSync(staticSrc) && !fs.existsSync(staticDst)) {
    fs.cpSync(staticSrc, staticDst, { recursive: true, force: true });
    console.log('[production-server] Static files copied to standalone');
  }

  // Меняем рабочую директорию на .next/standalone
  process.chdir(standaloneDir);
  console.log('[production-server] Changed working directory to: ' + standaloneDir);

  // Запускаем server.js из standalone-сборки
  console.log('[production-server] Starting standalone server: ' + serverScript);
  require(serverScript);
} catch (err) {
  // Log the error but let PM2 handle restart
  console.error('');
  console.error('=== PRODUCTION-SERVER CRASH ===');
  console.error('Error loading standalone server: ' + err.message);
  console.error(err.stack);
  console.error('===============================');
  console.error('');
  console.error('[production-server] PM2 will automatically restart this process.');
  console.error('');
}