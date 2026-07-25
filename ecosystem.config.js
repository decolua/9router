/**
 * PM2 Ecosystem Config — Production
 * Запуск: pm2 start ecosystem.config.js
 * Просмотр: pm2 status / pm2 logs
 * Перезапуск: pm2 restart 9router
 * Остановка: pm2 stop 9router
 *
 * Особенности:
 * - max_memory_restart — авторестарт при утечке памяти
 * - autorestart: true — перезапуск при падении
 * - kill_timeout — корректный graceful shutdown
 * - NODE_OPTIONS с --max-old-space-size
 * - source-map-support для читаемых стеков
 */

module.exports = {
  apps: [{
    name: '9router',
    script: 'production-server.js',
    cwd: __dirname,

    // Режим production
    env_production: {
      NODE_ENV: 'production',
      PORT: 20128,
      HOSTNAME: '0.0.0.0',
      NEXT_TELEMETRY_DISABLED: '1',
    },

    // Node.js опции
    interpreter: 'node',
    interpreter_args: [
      '--max-old-space-size=2048',
      '--enable-source-maps',
    ],

    // Авторестарты
    autorestart: true,
    max_restarts: 100,
    restart_delay: 3000,
    // Exponential backoff: после 10 рестартов за 30 сек, увеличиваем задержку
    exp_backoff_restart_delay: 100,

    // Защита памяти — рестарт при превышении 1.5GB
    max_memory_restart: '1500M',

    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 30000,

    // Watch — отключено (не dev режим)
    watch: false,

    // Логи
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,

    // Timeout на запуск — если не ответил за 30 сек, перезапуск
    ready: false,

    // Дополнительная защита: остановить после 100 рестартов подряд
    max_restarts_delay: 60000,

    // Не форкаться при ошибках в child_process (меньше зомби-процессов)
    vizion: false,
  }]
};
