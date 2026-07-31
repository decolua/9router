# Upstream Branch Synchronization Design

**Date:** 2026-07-31

## Goal

Synchronize the latest `decolua/9router` `master` into the fork's integration branch and the ten feature/fix branches already represented in `fork-sync`. Resolve only merge-induced conflicts and regressions, then merge the updated branches back into `fork-sync` without rewriting published history or pushing any remote.

For Codex, the fetched `decolua/9router` `master` is authoritative. Preserve its complete supported Codex implementation, including any raw ChatGPT access-token path that still exists upstream; remove code only when comparison proves it is a fork-only Codex delta.

## Branch Scope

Update these branches:

1. `feat/per-account-model-whitelist`
2. `feature/cached-token-clean`
3. `feature/cached-token-tracking`
4. `feature/mrdev-custom-provider`
5. `fix/anthropic-compatible-bearer-auth`
6. `fix/compatible-provider-multiple-keys`
7. `fix/minimax-m3-test-button`
8. `fix/openai-compatible-api-type-cache-key`
9. `fix/openai-compatible-api-type-cache-key-clean`
10. `fix/param-support-strip-rules`

Exclude PR, archive, local-only, and temporary worktree branches.

## Safety and Recovery

1. Record the starting SHA of `master`, `fork-sync`, and every scoped branch.
2. Create a local Git bundle containing the starting refs before changing branches.
3. Record whether each local change is staged, unstaged, or untracked, then stash tracked and untracked work—including `package.json` and `open-sse/providers/registry/kimi-coding.js`—with a descriptive name.
4. Restore the stash with `git stash apply --index`, not `pop`, so both index state and the backup remain available until restoration is verified.
5. Do not use `reset --hard`, force-push, or history-rewriting rebase.
6. Do not push any remote as part of this work.

If stash restoration conflicts, preserve the stash, report the conflict, and do not discard either side.

## Synchronization Flow

1. Before changing refs, run and record the current build, lint, Vitest regression-baseline result, and relevant specialized baseline verifiers. Environment-only failures become part of the pre-sync comparison record, not automatic merge regressions.
2. Fetch `origin` (`decolua/9router`) and `fork`.
3. Fast-forward local `master` to `origin/master`. If local `master` is not an ancestor of `origin/master`, stop the whole synchronization and preserve all refs; do not invent a merge or discard local commits.
4. Process the scoped branches in this fixed order:
   1. `feature/mrdev-custom-provider`
   2. `feature/cached-token-tracking`
   3. `feature/cached-token-clean`
   4. `feat/per-account-model-whitelist`
   5. `fix/anthropic-compatible-bearer-auth`
   6. `fix/compatible-provider-multiple-keys`
   7. `fix/minimax-m3-test-button`
   8. `fix/openai-compatible-api-type-cache-key`
   9. `fix/openai-compatible-api-type-cache-key-clean`
   10. `fix/param-support-strip-rules`
5. For each scoped branch:
   - compare it with its configured `fork/*` tracking ref;
   - fast-forward from that tracking ref only when the local branch is its ancestor;
   - continue from the local branch unchanged when the remote tracking ref is its ancestor;
   - stop the whole synchronization if local and tracking refs have both advanced, because reconciling that remote divergence is outside this approved design;
   - merge the updated `master` into the branch without rebasing;
   - resolve conflicts according to the policy below;
   - run focused validation for the affected behavior;
   - keep the synchronization and any required regression fix on that branch.
6. Merge the ten updated branches into `fork-sync` in the same fixed order.
7. Run final repository validation and review.
8. Apply the preserved stash to `fork-sync` and verify that the original staged, unstaged, and untracked states remain intact.

## Conflict Resolution Policy

For each conflict, inspect the merge base, branch side, upstream side, and relevant upstream commit. Do not resolve conflict sets wholesale with `ours` or `theirs`.

Prefer upstream architecture and public contracts, then port the branch's intended behavior onto the new structure with the smallest correct diff. Preserve custom features unless comparison with the fetched upstream proves that a Codex change is fork-only and no longer wanted.

If code and tests do not establish a safe resolution, abort the in-progress merge, stop the whole synchronization, and leave `fork-sync` at its recorded starting integration state. Do not merge a partial subset into `fork-sync`. Completed branch commits remain recoverable through their refs and the bundle for a later retry.

## Codex Policy

Use the fetched `decolua/9router` `master` Codex implementation as the source of truth.

Preserve every Codex behavior present upstream, including official OAuth, token refresh, account metadata, UI, APIs, executors, tests, bulk OAuth import, and any manual ChatGPT access-token path that upstream still supports. The cached upstream currently contains the manual access-token feature, so its mere presence is not evidence of fork customization.

After fetching, compare Codex-related files and their history against `origin/master`. Remove a Codex behavior only if the comparison proves it is a fork-only delta and its sole responsibility is a custom ChatGPT session/access-token request path. Do not remove a file or block merely because it accepts an access token: official OAuth and bulk OAuth imports also carry access tokens.

Do not remove unrelated fork customizations. Do not add a migration or compatibility layer for existing records. Existing SQLite data is not deleted automatically.

When a Codex conflict occurs, begin with the fetched upstream implementation and port back only intentional fork behavior. Focused acceptance checks must prove that upstream Codex OAuth login, credential selection, request headers, refresh, bulk import, and any upstream-retained manual-token behavior remain covered and passing.

## Regression Scope

Fix only regressions caused by this synchronization:

- new build or lint failures;
- tests that fail after synchronization but passed in the recorded pre-sync run, excluding failures proven to be environment-only;
- focused tests demonstrating incorrect behavior in a conflict-resolved path;
- unintended provider, alias, OAuth URL, translator, or registry snapshot changes.

Record existing baseline failures without expanding this task to fix them. Do not refactor unrelated code.

## Validation

### Per branch

Run focused lint and tests for files and execution paths changed by upstream integration or conflict resolution. Run the relevant baseline verifier after provider registry, alias, OAuth URL, or translator changes.

### Final `fork-sync`

Run:

- `npx eslint .`;
- `npm run build`;
- the Vitest suite using the repository-supported invocation;
- `tests/__baseline__/verify-no-regression.mjs` and any relevant specialized baseline verifier.

Judge the suite against both the recorded pre-sync results and the repository's committed known-failure baseline rather than requiring an absolutely green raw run.

Run code review on the complete integration diff. Run security review when changed regions include OAuth, credentials, external requests, token refresh, authentication, or authorization.

Inspect the final diff from the original `fork-sync` SHA for secrets, generated artifacts, debug output, and unrelated changes.

## Completion Criteria

The synchronization is complete when:

- local `master` matches the fetched `origin/master`;
- every scoped branch contains the new `master` ancestry;
- every scoped branch is merged into `fork-sync`;
- no merge conflict remains;
- validation shows no new regression beyond the known baseline;
- the final Codex behavior matches fetched upstream plus only intentional, unrelated fork customizations; no upstream Codex capability is removed merely because it accepts an access token;
- the original uncommitted work is restored, or its stash remains safely preserved if restoration conflicts;
- no remote was pushed.

## Rollback

Use the recorded SHAs and local bundle to restore individual refs. Never use a destructive reset against unpreserved local work. Keep the original stash until the user confirms the restored local changes are correct.
