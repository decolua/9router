// pm2 process file for 9router.
//
// Usage:
//   npm run start:pm2     # pm2 start ecosystem.config.cjs
//   npm run stop:pm2      # pm2 delete ecosystem.config.cjs
//   pm2 logs 9router      # tail logs
//   pm2 status            # see process state
//   pm2 save && pm2 startup   # persist across reboots
//
// Runs the vinext standalone server with the trusted-IP entry (server.vinext.js),
// which prepends the x-9r-real-ip sanitizer that loginLimiter + dashboardGuard rely on.
// Fork mode (single instance) — this is a dashboard, not a horizontally-scaled API.

/** @type {import("pm2").EcosystemConfig} */
module.exports = {
  apps: [
    {
      name: "9router",
      script: "server.vinext.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      // Restart if the process exceeds ~1.5GB (mirrors the old --max-old-space-size headroom).
      max_memory_restart: "1500M",
      // Keep stdout/stderr in ~/.pm2/logs; show timestamps.
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "20128",
        HOST: "0.0.0.0",
      },
    },
  ],
};
