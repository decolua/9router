import pkg from "../../../package.json" with { type: "json" };

// App configuration
export const APP_CONFIG = {
  name: "9Router Proxy",
  description: "AI Infrastructure Management",
  version: pkg.version,
};

// GitHub configuration
export const GITHUB_CONFIG = {
  changelogUrl: "https://raw.githubusercontent.com/decolua/9router/refs/heads/master/CHANGELOG.md",
  donateUrl: "https://9router.com/api/donate",
};

// Updater configuration
export const UPDATER_CONFIG = {
  npmPackageName: "9router",
  installCmd: "npm i -g 9router",
  installCmdLatest: "npm i -g 9router@latest --prefer-online",
  shutdownCountdownSec: 3,
  exitDelayMs: 500,
  statusPort: 20129,
  statusPollIntervalMs: 1000,
  statusLogTailLines: 8,
  installRetries: 3,
  installRetryDelayMs: 5000,
  lingerAfterDoneMs: 30000,
  waitForExitMinMs: 5000,
  waitForExitMaxMs: 20000,
  waitForExitCheckMs: 500,
  appPort: 20128,
};

// Theme configuration
export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "system", // "light" | "dark" | "system"
};

// Subscription
export const SUBSCRIPTION_CONFIG = {
  price: 1.0,
  currency: "USD",
  interval: "month",
  planName: "Pro Plan",
};

// API endpoints
export const API_ENDPOINTS = {
  users: "/api/users",
  providers: "/api/providers",
  payments: "/api/payments",
  auth: "/api/auth",
};

export const CONSOLE_LOG_CONFIG = {
  maxLines: 200,
  pollIntervalMs: 1000,
};

// Client-side store TTL: how long fetched data stays fresh before re-fetching
export const CLIENT_STORE_TTL_MS = 60000;

// Quota auto-ping: keep 5h windows warm by sending a tiny request right after reset.
export const QUOTA_AUTOPING_CONFIG = {
  tickIntervalMs: 60000,                // scheduler tick
  pingLeadMs: 5000,                     // fire once reset passes (within tolerance)
  refreshAheadMs: 300000,               // refetch usage when within 5min of reset
  failureCooldownMs: 900000,            // avoid failed ping spam while upstream/auth is unhealthy
  // Cron mode: operator-scheduled pings ("every 5h send a tiny hi") that open a
  // fresh 5h window on a fixed clock instead of reacting to the reported resetAt.
  cronPingText: "Only Hi",
  cronMaxExpressions: 12,               // per connection — guards the settings blob
  cronFailureCooldownMs: 300000,
  // How late a missed slot may still fire. A tick can miss a slot's exact
  // minute (busy tick, an earlier account's slow `claude -p`, a pod restart);
  // without catch-up that 5h window is simply never opened. Kept at least two
  // failure cooldowns wide so a failed ping gets retried more than once.
  cronCatchUpMinutes: 15,
  // A CLI ping is drained inline inside the tick; without its own deadline a
  // hung `claude -p` would suspend every provider's pings behind it.
  cliPingTimeoutMs: 60000,
  providers: {
    claude: {
      settingsKey: "claudeAutoPing",    // preserve existing settings contract
      quotaKey: "session (5h)",         // quota key returned by usage handler
      pingModel: "claude-haiku-4-5-20251001",
      pingText: "hi",
      pingMaxTokens: 1,
      // Used when a cron schedule opts into via:"cli" (spawns the real binary).
      cliPingModel: "claude-cli-haiku",
    },
    codex: {
      settingsKey: "codexAutoPing",
      quotaKey: "session",
      pingWhenResetAtSlides: true,
      resetAtDriftMs: 30000,
      minPingIntervalMs: 600000,
      skipWhenBlockingQuotaExhausted: true,
      // gpt-5.6-terra is the lightweight model for auto-pinging Codex 5h reset window.
      pingModel: "gpt-5.6-terra",
      pingText: "hi",
      pingInstructions: "Reply with OK.",
      pingReasoningEffort: "none",
    },
    // Claude Code CLI. Credentials are local (a config directory or a setup
    // token), so there is no OAuth token to refresh and its connections are
    // stored with authType "none" — `localCredentials` is what tells the
    // scheduler both of those things.
    //
    // No `quotaKey` and no `getUsage` handler on purpose: Claude Code exposes
    // no non-interactive quota endpoint, so there is nothing for the reactive
    // reset-based ping to react to. Only cron schedules apply here.
    "claude-cli": {
      settingsKey: "claudeCliAutoPing",
      localCredentials: true,
      pingText: "hi",
      // The only way to reach this provider is the binary itself.
      cliPingModel: "claude-cli-haiku",
    },
  },
};

// providerId → settings key, derived from the table above. Both dashboards and
// both server-side triggers read this instead of restating the pairs; the list
// had drifted into five copies, and a provider missing from any one of them
// silently loses its schedule.
export const AUTO_PING_SETTINGS_KEYS = Object.fromEntries(
  Object.entries(QUOTA_AUTOPING_CONFIG.providers).map(([id, cfg]) => [id, cfg.settingsKey]),
);

// Re-export from providers.js for backward compatibility
export {
  FREE_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  AI_PROVIDERS,
  AUTH_METHODS,
} from "./providers.js";

// Re-export from models.js for backward compatibility
export {
  PROVIDER_MODELS,
  AI_MODELS,
} from "./models.js";
