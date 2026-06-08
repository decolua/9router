/**
 * recovery.js — DEPRECATED
 * ========================
 * Этот скрипт больше не используется!
 *
 * Запуск через PM2 в production-режиме:
 *   pm2 start ecosystem.config.js
 *
 * Подробнее: install-service.ps1
 * Статус:    pm2 status
 * Логи:      pm2 logs 9router
 */

console.error('');
console.error('=============================================');
console.error('  recovery.js больше НЕ ИСПОЛЬЗУЕТСЯ');
console.error('=============================================');
console.error('');
console.error('  Сервер переведён на PM2 + production-сборку.');
console.error('');
console.error('  Запуск:');
console.error('    pm2 start ecosystem.config.js');
console.error('');
console.error('  Установка как сервис Windows:');
console.error('    powershell -ExecutionPolicy Bypass -File install-service.ps1');
console.error('');
console.error('  Старый dev-режим (recovery.js) вызывал падения');
console.error('  из-за файловых вотчерров и утечек памяти.');
console.error('');
console.error('=============================================');
console.error('');
process.exit(0);
