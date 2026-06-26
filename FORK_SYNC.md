# Fork-Sync Workflow

Branch `fork-sync` tracks the upstream `decolua/9router` master while
carrying our local fixes. Use this document whenever you sync with new
upstream changes.

## Layout

```
master              ← upstream tracking (decolua/9router master, fast-forwarded)
fork-sync           ← our dev branch: master + 9 fork-local commits
├─ 3ae230b fix(openai-compatible): honor API type override and cache key opt-in
├─ c7a7136 fix(openai-compatible): convert non-streaming responses output
├─ 5bd3109 fix(openai-compatible): harden responses conversion
├─ e6d4818 fix(openai-compatible): thread credentials through getTargetFormat end-to-end
├─ 4ed4248 docs(nonStreamingHandler): clarify translateNonStreamingResponse contract
├─ f44104d fix(paramSupport): strip xai grok reasoning params and add Sakana fugu rules
├─ ec24554 fix(kiro): tag external_idp tokens with EXTERNAL_IDP tokentype
├─ 023296a fix(executor): wire enforceParamMinimums into DefaultExecutor.transformRequest
└─ b271b83 docs(paramSupport): flag matches() fallthrough footgun
```

## Sync with new upstream master

When `decolua/9router` master moves ahead:

```bash
# 1. Update local master
git checkout master
git fetch origin
git reset --hard origin/master          # fast-forward master to upstream

# 2. Bring upstream changes into fork-sync
git checkout fork-sync
git merge --no-ff origin/master         # or rebase if you prefer linear history
```

## Conflict resolution policy

When `git merge origin/master` produces conflicts, the priority is:

1. **Upstream wins on shared files** (e.g. `provider.js`, `default.js`,
   `chatCore.js`) — these are the files upstream is most likely to
   actively maintain. Take upstream's version, then re-apply our
   fork-local changes by hand.
2. **Fork wins on files we own** — e.g. `open-sse/translator/concerns/paramSupport.js`
   rules we added (xAI Grok, Sakana fugu) are not yet in upstream. Keep
   our additions.
3. **For files we added that don't exist upstream** (new tests, new
   helper files) — keep ours.
4. **For the `getTargetFormat(provider, credentials = null)` signature** —
   upstream is on the 1-arg form. Our `e6d4818` re-applies the 2-arg
   form. After every merge, verify `chatCore.js:51` calls the 2-arg
   form, and `default.js:166` (or its successor) still threads
   credentials. If upstream changes either caller, restore the 2-arg
   call.

## Verify after every sync

```bash
# All tests from both PRs must remain green.
node --test \
  open-sse/services/provider.openaiCompatibleType.test.js \
  open-sse/services/provider.openaiCompatibleCredentials.test.js \
  open-sse/executors/default.promptCacheKey.test.js \
  open-sse/executors/default.paramSupport.test.js \
  open-sse/translator/response/openai-responses-nonstream.test.js \
  open-sse/translator/concerns/paramSupport.test.js
# Expected: 64/64 passing.
```

If upstream added new tests that conflict with ours (rare — the new
tests are in files upstream doesn't have), move ours to a subdirectory
or rename them and update the test runner include globs.

## When to open new PRs

- A new fork-local fix goes onto a topic branch, not directly onto
  `fork-sync`. PR it against `fork-sync` so the diff against upstream
  master stays focused.
- Topic branches rebase freely on top of `fork-sync` — they don't need
  to track upstream master separately.
- To propose a change upstream, cherry-pick the topic commits onto a
  fresh branch off `origin/master` and open a PR there. The `fork-sync`
  history (with cherry-pick hashes) doesn't have to match upstream
  exactly — the diff just needs to be the same.

## Recovery from a bad merge

If a merge from `origin/master` produces a tree that no longer matches
either side cleanly:

```bash
git merge --abort                     # bail out, fork-sync unchanged
git log --oneline master..fork-sync   # see what's about to be replayed
git checkout master
git pull                              # re-sync local master
git checkout fork-sync
git rebase master                     # replay our 9 commits onto fresh master
# resolve conflicts as above
```
