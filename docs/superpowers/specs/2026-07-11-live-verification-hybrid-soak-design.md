# Live Verification and Hybrid Soak Design

**Date:** 2026-07-11  
**Status:** Approved for planning  
**Scope:** Read-only live verification, one manual 24-hour soak cycle, and a separately approved scheduler after the soak passes.

## Objective

Turn the existing manual post-deployment checks into a repeatable, sanitized acceptance gate without expanding the deployment critical path or introducing automatic repair behavior.

The first iteration provides a read-only verifier and four manual checkpoints. Scheduler installation is deliberately deferred until the full manual soak succeeds and receives separate approval.

## Non-Goals

- No deployment, restart, rollback, repair, or configuration mutation.
- No credential discovery, storage, printing, or database row dumps.
- No proxy URL, cookie, token, raw Cloudflare trace, location, colo, or provider response output.
- No Antigravity diagnosis or model-routing changes.
- No scheduler modification during the first implementation phase.
- No replacement for the existing deployment script.

## Architecture

### Live verifier

Add `scripts/verify-live-9router.sh` as the single read-only entry point.

The script evaluates independent gates and emits a compact sanitized result for each gate. It must continue through operational gate failures when safe, so one invocation reports all detected failures. A verifier configuration failure may stop checks that depend on the missing prerequisite.

Required gates:

1. The latest deployment journal exists and its last state is `DONE`.
2. The expected commit is resolved from an explicit argument or the current local `HEAD`.
3. The live `.openclaw-source-commit` equals the expected commit.
4. The current local branch is not behind or divergent from its configured upstream.
5. `/api/health` returns the exact healthy response.
6. `/api/version` returns valid JSON with a non-empty `currentVersion`.
7. PM2 reports exactly one `9router` process, status `online`, and zero unstable restarts.
8. The configured WARP SOCKS listener is listening locally.
9. A proxied Cloudflare trace contains the exact line `warp=on`; raw trace fields are never emitted.
10. Every `antigravity`, `xai`, and `github` connection has both top-level and nested `providerSpecificData.strictProxy` set to `true`.
11. An unauthenticated request to `/api/settings/warp-health` returns `401`.
12. Logs produced since the latest deployment contain neither sensitive direct-fallback warnings nor the historical `Invalid URL protocol` error.

Optional canary gate:

- Enabled only through an explicit flag.
- Sends one non-streaming request to a configured model, defaulting to `cx/gpt-5.6-sol`.
- Requires authentication only through an environment variable if the endpoint requires it.
- Validates HTTP success and a non-empty assistant response.
- Emits only pass/fail, HTTP status, and sanitized model identifier; it must not print headers, credentials, prompt content, or raw response.
- A requested canary lacking required configuration is a verifier configuration error, not a skipped success.

### Checkpoint runner

Add a thin checkpoint interface to the verifier rather than a second source of validation logic. A checkpoint label such as `T+0`, `T+1h`, `T+6h`, or `T+24h` may be provided.

When report output is requested, the verifier writes one sanitized report under a gitignored runtime directory. The report contains:

- timestamp;
- checkpoint label;
- expected and live commit;
- aggregate gate statuses;
- PM2 status and unstable restart count;
- WARP boolean status;
- aggregate sensitive connection totals, strict totals, and drift count;
- canary status when requested;
- overall status and process exit code.

Reports must not contain raw command output or sensitive values. Existing reports are immutable; filename collisions fail rather than overwrite prior evidence.

## Exit Contract

- `0`: all required gates passed, and the canary passed when requested.
- `1`: one or more operational gates failed.
- `2`: verifier usage, dependency, environment, or configuration is invalid.

Every exit path prints an overall sanitized summary. A report requested by the caller records the same final status when it can be written safely.

## Manual Soak Workflow

Run checkpoints at:

- `T+0`: immediately after the verifier is implemented and locally validated;
- `T+1h`;
- `T+6h`;
- `T+24h`.

The canary is required at `T+0` and `T+24h`. It is optional at intermediate checkpoints.

The manual soak passes only when:

- all required gates pass at all four checkpoints;
- no sensitive direct fallback is detected;
- strict-proxy drift remains zero;
- WARP remains active;
- PM2 remains online with zero unstable restarts;
- the required canaries pass.

Elapsed checkpoint timing is operational guidance rather than a reason for a long-running agent process. Each checkpoint is an independent invocation; no background sleep process is created.

## Scheduler Phase

Scheduler installation is outside the first implementation plan. After `T+24h` passes:

1. Inspect existing scheduler and retention state before modifying it.
2. Propose the exact schedule, command, report path, retention mechanism, and failure-notification behavior.
3. Obtain separate explicit approval.
4. Install by merging with existing configuration rather than replacing it.

Recommended initial schedule after approval: every 15 minutes, seven-day sanitized report retention, no automated restart or repair.

## Security and Privacy

- Query only aggregate strict-proxy state; never emit connection IDs, names, emails, or serialized connection data.
- Open the SQLite database read-only.
- Never source `.env` files or enumerate credential locations.
- Treat all HTTP bodies as sensitive by default; parse only required fields and discard raw bodies.
- Mask unexpected errors into stable gate failure reasons.
- Use bounded network timeouts.
- Restrict report permissions to the current user where supported.
- Do not follow report paths outside the repository runtime-report directory.

## Error Handling

Each gate returns a structured internal status: `pass`, `fail`, or `error`.

- `fail` means the live system was checked and did not satisfy an operational requirement.
- `error` means the verifier could not perform a valid check due to missing tools, malformed state, or invalid configuration.
- Optional checks not requested are `not_run` and do not affect success.

The verifier must not silently convert an execution error into a passing or skipped gate.

## Testing Strategy

Use TDD for the verifier logic and shell interface.

Automated coverage must include:

- healthy full run;
- journal not `DONE`;
- source stamp mismatch;
- branch divergence;
- unhealthy endpoint or malformed version JSON;
- missing or unstable PM2 process;
- WARP listener absent and `warp=off`;
- strict-proxy drift;
- protected endpoint unexpectedly public;
- direct-fallback and invalid-protocol log findings;
- requested canary success, request failure, and missing configuration;
- report sanitization and collision behavior;
- exit codes `0`, `1`, and `2`.

Tests should inject command fixtures or use overridable command paths; they must not access the live database, PM2 daemon, WARP endpoint, or external network.

Acceptance validation runs the real verifier against live `:20128` after automated tests pass. The first acceptance run is the `T+0` checkpoint.

## Operational Boundaries

- The verifier remains separate from `scripts/deploy-9router.sh` in this iteration.
- Deployment success continues to depend on the deploy script's existing health gate.
- The verifier is an additional post-deploy and soak acceptance tool, not a rollback trigger.
- Any future integration into deployment or scheduling requires a new design decision and approval.

## Success Criteria

The design is complete when the implementation can reproducibly evaluate all required gates, write a sanitized checkpoint report, preserve the exit contract, pass automated failure-path tests, and complete a live `T+0` checkpoint without exposing sensitive data.
