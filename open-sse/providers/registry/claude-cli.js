/**
 * Claude Code CLI (`claude -p`)
 *
 * Runs the locally installed Claude Code binary instead of replaying OAuth
 * tokens against api.anthropic.com. Traffic is indistinguishable from an
 * ordinary Claude Code session, which is the point: the `claude` provider
 * carries a ban risk this one avoids.
 *
 * noAuth — credentials come from whatever `claude` is already logged into.
 * Text/reasoning only: the CLI's built-in tools are disabled and client tools
 * are not bridged (see executors/claude-cli.js).
 */
import { CLAUDE_CLI_BASE_URL } from "../../config/claudeCli.js";

export default {
  id: "claude-cli",
  priority: 12,
  alias: "ccli",
  aliases: ["claude-code-cli", "cc-cli"],
  uiAlias: "ccli",
  display: {
    name: "Claude Code CLI (-p)",
    icon: "terminal",
    color: "#D97757",
    textIcon: "CL",
    website: "https://claude.com/claude-code",
    notice: {
      signupUrl: "https://claude.com/claude-code",
      text: "Runs the local `claude` binary in print mode (`claude -p`) — no API key needed, and no OAuth token replay. Install Claude Code and sign in once (`claude` → /login). Set CLI_CLAUDE_BIN to pin a custom path. Tool calling is not supported on this provider. Set CLI_CLAUDE_SESSION_CACHE=1 to keep the prompt cache across text turns and to hand the model its history in order: a conversation continues its own Claude Code session (turns that end in a tool call are replayed instead), kept in the account's config directory (projects/) for 15 minutes and then deleted.",
    },
  },
  category: "free",
  authType: "none",
  noAuth: true,
  // noAuth means "no API key", not "ready to use": this provider still needs
  // something set up on the host (a signed-in CLI, a running bridge). The
  // dashboard shows real connection counts instead of a blanket Ready badge,
  // and each connection is one account.
  localSetup: true,
  supportsAccounts: true,
  authModes: ["none"],
  // usageRouted, not usage: `claude -p --output-format json` reports the cost
  // and tokens of the call it just made, but no window remaining and no reset
  // time — there is no non-interactive quota surface to read. The figures in
  // the quota tracker are therefore what 9Router routed, labelled as such.
  features: { usage: true, usageRouted: true },
  transport: {
    baseUrl: CLAUDE_CLI_BASE_URL,
    format: "openai",
    forceStream: true,
  },
  // These map to `claude --model <alias>` (see CLAUDE_CLI_UPSTREAM_MODELS).
  // Aliases rather than pinned ids, so the CLI keeps resolving "latest" and
  // this list does not go stale the day a new model ships — the names say what
  // each alias resolves to in Claude Code 2.1.278, which is where they were
  // read from.
  //
  // Every id below was accepted by the installed CLI. An unknown alias is
  // rejected with "isn't described by this version's model catalog", so this
  // is checked, not guessed.
  models: [
    // Context lengths read from the CLI's own `modelUsage` report on 2.1.280,
    // not inferred from the alias: every current Claude model already answers
    // with a 1M window, so only haiku is smaller, and the [1m] suffix no longer
    // changes the size it reports.
    { id: "claude-cli-default", name: "Claude Code (your configured default)", contextLength: 200000 },
    { id: "claude-cli-opus", name: "Opus (alias → claude-opus-5)", contextLength: 1000000 },
    { id: "claude-cli-opus-1m", name: "Opus, 1M context (opus[1m])", contextLength: 1000000 },
    // Opus plans, Sonnet executes — Claude Code's own mode, not a model id.
    { id: "claude-cli-opusplan", name: "Opus plan + Sonnet execute (opusplan)", contextLength: 1000000 },
    { id: "claude-cli-sonnet", name: "Sonnet (alias → claude-sonnet-5)", contextLength: 1000000 },
    { id: "claude-cli-sonnet-1m", name: "Sonnet, 1M context (sonnet[1m])", contextLength: 1000000 },
    { id: "claude-cli-fable", name: "Fable (alias → claude-fable-5-1)", contextLength: 1000000 },
    { id: "claude-cli-haiku", name: "Haiku (alias → claude-haiku-4-5)", contextLength: 200000 },
  ],
  passthroughModels: true,
};
