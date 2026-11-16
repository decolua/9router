/**
 * Single source of truth for what this fork adds on top of upstream
 * (decolua/9router). Every fork script reads this; keep it in step with the
 * code and the upgrade tooling stays honest.
 *
 * See UPGRADE.md for how it is used.
 */

/** Upstream this fork tracks. */
export const UPSTREAM = {
  remote: "upstream",
  url: "https://github.com/decolua/9router",
  branch: "master",
};

/** Branch that carries the fork's commits. */
export const FORK_BRANCH = "master";

/**
 * Files this fork adds. Upstream never touches them, so they cannot conflict —
 * they only need to still be present after an upgrade.
 */
export const ADDED_FILES = [
  // a failure the upstream put inside an HTTP 200 → real status → fallback
  "open-sse/utils/upstreamBodyError.js",
  "tests/unit/upstream-body-error.test.js",
  "tests/unit/combo-body-error-fallback.test.js",
  // per-model reasoning effort (applied over the client's; see FORK-CHANGELOG)
  "open-sse/services/modelEffort.js",
  // claude-cli provider
  "open-sse/config/claudeCli.js",
  "open-sse/executors/claude-cli.js",
  "open-sse/providers/registry/claude-cli.js",
  // sessions resumed across turns so the prompt cache hits (docs/fable)
  "open-sse/executors/claudeCliSessions.js",
  "src/app/api/cli-tools/claude-cli-settings/route.js",
  "src/shared/components/ClaudeCliStatusCard.js",
  // cron auto-ping
  "src/shared/services/cronMatcher.js",
  "src/shared/components/AutoPingScheduleModal.js",
  // what the accounts card says about the last scheduled keepalive
  "src/shared/utils/keepaliveStatus.js",
  "tests/unit/keepalive-status.test.js",
  // Jenkins: build + push through the shared library (no deploy step)
  "Jenkinsfile",
  // shared
  "open-sse/utils/concurrencyGate.js",
  // agent skills — third-party SKILL.md injected into routed requests
  "open-sse/skills/agentSkills.js",
  "src/lib/skills/fetchSkill.js",
  "src/lib/db/repos/agentSkillsRepo.js",
  "src/lib/db/migrations/002-agent-skills.js",
  "src/app/api/skills/route.js",
  "src/app/api/skills/[id]/route.js",
  "src/shared/components/AgentSkillsCard.js",
  // local-provider accounts and their Docker packaging
  "src/app/api/cli-tools/claude-cli-accounts/route.js",
  "src/shared/components/ClaudeCliAccountsCard.js",
  // tests — their absence means the fork is present but unproven
  "tests/unit/claude-cli-executor.test.js",
  "tests/unit/claude-cli-sessions.test.js",
  "tests/unit/claude-cli-session-executor.test.js",
  "tests/unit/concurrency-gate.test.js",
  "tests/unit/quota-autoping-cron.test.js",
  "tests/unit/forced-sse-client-format.test.js",
  "tests/unit/agent-skills.test.js",
  "tests/real/claude-cli.real.test.js",
  // per-API-key usage stats: time series + CSV export for the API Key Usage page
  "src/lib/db/repos/apiKeyUsageRepo.js",
  "src/app/api/usage/api-keys/route.js",
  "src/app/(dashboard)/dashboard/api-key-usage/page.js",
  "src/app/(dashboard)/dashboard/api-key-usage/components/ApiKeyUsageChart.js",
  "tests/unit/api-key-usage-bucket-id.test.js",
  "tests/unit/api-key-usage-series.test.js",
  "tests/unit/api-key-usage-csv.test.js",
  "tests/unit/usage-stats-no-raw-keys.test.js",
  "docs/fable/2026-09-25-api-key-usage-stats-design.md",
  "docs/fable/2026-09-25-api-key-usage-stats-plan.md",
  // docs + tooling
  "AGENT-HANDOFF.md",
  "FORK-CHANGELOG.md",
  "UPGRADE.md",
  "scripts/fork/fork-manifest.mjs",
  "scripts/fork/verify-fork.mjs",
  "scripts/fork/upgrade-fork.mjs",
  "scripts/fork/export-patch.mjs",
  // reproduces the Local-only failure both cards showed, and the fix
  "scripts/fork/check-container-guard.mjs",
  // drives the Claude Code accounts route on a real server
  "scripts/fork/check-claude-accounts.mjs",
  // validates a Kubernetes bundle against the traps in AGENT-HANDOFF.md
  "scripts/fork/check-k8s-manifests.mjs",
  // the prompt-cache gate: real binary, fake or real upstream
  "scripts/fork/check-claude-cli-resume-cache.mjs",
  "scripts/fork/check-claude-cli-cache-offline.mjs",
  "scripts/fork/lib/fake-anthropic.mjs",
  "scripts/fork/lib/diff-prompt-prefix.mjs",
  "docs/fable/2026-09-24-claude-cli-prompt-cache-design.md",
  "docs/fable/2026-09-24-claude-cli-prompt-cache-plan.md",
];

/** Artwork the fork reuses from upstream files; regenerated rather than carried. */
export const DERIVED_ASSETS = [
  { from: "public/providers/claude.png", to: "public/providers/claude-cli.png" },
];

/**
 * Upstream files the fork edits. `markers` are strings that must be present for
 * the integration to be live — they are what verify-fork checks, and what a
 * conflict resolution has to preserve. `hint` is shown when a marker is missing
 * and when resolving a merge conflict in that file.
 */
export const PATCHED_FILES = [
  {
    path: "open-sse/executors/index.js",
    markers: ["ClaudeCliExecutor", '"claude-cli":'],
  },
  {
    path: "open-sse/providers/registry/index.js",
    markers: ["./claude-cli.js"],
    hint: "Despite the 'Auto-generated' header there is no generator script — this file is hand-maintained. On conflict take upstream's list, then re-add the fork import and its entry in the default-export array (use a free pN index — a duplicate pN is silent at merge time and stops the registry loading at boot).",
  },
  {
    path: "open-sse/handlers/chatCore/sseToJsonHandler.js",
    markers: ["translateNonStreamingResponse", "bodyErrorFromJson"],
    hint: "Fork replaces the final `const finalBody = ...` ternary with an if/else that also converts for non-OpenAI clients. Keep the fork branch; upstream's version is the block it replaced. This fix is a candidate to send upstream. The `parsed.error` branch also goes through bodyErrorFromJson (upstreamBodyError.js): it reads a bare-string error and maps credit/rate wording to 402/429; keep that over upstream's `Number(parsed.error.status)` version.",
  },
  {
    path: "open-sse/utils/stream.js",
    markers: ["bodyErrorFromJson", "streamDoneSent = true"],
    hint: "Passthrough mode: (1) forwarding the upstream's own `data: [DONE]` sets streamDoneSent so flush() does not append a second one; (2) a bare-string `{error:\"…\"}` frame is rewritten to the standard `{error:{message,type,code}}` shape via buildErrorBody. Both are small additions inside the existing passthrough branch; keep upstream's surrounding code.",
  },
  {
    path: "open-sse/handlers/chatCore/nonStreamingHandler.js",
    markers: ["bodyErrorFromJson"],
    hint: "Right after unwrapClineEnvelope, a `{error}` body in an HTTP 200 is turned into createErrorResult(status) so account/combo fallback sees it. Must stay before onRequestSuccess (which clears the account's error state).",
  },
  {
    path: "src/shared/services/quotaAutoPing.js",
    markers: ["cronMatcher", "latestDueFire", "runCronPing", "readCronEntry", "sendClaudeCliPing", "providerHandlers"],
    hint: "Largest fork edit. Cron support is additive: the import, sendPingViaCli on the claude handler, sendClaudeCliPing, the cron block, the tick's cron branch, and the deps.providerHandlers injection. Keep all of them plus upstream's changes to the reset-based path.",
  },
  {
    path: "src/shared/constants/config.js",
    markers: ["cronPingText", "cronMaxExpressions", "cronCatchUpMinutes", "cliPingModel", "cliPingTimeoutMs"],
    hint: "Additive keys inside QUOTA_AUTOPING_CONFIG. Keep them and any new upstream keys.",
  },
  {
    path: "src/shared/services/initializeApp.js",
    markers: ["config?.cron"],
    hint: "hasQuotaAutoPingEnabled must also return true for cron-only setups, or a cron schedule does not survive a restart.",
  },
  {
    path: "src/dashboardGuard.js",
    markers: ["/api/cli-tools/claude-cli-settings"],
    hint: "Both entries belong in LOCAL_ONLY_PATHS — one spawns a process, the other fetches a URL and can open a window on the host. Dropping them exposes those routes when requireLogin is false.",
  },
  {
    path: "src/app/api/cli-tools/all-statuses/route.js",
    markers: ["claudeCliGet"],
    hint: "Two imports and two STATUS_GETTERS entries.",
  },
  {
    path: "src/shared/constants/cliTools.js",
    markers: ['"claude-cli":'],
    hint: "Two CLI_TOOLS entries inserted before the `devin:` entry.",
  },
  {
    path: "src/shared/components/index.js",
    markers: ["AutoPingScheduleModal", "ClaudeCliStatusCard", "AgentSkillsCard", "ClaudeCliAccountsCard"],
    hint: "Five re-exports.",
  },
  {
    path: "src/sse/services/auth.js",
    markers: ["noAuthRows"],
  },
  {
    path: "src/dashboardGuard.js",
    markers: ["IS_CONTAINER", "NINEROUTER_HOST_ROUTES_REMOTE"],
    hint: "LOCAL_ONLY_PATHS requires a loopback request, which no container deployment can satisfy - both provider cards showed only \"Local only: CLI token required\". The gate is container-aware: authentication alone when containerised, the desktop rule everywhere else. Do not drop this or the Docker/K8s deployment loses those routes entirely.",
  },
  {
    path: "src/shared/constants/providers.js",
    markers: ["localSetup", "supportsAccounts"],
    hint: "The registry-to-UI field mapping is an explicit allowlist, so a new provider field is dropped unless it is listed here too.",
  },
  {
    path: "src/app/(dashboard)/dashboard/providers/page.js",
    markers: ["!provider.localSetup"],
    hint: "Upstream shows a green Ready badge for every noAuth provider. noAuth means no API key, not usable - a provider that needs a signed-in CLI or a running bridge must fall through to the real connection count.",
  },
  {
    path: "custom-server.js",
    markers: ['server.on("upgrade"'],
    hint: "The server.on(\"upgrade\") registration is load-bearing: Node only emits that event when a listener exists, so without it the h2c downgrade in the emit override never runs.",
  },
  {
    path: "Dockerfile",
    markers: ["claude-code", "CLI_CLAUDE_BIN", "\"wreq-js@^3.2.0\" \"playwright-core@^1.62.1\""],
    hint: "Bundles a pinned @anthropic-ai/claude-code so the claude-cli provider works in the image with nothing else installed, and sets CLI_CLAUDE_BIN and CLAUDE_CONFIG_DIR. Also holds upstream's lazy-runtime install (wreq-js, playwright-core) to the package.json ranges instead of bare `latest`. (The apk/npm mirror build args are NOT on this branch - they were part of the security work that was dropped.)",
  },
  {
    path: "docker-compose.yml",
    markers: ["9router"],
    hint: "Runs 9Router with the Claude Code CLI available inside the container.",
  },
  {
    path: "DOCKER.md",
    markers: ["claude setup-token"],
    hint: "Documents how the Claude Code CLI provider is signed in, with a setup token.",
  },
  {
    path: "src/lib/db/schema.js",
    markers: ["agentSkills:"],
    hint: "The agentSkills table definition. A fresh database gets every table from here via migration 001; an existing one gets this table from migration 002.",
  },
  {
    path: "src/lib/db/migrations/index.js",
    markers: ["002-agent-skills.js", "m002"],
    hint: "Register the migration. If upstream adds its own migration, renumber the fork's to keep versions unique and monotonically increasing — the registry sorts by version.",
  },
  {
    path: "src/lib/db/index.js",
    markers: ["agentSkillsRepo.js"],
    hint: "Re-export the repo.",
  },
  {
    path: "src/lib/localDb.js",
    markers: ["getEnabledAgentSkills"],
    hint: "The compat shim lists exports explicitly, so a new repo function must be added here too or every import through @/lib/localDb fails at build time.",
  },
  {
    path: "src/models/index.js",
    markers: ["getEnabledAgentSkills"],
    hint: "Same list again, one layer up.",
  },
  {
    path: "open-sse/handlers/chatCore.js",
    markers: ["injectAgentSkills", "agentSkills", "applyModelEffort", "guardStreamHead"],
    hint: "Takes `agentSkills` in the options object and injects them after the caveman/ponytail block, just before dispatch. Deliberately NOT gated on tokenSaverEnabled: a skill changes how the model answers and costs tokens rather than saving them. Also: just before buildOnStreamComplete, guardStreamHead() reads the head of a streaming 200 and returns createErrorResult(status) when it opens with an error frame — it must come before handleStreamingResponse, whose first act is onRequestSuccess (clears the account's error state).",
  },
  {
    path: "src/sse/handlers/chat.js",
    markers: ["getEnabledAgentSkills"],
    hint: "Loads the enabled skills per request (a local SQLite read, not a network fetch) and passes them to handleChatCore. loadAgentSkills() is a try/catch on purpose — a skill must never be the reason a completion fails, and a storage module without the function (an upstream test's mock) throws before a .catch could see it.",
  },
  {
    path: "open-sse/executors/codex.js",
    markers: ["effort named in the model id"],
    hint: "An effort written into the model id (`gpt-6-luna-low`) wins over the client's reasoning / reasoning_effort, like the `(low)` spelling does. Upstream only used the suffix when the client sent no effort, which an agent client never does.",
  },
  {
    path: "src/app/(dashboard)/dashboard/skills/page.js",
    markers: ["AgentSkillsCard"],
    hint: "Mounts the Agent Skills card above upstream's static list of 9Router documentation links. Both live under the existing Skills menu.",
  },
  {
    path: "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js",
    markers: ["autoPingSchedule", "scheduleTooltip"],
    hint: "Adds the autoPingSchedule prop, its Schedule button next to Auto-ping, the tooltip, and the propTypes entry.",
  },
  {
    path: "src/app/(dashboard)/dashboard/providers/[id]/page.js",
    markers: [
      "AutoPingScheduleModal",
      "ClaudeCliStatusCard",
      "cronScheduleTarget",
      "handleAutoPingSchedule",
    ],
    hint: "Imports, the cronScheduleTarget state, cron in the autoPing state + settings load, handleAutoPingSchedule, the autoPingSchedule prop on ConnectionRow, the modal near the other modals, and the two status cards in the isFreeNoAuth branch.",
  },
  {
    path: "src/lib/db/repos/usageRepo.js",
    markers: ["./apiKeyUsageRepo.js", "apiKeyBucketId(r.apiKey, apiKeyMap)", "deletedKeyLabel("],
    hint: "Imports apiKeyBucketId/deletedKeyLabel and re-keys stats.byApiKey away from the raw API key on all three code paths (the daily rollup, the usageHistory overlay that sets lastUsed, and the raw-row 24h/today path) plus the deleted-key keyName label. This is a security fix, not cosmetic: before it, every raw API key that had ever made a request reached the browser as a JSON property name on every /api/usage/stats poll. On conflict keep all three re-keyed sites plus upstream's changes to the surrounding aggregation. Do NOT re-key the stored composite in usageDaily.data.byApiKey (still `${rawApiKey}|${model}|${provider}`, unchanged on purpose) — only the response this function returns is re-keyed; re-keying the store would orphan every day already accumulated. Do NOT resolve the maskApiKey duplication by importing it from here into apiKeyUsageRepo.js — this file already imports FROM apiKeyUsageRepo.js, so the reverse import closes a cycle; apiKeyUsageRepo.js keeps its own private copy deliberately.",
  },
  {
    path: "src/shared/components/UsageStats.js",
    markers: [
      "export function sortData",
      "export function groupDataByKey",
      "export const API_KEY_COLUMNS",
      "renderApiKeySummaryCells",
      "renderApiKeyDetailCells",
    ],
    hint: "sortData, groupDataByKey, API_KEY_COLUMNS and the API-key table's two render functions moved from private/inline to exported module scope so the API Key Usage page (src/app/(dashboard)/dashboard/api-key-usage/) renders the exact same table instead of a copy that drifts. On conflict keep the exports; the `case \"apiKey\":` branch inside this file still calls back into renderApiKeySummaryCells/renderApiKeyDetailCells by reference, so both sides need to survive together.",
  },
  {
    path: "src/shared/components/Sidebar.js",
    markers: ["/dashboard/api-key-usage"],
    hint: "One nav entry, above Quota Tracker. Keep it alongside any upstream nav additions.",
  },
  {
    path: "tests/unit/security-audit.test.js",
    markers: ["apiKeyBucketId(r.apiKey, apiKeyMap)"],
    hint: "AUDIT-002's assertion was updated to match usageRepo.js's re-keying: it now checks the source for `apiKeyBucketId(r.apiKey, apiKeyMap)` rather than the old `${apiKeyMasked}|${r.model}|${r.provider` template. This is the source-guard companion to tests/unit/usage-stats-no-raw-keys.test.js (behavioral). If upstream also touches this file's AUDIT-002 test, keep the fork's assertion text.",
  },
];

/**
 * Regenerated after every upgrade rather than merged: upstream adds providers of
 * its own, so these snapshots conflict on release and are cheap to rebuild.
 */
export const REGENERATED_BASELINES = [
  { file: "tests/__baseline__/providers-baseline.json", command: ["node", ["tests/__baseline__/snapshot-providers.mjs"]] },
  { file: "tests/__baseline__/alias-baseline.json", command: ["node", ["tests/__baseline__/verify-alias.mjs", "--snapshot"]] },
];

/** Provider ids the fork registers; asserted against the built registry. */
export const FORK_PROVIDERS = [
  { id: "claude-cli", alias: "ccli", format: "openai", forceStream: true },
];

/** Fork test files, run from `tests/`. */
export const FORK_TESTS = [
  "unit/agent-skills.test.js",
  "unit/claude-cli-executor.test.js",
  "unit/claude-cli-sessions.test.js",
  "unit/claude-cli-session-executor.test.js",
  "unit/concurrency-gate.test.js",
  "unit/quota-autoping-cron.test.js",
  "unit/keepalive-status.test.js",
  "unit/forced-sse-client-format.test.js",
  "unit/api-key-usage-bucket-id.test.js",
  "unit/api-key-usage-series.test.js",
  "unit/api-key-usage-csv.test.js",
  "unit/usage-stats-no-raw-keys.test.js",
  "unit/claude-cli-disabled-provider.test.js",
  "unit/claude-cli-quota-exhausted.test.js",
  "unit/codex-effort-suffix.test.js",
  "unit/model-effort.test.js",
  "unit/model-effort-ui.test.js",
  "unit/model-effort-save-apply.test.js",
  "unit/claude-cli-combo-e2e.test.js",
  "unit/upstream-body-error.test.js",
  "unit/combo-body-error-fallback.test.js",
];

/** Live tests; skipped unless REAL_CLI_TESTS=1 and Claude Code is installed. */
export const FORK_LIVE_TESTS = ["real/claude-cli.real.test.js"];
