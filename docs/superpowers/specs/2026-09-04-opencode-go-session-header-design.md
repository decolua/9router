# OpenCode Go Session Header Design

## Problem

OpenCode Go will begin rejecting some requests without an
`x-opencode-session` header on September 6, 2026. In 9Router v0.5.65,
`opencode-go` uses `DefaultExecutor`, whose generic header builder does not add
that header. The specialized OpenCode Free executor already sends it, but that
logic does not apply to the paid OpenCode Go provider or its three transports.

## Goals

- Add `x-opencode-session` to every OpenCode Go chat, Claude Messages, and
  OpenAI Responses request.
- Translate a downstream conversation identity into a stable upstream identity.
- Keep identities isolated across different downstream agents and conversations.
- Avoid exposing non-OpenCode downstream session identifiers to OpenCode Go.
- Avoid mutable session state on the shared executor singleton.
- Leave OpenCode Free and all unrelated providers unchanged.

## Non-Goals

- Inferring an exact conversation boundary when a downstream client provides no
  session or conversation identifier.
- Adding or changing OpenCode Go models, routing, reasoning, or tool behavior.
- Changing the general session-resolution policy for other providers.

## Architecture

Add a dedicated `OpenCodeGoExecutor` extending `DefaultExecutor`. The executor
keeps the existing generic URL, authentication, translation, retry, and proxy
behavior, and overrides only the OpenCode Go session-header concern.

`handleChatCore` already resolves a provider-scoped session from the original
request before translation. It will pass that value and the detected client
tool to `executor.execute()` as request context. `OpenCodeGoExecutor.execute()`
will create a shallow request-local credentials object containing the resolved
OpenCode Go session. It will then delegate to `DefaultExecutor.execute()`.
This avoids storing request state on the executor singleton or mutating shared
provider credentials.

## Session Resolution

The original downstream request remains the source of truth. Existing
`resolveSessionId()` behavior recognizes Claude Code, Antigravity, generic
session headers, and common body fields before request translation can discard
them.

Resolution rules:

1. If the downstream request supplies `x-opencode-session`, treat it as an
   authoritative OpenCode identity after trimming and length validation.
2. Otherwise use the provider-scoped session resolved from the original request.
3. Namespace the resolved value with the detected downstream agent, falling back
   to `generic` when the agent is unknown.
4. Convert the namespaced value to an opaque deterministic identifier:
   `ses_` plus the first 32 hexadecimal characters of SHA-256.
5. If no explicit downstream identity exists, the existing provider connection
   fallback guarantees that a header is still sent. It is stable but cannot
   distinguish multiple conversations sharing that connection.

The same input conversation produces the same upstream identifier for all three
OpenCode Go transports. Different agents using the same raw session value
produce different identifiers.

## Header Injection

`OpenCodeGoExecutor.buildHeaders()` delegates to
`DefaultExecutor.buildHeaders()` and adds only:

```text
x-opencode-session: <stable-session-id>
```

The implementation applies to:

- `https://opencode.ai/zen/go/v1/chat/completions`
- `https://opencode.ai/zen/go/v1/messages`
- `https://opencode.ai/zen/go/v1/responses`

## Error Handling

Session derivation must not make requests fail. Invalid or oversized native
header values are ignored and the normal resolved-session fallback is used.
Hashing uses Node's built-in `crypto` module and requires no new dependency.

## Testing

Add a focused unit suite that proves:

- all three OpenCode Go transports receive the header;
- the same conversation remains stable across requests and transports;
- different conversations produce different values;
- different agents using the same raw ID remain isolated;
- non-OpenCode session IDs are represented as opaque `ses_<32 hex>` values;
- a valid native `x-opencode-session` remains stable;
- headerless requests still receive a stable fallback;
- OpenCode Free behavior is unchanged;
- unrelated `DefaultExecutor` providers do not receive the header;
- no request state is retained on the shared executor instance.

Run the focused unit tests first, then the neighboring executor/session tests,
the full offline test suite, the application build, and the CLI package build.

## Delivery

Build the CLI with `npm --prefix cli run build`, create a package with
`npm --prefix cli pack`, and install the generated tarball globally to replace
the current npm-installed `9router@0.5.65`. Verify the installed package version
and packaged source contains the new executor.

Upstream issue #3759 already tracks the problem, so no duplicate issue will be
created. The pull request will be narrowly scoped to this fix, reference
`Fixes #3759`, and explain how it differs from the broader open PR #3780.
