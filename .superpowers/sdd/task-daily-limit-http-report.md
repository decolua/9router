# Daily-limit HTTP proof report

## TDD result

RED attempt ran before any production change:

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/chat-daily-limit-http.test.js
exit code: 0
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    1.45s
```

No failing RED: existing `0e89145` handler behavior already satisfied the new route-level regression. Per brief, no production change was made.

GREEN confirmation:

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/chat-daily-limit-http.test.js
exit code: 0
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    1.51s
```

## Verification

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr
command: npx eslint tests/unit/chat-daily-limit-http.test.js
exit code: 0
output: none
```

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/db-sqlite-vs-lowdb.test.js
exit code: 0
Test Files  1 passed (1)
Tests       22 passed (22)
Duration    844ms
```

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr
command: git diff --check
exit code: 0
output: none
```

## Review warnings requiring test hardening

1. Do not replace the entire `@/sse/services/auth.js` module. Let real `extractApiKey` parse the Bearer header; mock or spy only provider credential/account side effects.
2. Add one under-limit or unlimited sibling proving the same harness reaches provider/model/account selection and `handleChatCore`, while keeping upstream network mocked.
3. Supply a valid `getModelInfo` result for the control path.
4. Remove dead `isValidApiKey` setup unless `requireApiKey` is explicitly enabled and real validation is part of this test.
5. Run focused RED by first adding the control against current over-mocked harness, then make minimum test-harness fixes. No production edit unless a real behavior defect appears.
6. Re-run focused test, DB parity, changed test lint, and `git diff --check`; append exact results and commit separately.

## Test hardening TDD result

RED, after adding the unlimited-key control but before fixing the over-mocked harness:

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/chat-daily-limit-http.test.js
exit code: 1
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
Duration    4.55s
failure: expected 429 to be 200
```

The full auth mock returned the exhausted key for the unlimited key's Bearer header. Production code was unchanged.

GREEN, after preserving real auth exports and mocking only account selection:

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/chat-daily-limit-http.test.js
exit code: 0
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    2.44s
```

Focused verification after clearing mock histories per test:

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/chat-daily-limit-http.test.js
exit code: 0
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    2.29s
```

## Test hardening verification

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr/tests
command: npx vitest run unit/db-sqlite-vs-lowdb.test.js
exit code: 0
Test Files  1 passed (1)
Tests       22 passed (22)
Duration    859ms
```

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr
command: npx eslint tests/unit/chat-daily-limit-http.test.js
exit code: 0
output: none
```

```text
cwd: /home/home/.openclaw/workspace-keyra/9router-daily-limit-pr
command: git diff --check
exit code: 0
output: none
```
