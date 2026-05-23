// All intercepted domains + URL patterns per tool

const fs = require("fs");

const IS_DEV = process.env.NODE_ENV === "development";

// Resolve lsof absolute path — packaged apps / sudo secure_path may strip /usr/sbin from PATH
const LSOF_BIN = (() => {
  if (process.platform === "win32") return null;
  for (const p of ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof"]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* try next */ }
  }
  return "lsof"; // last-resort fallback (depends on PATH)
})();

const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];

const URL_PATTERNS = {
  antigravity: [":generateContent", ":streamGenerateContent"],
  copilot: ["/chat/completions", "/v1/messages", "/responses"],
  kiro: ["/generateAssistantResponse"],
  cursor: ["/BidiAppend", "/RunSSE", "/RunPoll", "/Run"],
};

// Synonym map: rawModel from request → canonical alias key in mitmAlias DB
const MODEL_SYNONYMS = {
  antigravity: {
    "gemini-default": "gemini-3-flash-agent",
    "gemini-3.1-pro-high": "gemini-pro-agent",
    "gemini-3-pro-high": "gemini-pro-agent",
    "gemini-3-pro-low": "gemini-3.1-pro-low",
  },
};

// Pattern fallback: rawModel regex → canonical alias key (when exact + prefix match fail)
// Order matters: more specific patterns first. Catches AG renamed variants (e.g. gemini-pro-agent)
const MODEL_PATTERNS = {
  antigravity: [
    { match: /flash.*low|low.*flash|flash.*medium|medium.*flash/i, alias: "gemini-3.5-flash-low" },
    { match: /flash.*agent|agent.*flash|flash/i,                   alias: "gemini-3-flash-agent" },
    { match: /pro.*low|low.*pro/i,                                 alias: "gemini-3.1-pro-low" },
    { match: /gemini.*pro|pro.*gemini/i,                           alias: "gemini-pro-agent" },
    { match: /opus/i,                                              alias: "claude-opus-4-6-thinking" },
    { match: /sonnet|claude/i,                                     alias: "claude-sonnet-4-6" },
    { match: /gpt.*oss|oss/i,                                      alias: "gpt-oss-120b-medium" },
  ],
};

// URL substrings whose request/response should NOT be dumped to file (telemetry, polling, empty)
const LOG_BLACKLIST_URL_PARTS = [
  "recordCodeAssistMetrics",
  "recordTrajectoryAnalytics",
  "fetchAdminControls",
  "listExperiments",
  "fetchUserInfo",
];

function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h === "daily-cloudcode-pa.googleapis.com" || h === "cloudcode-pa.googleapis.com") return "antigravity";
  if (h === "q.us-east-1.amazonaws.com") return "kiro";
  if (h === "api2.cursor.sh") return "cursor";
  return null;
}

module.exports = { IS_DEV, LSOF_BIN, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, LOG_BLACKLIST_URL_PARTS, getToolForHost };
