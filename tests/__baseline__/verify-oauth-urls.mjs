// Verify OAuth/token URLs resolve byte-for-byte vs snapshot (backend open-sse).
// Captures every URL executors/tokenRefresh actually use, to guard DRY dedup.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OAUTH_ENDPOINTS } from "../../open-sse/config/appConstants.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapPath = join(here, "oauth-urls-baseline.json");

// Collect resolved URLs that backend code depends on
const resolved = {
  oauthEndpoints: OAUTH_ENDPOINTS,
  tokenUrls: {
    claude: PROVIDERS.claude?.tokenUrl,
    codex: PROVIDERS.codex?.tokenUrl,
    qwen: PROVIDERS.qwen?.tokenUrl,
    iflow: PROVIDERS.iflow?.tokenUrl,
    kiro: PROVIDERS.kiro?.tokenUrl,
    xai: PROVIDERS.xai?.tokenUrl,
    // Grok CLI injects oauth.tokenUrl onto PROVIDERS via OAUTH_INJECT_FIELDS
    "grok-cli": PROVIDERS["grok-cli"]?.tokenUrl,
    cline: PROVIDERS.cline?.tokenUrl,
    "kimi-coding": PROVIDERS["kimi-coding"]?.tokenUrl,
  },
  authUrls: {
    qwen: PROVIDERS.qwen?.authUrl,
    iflow: PROVIDERS.iflow?.authUrl,
    kiro: PROVIDERS.kiro?.authUrl,
  },
  refreshUrls: {
    cline: PROVIDERS.cline?.refreshUrl,
    "kimi-coding": PROVIDERS["kimi-coding"]?.refreshUrl,
    xai: PROVIDERS.xai?.refreshUrl,
    "grok-cli": PROVIDERS["grok-cli"]?.tokenUrl,
  },
  clientIds: {
    claude: PROVIDERS.claude?.clientId,
    codex: PROVIDERS.codex?.clientId,
    qwen: PROVIDERS.qwen?.clientId,
    iflow: PROVIDERS.iflow?.clientId,
    "kimi-coding": PROVIDERS["kimi-coding"]?.clientId,
    "grok-cli": PROVIDERS["grok-cli"]?.clientId,
  },
};
const current = JSON.parse(JSON.stringify(resolved));

const mode = process.argv[2];
if (mode === "--snapshot") {
  writeFileSync(snapPath, JSON.stringify(current, null, 2));
  console.log(`Snapshot OAuth URLs → ${snapPath}`);
  process.exit(0);
}

if (!existsSync(snapPath)) {
  console.error("No baseline. Run with --snapshot on OLD code first.");
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(snapPath, "utf8"));
const a = JSON.stringify(baseline);
const b = JSON.stringify(current);
if (a === b) {
  console.log("✅ OAuth URLs byte-for-byte equal.");
  process.exit(0);
}
console.error("❌ OAuth URL mismatch:");
console.error("baseline:", a);
console.error("current :", b);
process.exit(1);
