# Devin Cloud Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Devin Cloud as a first-class OAuth provider in 9router with Connect/protobuf streaming, dynamic model discovery, Dashboard OAuth, and a remote copy-paste callback fallback.

**Architecture:** Keep Devin Cloud separate from the existing local `devin-cli` ACP provider and the existing Windsurf executor. Add a registry entry and specialized executor that converts 9router's translated OpenAI-style request into Devin's gzip-framed Connect/protobuf request, then returns OpenAI-compatible SSE. Add a provider-specific OAuth implementation and callback session support that auto-completes locally but accepts a pasted callback URL when 9router is remote.

**Tech Stack:** ESM JavaScript, Next.js route handlers, Node built-ins (`crypto`, `zlib`, `http`), Vitest, existing 9router registry/executor/OAuth abstractions.

## Global Constraints

- Do not add an external protobuf or Connect dependency; use small local wire helpers and Node built-ins.
- Do not modify the existing `devin-cli` ACP provider behavior.
- Do not reuse the Windsurf executor; Devin uses different service names, protobuf fields, and gzip Connect framing.
- Do not add a generic Devin OAuth refresh grant; the current Devin token is stored as `accessToken`, with `refreshToken: null` and `expiresAt: null`.
- Never log OAuth codes, callback URLs, PKCE verifiers, access tokens, user JWTs, or raw token-bearing upstream payloads.
- Validate OAuth state before token exchange and bound Connect frame payloads before decompression.
- Every implementation task ends with a focused test command and a Conventional Commit.
- The provider must preserve existing connection fallback, proxy options, abort signals, usage tracking, and translated client formats.

---

## File Map

### New files

- `open-sse/providers/registry/devin.js` — Devin identity, transport metadata, OAuth metadata, and static fallback models.
- `open-sse/executors/devin.js` — Devin protobuf encoding, Connect framing, response decoding, and specialized executor.
- `open-sse/services/devinModels.js` — Devin model-discovery request and protobuf decoder with static fallback-independent return values.
- `src/lib/oauth/providers/devin.js` — PKCE URL creation, callback parsing, token exchange, and credential mapping.
- `tests/unit/devin-protocol.test.js` — deterministic wire-format and frame/parser tests.
- `tests/unit/devin-executor.test.js` — mocked fetch and SSE executor tests.
- `tests/unit/devin-oauth.test.js` — OAuth URL, PKCE, callback, token mapping, and registry tests.

### Modified files

- `open-sse/providers/registry/index.js` — add generated-style static import/list entry for `devin.js`.
- `open-sse/executors/index.js` — register/export `DevinExecutor` under `devin`.
- `src/lib/oauth/constants/oauth.js` — expose `DEVIN_CONFIG` from registry OAuth data.
- `src/lib/oauth/providers/index.js` — import and register Devin OAuth provider.
- `src/lib/oauth/utils/server.js` — add Devin callback session/proxy lifecycle and remote-safe callback exchange support.
- `src/app/api/oauth/[provider]/[action]/route.js` — route Devin start/register/poll/stop proxy actions and pasted callback exchange.
- `src/app/api/providers/[id]/models/route.js` — add Devin custom model resolver using `resolveDevinModels`.
- `src/shared/components/OAuthModal.js` — treat Devin as proxy OAuth with manual callback URL fallback.
- `tests/__baseline__/providers-baseline.json` — regenerate intentionally after adding the provider, if the baseline verifier requires it.
- `tests/__baseline__/oauth-urls-baseline.json` — regenerate intentionally after adding Devin OAuth metadata, if the baseline verifier requires it.

---

## Task 1: Add the Devin registry contract

**Files:**
- Create: `open-sse/providers/registry/devin.js`
- Modify: `open-sse/providers/registry/index.js`
- Test: `tests/unit/devin-oauth.test.js`

**Interfaces:**
- Produces `REGISTRY` entry `id: "devin"`, alias `"dv"`, `category: "oauth"`, `authType: "oauth"`, `hasOAuth: true`, and `authModes: ["oauth"]`.
- Produces static models `swe-1-7` and `swe-1-6`.
- Produces OAuth fields consumed by `src/lib/oauth/providers/devin.js`: `authorizeUrl`, `tokenUrl`, `codeChallengeMethod`, `callbackPath`, and `oauthTimeoutMs`.
- Produces transport metadata consumed by `DevinExecutor`: `baseUrl`, `format: "openai"`, and `forceStream: true`.

- [ ] **Step 1: Write the registry assertions**

```js
import { describe, expect, it } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "open-sse/providers/index.js";

describe("Devin registry", () => {
  it("exposes OAuth metadata and static fallback models", () => {
    const entry = REGISTRY.find((item) => item.id === "devin");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("dv");
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth"]);
    expect(PROVIDER_OAUTH.devin.callbackPath).toBe("/callback");
    expect(PROVIDER_OAUTH.devin.callbackPort).toBe(59653);
    expect(PROVIDERS.devin.forceStream).toBe(true);
    expect(PROVIDER_MODELS.dv.map((model) => model.id)).toEqual(["swe-1-7", "swe-1-6"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because Devin is absent**

Run: `npx vitest run tests/unit/devin-oauth.test.js -t "Devin registry"`

Expected: FAIL because no `devin` registry entry exists yet.

- [ ] **Step 3: Add the minimal registry entry**

Use these constants:

```js
const DEVIN_WEB_URL = "https://app.devin.ai";
const DEVIN_API_URL = "https://api.devin.ai";
const DEVIN_HOST = "https://server.codeium.com";

export default {
  id: "devin",
  alias: "dv",
  uiAlias: "dv",
  display: {
    name: "Devin",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "DV",
    website: DEVIN_WEB_URL,
    notice: { signupUrl: DEVIN_WEB_URL },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  transport: {
    baseUrl: `${DEVIN_HOST}/exa.api_server_pb.ApiServerService/GetChatMessage`,
    format: "openai",
    forceStream: true,
  },
  models: [
    { id: "swe-1-7", name: "SWE-1.7" },
    { id: "swe-1-6", name: "SWE-1.6" },
  ],
  oauth: {
    authorizeUrl: `${DEVIN_WEB_URL}/auth/cli/continue`,
    tokenUrl: `${DEVIN_API_URL}/auth/cli/token`,
    apiUrl: DEVIN_API_URL,
    host: DEVIN_HOST,
    codeChallengeMethod: "S256",
    callbackPath: "/callback",
    callbackPort: 59653,
    oauthTimeoutMs: 600_000,
  },
};
```

Add the import and array element in the generated-style alphabetical section of `open-sse/providers/registry/index.js`.

- [ ] **Step 4: Run registry and baseline-focused tests**

Run: `npx vitest run tests/unit/devin-oauth.test.js -t "Devin registry" tests/unit/provider-display-split.test.js`

Expected: PASS for Devin assertions and no provider-display regression.

- [ ] **Step 5: Commit**

```bash
git add open-sse/providers/registry/devin.js open-sse/providers/registry/index.js tests/unit/devin-oauth.test.js
git commit -m "feat(provider): register Devin Cloud"
```

---

## Task 2: Implement deterministic Devin wire helpers

**Files:**
- Create: `open-sse/executors/devin.js`
- Test: `tests/unit/devin-protocol.test.js`

**Interfaces:**
- `normalizeDevinSessionToken(apiKey)` returns a string with exactly one `devin-session-token$` prefix.
- `buildUserJwtRequest(apiKey)` returns a `Buffer` protobuf request.
- `buildDevinChatRequest({ model, body, apiKey, userJwt, sessionId })` returns a `Buffer` protobuf request.
- `frameDevinConnect(payload, compressed = true)` returns a `Buffer` with a 5-byte Connect frame header.
- `parseDevinConnectFrames(input, maxPayload = 16 * 1024 * 1024)` returns `{ frames, rest }` and preserves incomplete trailing bytes.
- `decodeDevinChatDelta(payload)` returns one of `text`, `thinking`, `tool`, `usage`, `stop`, `message`, or `unknown` records.
- `decodeDevinTrailer(payload)` returns an error string or `undefined`.

- [ ] **Step 1: Write failing protocol tests**

Include tests for prefix normalization, nested protobuf fields, gzip framing, split frames, oversized frames, and each response delta:

```js
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  normalizeDevinSessionToken,
  frameDevinConnect,
  parseDevinConnectFrames,
  decodeDevinChatDelta,
} from "open-sse/executors/devin.js";

describe("Devin protocol", () => {
  it("normalizes the session token once", () => {
    expect(normalizeDevinSessionToken("abc")).toBe("devin-session-token$abc");
    expect(normalizeDevinSessionToken("devin-session-token$abc")).toBe("devin-session-token$abc");
  });

  it("round-trips a compressed Connect frame", () => {
    const payload = Buffer.from("hello");
    const frame = frameDevinConnect(payload);
    const parsed = parseDevinConnectFrames(frame);
    expect(parsed.rest.length).toBe(0);
    expect(parsed.frames).toHaveLength(1);
    expect(gunzipSync(parsed.frames[0].payload)).toEqual(payload);
  });

  it("keeps incomplete frames for the next network read", () => {
    const frame = frameDevinConnect(Buffer.from("hello"));
    const first = parseDevinConnectFrames(frame.subarray(0, 6));
    expect(first.frames).toEqual([]);
    expect(first.rest).toEqual(frame.subarray(0, 6));
  });

  it("decodes text deltas", () => {
    const payload = Buffer.from([0x1a, 0x05, ...Buffer.from("hello")]);
    expect(decodeDevinChatDelta(payload)).toEqual({ type: "text", value: "hello" });
  });
});
```

- [ ] **Step 2: Run the protocol tests and verify they fail**

Run: `npx vitest run tests/unit/devin-protocol.test.js`

Expected: FAIL because the Devin protocol exports do not exist.

- [ ] **Step 3: Implement bounded protobuf and framing helpers**

Use `Buffer`, `node:zlib`, and `crypto.randomUUID()`. Parse only protobuf wire types 0, 1, 2, and 5. Reject varints longer than 10 bytes, lengths beyond the input buffer, and frames over `16 * 1024 * 1024` bytes. `parseDevinConnectFrames` must not discard a partial header or payload.

Use the field mappings already verified in `pi-devin-provider`:

```text
Chat response:
field 1: message id string
field 3: text string
field 5: stop reason varint
field 6: tool call message {1:id, 2:name, 3:arguments_json}
field 7: usage message {2:input, 3:output, 4:cache_write, 5:cache_read}
field 9: thinking string
field 10: thinking signature string associated with the preceding thinking delta
```

- [ ] **Step 4: Run protocol tests to verify they pass**

Run: `npx vitest run tests/unit/devin-protocol.test.js`

Expected: PASS, including malformed and boundary cases.

- [ ] **Step 5: Commit**

```bash
git add open-sse/executors/devin.js tests/unit/devin-protocol.test.js
git commit -m "feat(devin): add Connect protobuf protocol helpers"
```

---

## Task 3: Add the Devin specialized executor

**Files:**
- Modify: `open-sse/executors/devin.js`
- Modify: `open-sse/executors/index.js`
- Test: `tests/unit/devin-executor.test.js`

**Interfaces:**
- `DevinExecutor` extends `BaseExecutor` and uses `PROVIDERS.devin`.
- `buildHeaders(credentials)` returns Connect headers without leaking the token into non-required headers.
- `execute({ model, body, stream, credentials, signal, log, proxyOptions })` returns `{ response, url, headers, transformedBody }` where `response` is an OpenAI-compatible SSE `Response` for successful upstream calls and the original non-2xx response for standard error handling.
- `getExecutor("devin")` returns a `DevinExecutor` instance.

- [ ] **Step 1: Write failing executor tests**

Mock `global.fetch` or the repository fetch seam with one protobuf `GetUserJwt` response and one framed chat stream. Assert request ordering, headers, and emitted SSE:

```js
import { describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { DevinExecutor, frameDevinConnect } from "open-sse/executors/devin.js";

describe("Devin executor", () => {
  it("is registered as a specialized executor", () => {
    expect(getExecutor("devin")).toBeInstanceOf(DevinExecutor);
  });

  it("calls GetUserJwt before streaming GetChatMessage", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (String(url).includes("GetUserJwt")) {
        return new Response(Buffer.from([0x0a, 0x03, ...Buffer.from("jwt")]), { status: 200 });
      }
      const text = Buffer.from([0x1a, 0x05, ...Buffer.from("hello")]);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frameDevinConnect(text));
          controller.close();
        },
      }), { status: 200 });
    });

    const executor = new DevinExecutor();
    const result = await executor.execute({
      model: "swe-1-7",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "session-token" },
      signal: undefined,
    });
    const output = await result.response.text();

    expect(calls.map((call) => String(call.url))).toEqual([
      expect.stringContaining("GetUserJwt"),
      expect.stringContaining("GetChatMessage"),
    ]);
    expect(output).toContain("hello");
    expect(output).toContain("[DONE]");
  });
});
```

Also cover non-2xx responses, trailer errors, tool calls, usage, and abort signals.

- [ ] **Step 2: Run executor tests and verify they fail**

Run: `npx vitest run tests/unit/devin-executor.test.js`

Expected: FAIL because `DevinExecutor` is not registered and the specialized execution path does not exist.

- [ ] **Step 3: Implement `DevinExecutor`**

Implementation sequence:

1. Read `credentials.accessToken || credentials.apiKey`; reject missing credentials with `Error("No Devin credential")`.
2. Call `GetUserJwt` using the normalized token and the request signal.
3. Build the Devin protobuf request from translated `body.messages`, `body.tools`, `body.system`, `body.max_tokens`, `body.temperature`, and `model`.
4. gzip and frame the request.
5. POST to the registry Devin chat URL using `proxyAwareFetch` and `proxyOptions`.
6. For a non-2xx response, return it unchanged so the existing error path sees its status.
7. For a successful response, consume frames incrementally and emit `text/event-stream` chunks.
8. Accumulate tool arguments by tool ID and emit valid OpenAI tool-call chunks.
9. Map usage and stop reason into the final chunk, emit `data: [DONE]`, and close the stream.
10. On abort, stop reading and close without emitting a misleading successful completion.

The executor must use `model.id` as the Devin model identifier after `getModelUpstreamId` has resolved the model in `chatCore`.

- [ ] **Step 4: Register the executor and run focused tests**

Add:

```js
import { DevinExecutor } from "./devin.js";
// ...
  devin: new DevinExecutor(),
// ...
export { DevinExecutor } from "./devin.js";
```

Run: `npx vitest run tests/unit/devin-protocol.test.js tests/unit/devin-executor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add open-sse/executors/devin.js open-sse/executors/index.js tests/unit/devin-executor.test.js
git commit -m "feat(devin): add Cloud streaming executor"
```

---

## Task 4: Implement Devin model discovery

**Files:**
- Create: `open-sse/services/devinModels.js`
- Modify: `src/app/api/providers/[id]/models/route.js`
- Test: `tests/unit/devin-protocol.test.js`

**Interfaces:**
- `discoverDevinModels(apiKey, { signal, fetchImpl } = {})` returns `Promise<ModelEntry[]>` and throws on unusable upstream responses.
- `decodeDiscoveredDevinModels(payload)` returns normalized model entries without performing network access.
- `getStaticProviderModels("devin")` remains the fallback source in the route.

- [ ] **Step 1: Add failing discovery decoder tests**

Test a protobuf model config with fields from `pi-devin-provider`:

```text
field 1: display name
field 4: disabled flag/status (only enabled configs survive)
field 5: image input support
field 18: context window
field 22: model ID
```

Assert that the decoder returns `{ id, name, contextLength, maxOutputTokens, input }` and filters disabled or missing-ID configs.

- [ ] **Step 2: Run discovery tests and verify they fail**

Run: `npx vitest run tests/unit/devin-protocol.test.js -t "discovery"`

Expected: FAIL because the discovery module/export does not exist.

- [ ] **Step 3: Implement discovery with timeout and gzip fallback**

Call:

```text
POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetCliModelConfigs
Content-Type: application/proto
Connect-Protocol-Version: 1
```

Use `AbortSignal.any([signal, AbortSignal.timeout(5000)])` when a caller signal exists, otherwise `AbortSignal.timeout(5000)`. Decode raw protobuf first and retry decoding as gzip only when the raw payload is not a valid protobuf envelope. Return sorted unique enabled models with a 200,000 context default and a 64,000 max-output cap.

- [ ] **Step 4: Add the Devin route resolver**

Import `discoverDevinModels` and add this resolver to `PROVIDER_MODELS_CONFIG`:

```js
  devin: {
    customResolver: async (connection) => {
      try {
        const models = await discoverDevinModels(connection.accessToken, {});
        if (models.length) return { models };
        return {
          models: getStaticProviderModels("devin"),
          warning: "Devin returned no enabled models; using the static catalog.",
        };
      } catch (error) {
        return {
          models: getStaticProviderModels("devin"),
          warning: `Failed to fetch Devin models: ${error.message}`,
        };
      }
    },
  },
```

Never include token values in the warning string.

- [ ] **Step 5: Run focused discovery and route tests**

Run: `npx vitest run tests/unit/devin-protocol.test.js tests/unit/provider-validation.test.js`

Expected: PASS with static fallback behavior unchanged for other providers.

- [ ] **Step 6: Commit**

```bash
git add open-sse/services/devinModels.js src/app/api/providers/[id]/models/route.js tests/unit/devin-protocol.test.js
git commit -m "feat(devin): add account model discovery"
```

---

## Task 5: Add Devin OAuth and callback session support

**Files:**
- Create: `src/lib/oauth/providers/devin.js`
- Modify: `src/lib/oauth/constants/oauth.js`
- Modify: `src/lib/oauth/providers/index.js`
- Modify: `src/lib/oauth/utils/server.js`
- Modify: `src/app/api/oauth/[provider]/[action]/route.js`
- Test: `tests/unit/devin-oauth.test.js`

**Interfaces:**
- `buildDevinAuthUrl(config, redirectUri, state, codeChallenge)` returns the exact Devin OAuth URL.
- `generateDevinPKCE()` returns `{ verifier, challenge }` using Web Crypto/Node crypto.
- `exchangeDevinToken(config, code, codeVerifier, fetchImpl = fetch)` returns `{ accessToken, refreshToken: null, expiresIn: null, expiresAt: null }`.
- `parseDevinCallback(raw, expectedState)` returns `{ code, state }` or throws on missing/mismatched values.
- Provider object follows the existing `getProvider`, `generateAuthData`, and `exchangeTokens` contract.
- Server exports `startDevinProxy`, `stopDevinProxy`, `registerDevinSession`, `getDevinSessionStatus`, and `clearDevinSession`.

- [ ] **Step 1: Write failing OAuth tests**

```js
import { describe, expect, it, vi } from "vitest";
import { buildDevinAuthUrl, parseDevinCallback } from "@/lib/oauth/providers/devin.js";

describe("Devin OAuth", () => {
  it("builds a stateful PKCE authorization URL", () => {
    const url = new URL(buildDevinAuthUrl(
      { authorizeUrl: "https://app.devin.ai/auth/cli/continue" },
      "http://127.0.0.1:59653/callback",
      "state-1",
      "challenge-1",
    ));
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:59653/callback");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("accepts a full pasted callback URL and validates state", () => {
    expect(parseDevinCallback(
      "http://127.0.0.1:59653/callback?code=abc&state=state-1",
      "state-1",
    )).toEqual({ code: "abc", state: "state-1" });
    expect(() => parseDevinCallback(
      "http://127.0.0.1:59653/callback?code=abc&state=wrong",
      "state-1",
    )).toThrow(/state/i);
  });
});
```

Add token-exchange assertions for JSON `{ code, code_verifier }`, missing-token rejection, and `refreshToken: null`.

- [ ] **Step 2: Run OAuth tests and verify they fail**

Run: `npx vitest run tests/unit/devin-oauth.test.js`

Expected: FAIL because Devin OAuth functions and registration do not exist.

- [ ] **Step 3: Implement the OAuth provider**

Use the `pi-devin-provider` contract:

```js
const DEVIN_CONFIG = {
  authorizeUrl: "https://app.devin.ai/auth/cli/continue",
  tokenUrl: "https://api.devin.ai/auth/cli/token",
  codeChallengeMethod: "S256",
  callbackPath: "/devin-auth-callback",
};
```

`buildAuthUrl` must include `redirect_uri`, `state`, `prompt=select_account`, `code_challenge`, and `code_challenge_method=S256`. `exchangeToken` must POST JSON `{ code, code_verifier }` with `Accept` and `Content-Type: application/json`. `mapTokens` must return `accessToken`, `refreshToken: null`, `expiresIn: null`, `expiresAt: null`, and `providerSpecificData` containing only non-secret endpoint/auth metadata.

- [ ] **Step 4: Implement the callback proxy/session lifecycle**

Follow the existing callback-session pattern but use separate variables and Devin's fixed callback path/port. The session record must include:

```js
{
  state,
  codeVerifier,
  redirectUri,
  status: "pending",
  createdAt: Date.now()
}
```

`registerDevinSession` receives the verifier through a POST body, not a URL. The proxy validates loopback origin and exact state, then calls `exchangeTokens("devin", rawCallback, redirectUri, codeVerifier, state)` and creates a `devin` OAuth connection. On success it stores only connection metadata in the in-memory session status. On failure it stores a sanitized error message and stops the proxy.

- [ ] **Step 5: Add route actions**

In `src/app/api/oauth/[provider]/[action]/route.js`:

- `start-proxy`: start Devin proxy and return callback URL.
- `register-session`: accept `state`, `codeVerifier`, and `redirectUri` from the POST body.
- `poll-status`: read Devin session status and clear completed/error sessions.
- `stop-proxy`: stop Devin proxy.
- `exchange`: accept a pasted full callback URL from remote users, parse it through `exchangeTokens`, use the registered server-side verifier when available, and persist the connection.

Do not add Devin to the existing Windsurf branches; keep provider-specific state isolated.

- [ ] **Step 6: Run OAuth tests and route module checks**

Run: `npx vitest run tests/unit/devin-oauth.test.js tests/unit/oauth-cursor-auto-import.test.js`

Expected: PASS for Devin OAuth tests and no unrelated OAuth regression.

- [ ] **Step 7: Commit**

```bash
git add src/lib/oauth/providers/devin.js src/lib/oauth/constants/oauth.js src/lib/oauth/providers/index.js src/lib/oauth/utils/server.js src/app/api/oauth/[provider]/[action]/route.js tests/unit/devin-oauth.test.js
git commit -m "feat(devin): add Dashboard OAuth flow"
```

---

## Task 6: Wire the Dashboard local/remote OAuth UX

**Files:**
- Modify: `src/shared/components/OAuthModal.js`
- Test: `tests/unit/devin-oauth.test.js`

**Interfaces:**
- Devin is included in the proxy OAuth set.
- The modal sends `state`, `codeVerifier`, and `redirectUri` to `/api/oauth/devin/register-session`.
- The modal polls `/api/oauth/devin/poll-status` for automatic local completion.
- The modal accepts a pasted full callback URL and sends it to `/api/oauth/devin/exchange` when auto callback is unavailable.

- [ ] **Step 1: Add the Devin UX assertions or source-level contract test**

Assert that the OAuth modal's provider sets include `devin`, the proxy flow submits the verifier through POST, and manual submit sends the complete callback URL rather than extracting only a token.

- [ ] **Step 2: Run the test before implementation**

Run: `npx vitest run tests/unit/devin-oauth.test.js -t "modal"`

Expected: FAIL because the modal does not yet include Devin in its provider-specific sets.

- [ ] **Step 3: Update the modal minimally**

Add `devin` to `PROXY_OAUTH_PROVIDERS`. In `startProxyFlow`, include `codeVerifier` and `redirectUri` in the register-session POST body. Reuse the existing `authData.proxyProvider` polling branch. In manual submit, treat Devin like the other proxy providers: submit `{ code: input, state: authData?.state }` to the provider exchange endpoint and show success/error using existing modal state.

The callback URL placeholder must explain that the user should paste the complete URL copied from the browser address bar when 9router is remote.

- [ ] **Step 4: Run Dashboard-related unit checks**

Run: `npx vitest run tests/unit/devin-oauth.test.js tests/unit/provider-display-split.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/OAuthModal.js tests/unit/devin-oauth.test.js
git commit -m "feat(devin): support remote OAuth callback paste"
```

---

## Task 7: Regenerate baselines and run integration verification

**Files:**
- Modify: `tests/__baseline__/providers-baseline.json` if provider snapshot intentionally changes.
- Modify: `tests/__baseline__/oauth-urls-baseline.json` if OAuth snapshot intentionally changes.
- Test: `tests/unit/devin-protocol.test.js`, `tests/unit/devin-executor.test.js`, `tests/unit/devin-oauth.test.js`.

- [ ] **Step 1: Run all Devin-focused tests**

Run:

```bash
npx vitest run \
  tests/unit/devin-protocol.test.js \
  tests/unit/devin-executor.test.js \
  tests/unit/devin-oauth.test.js
```

Expected: PASS with no network credentials.

- [ ] **Step 2: Run provider baseline verification**

Run:

```bash
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-oauth-urls.mjs
```

Expected: Either PASS without changes or a diff containing only the intentional `devin` provider/OAuth entries. If the scripts require snapshots to be regenerated, run their documented snapshot command and inspect the JSON diff before committing.

- [ ] **Step 3: Run the repository's relevant regression tests**

Run:

```bash
npx vitest run \
  tests/unit/provider-display-split.test.js \
  tests/unit/provider-validation.test.js \
  tests/unit/devin-cli-executor.test.js \
  tests/unit/windsurf-executor.test.js
```

Expected: PASS, preserving existing Devin CLI and Windsurf behavior.

- [ ] **Step 4: Run lint on changed JavaScript files**

Run:

```bash
npx eslint \
  open-sse/providers/registry/devin.js \
  open-sse/executors/devin.js \
  open-sse/services/devinModels.js \
  open-sse/executors/index.js \
  src/lib/oauth/providers/devin.js \
  src/lib/oauth/constants/oauth.js \
  src/lib/oauth/providers/index.js \
  src/lib/oauth/utils/server.js \
  'src/app/api/oauth/[provider]/[action]/route.js' \
  'src/app/api/providers/[id]/models/route.js' \
  src/shared/components/OAuthModal.js
```

Expected: no new lint errors.

- [ ] **Step 5: Inspect coverage and final diff**

Run:

```bash
git diff --check master...HEAD
git diff --stat master...HEAD
git status --short
```

Confirm no credentials, callback URLs, generated artifacts, or unrelated files are present.

- [ ] **Step 6: Commit any intentional baseline updates**

```bash
git add tests/__baseline__/providers-baseline.json tests/__baseline__/oauth-urls-baseline.json
git commit -m "test(provider): update Devin baselines"
```

Only create this commit if the baseline files changed and the changes contain Devin entries only.

- [ ] **Step 7: Final branch report**

Report the feature branch, commits, focused test results, lint result, baseline result, and any limitations such as lack of live Devin credentials.
