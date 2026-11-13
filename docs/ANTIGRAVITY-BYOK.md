# Antigravity desktop BYOK bridge

This experimental feature maps selected Antigravity desktop model IDs to
providers already registered in your local 9Router. Each mapped slot receives an
explicit BYOK display name. Requests for unconfigured generation targets are
rejected instead of falling back to Google's generation service.

The API provider receives the conversation and tool context sent by the desktop
client. Its own charges, access restrictions and rate limits apply. The bridge
does not increase Google credits, change subscription tiers, or promise support
for every Antigravity feature or future client version. It is an unofficial
integration and does not imply endorsement by the desktop vendor.

## Prerequisites

- A build of 9Router containing this branch's changes. The ordinary npm package
  does not acquire these changes until they are released upstream.
- Antigravity desktop installed and signed in normally.
- Your own API provider connections configured in 9Router and tested directly.
- An existing local 9Router API key allowed to access your target models.
- Administrator access on Windows for the hosts entries and local certificate.

Complete the existing 9Router certificate setup and explicitly trust your own
local CA before enabling this helper. The bootstrap does not silently install
certificate trust or include anyone else's CA private key.

Build the CLI from this checkout using the project's existing build workflow:

```sh
npm install
npm --prefix cli install
npm --prefix cli run build
```

The resulting `cli` directory contains the CLI package and built `app` tree. The
Windows bootstrap accepts that directory through `-InstallRoot`. It can also use
a globally installed package built from this branch. Keep that installation
available while using the shortcuts; the control helper verifies its files.

## Configure routes

Start by copying `examples/antigravity-byok.example.json` to a local file such as
`antigravity-byok.local.json`. Do not place API keys, OAuth tokens, passwords or
remote URLs in this policy; credentials and endpoints belong in the existing
9Router provider configuration.

```json
{
  "enabled": true,
  "mappings": {
    "ide-model-id": {
      "target": "registered-provider-prefix/provider-model-id",
      "label": "My API model [BYOK]"
    }
  },
  "auxiliaryMappings": {
    "ide-internal-helper-id": "registered-provider-prefix/helper-model-id"
  }
}
```

`target` is the exact 9Router provider/model identifier, including the prefix of
any custom provider node. For an OpenAI-compatible Responses endpoint, register a
Responses provider node and use its prefix directly. For a Chat Completions
endpoint, use the corresponding chat provider prefix. The bridge does not infer
or silently replace provider names.

Use actual desktop model IDs on the left and accurate target labels on the
right. The four-model example demonstrates configuration for a particular set of
desktop slots; replace its provider prefixes and models with ones you own. Model
availability is determined by your provider account, and desktop IDs may change
between client versions.

`auxiliaryMappings` explicitly routes background helper requests. Helpers can be
used for titles or other internal operations and can incur API charges. The full
native model directory is retained for executor initialization. Unknown helpers
remain blocked; add an observed helper ID only when you intend to route it.

Mapped slots report local BYOK availability to the desktop. That indicator is
not a measurement of the target provider's remaining balance or quota. Google
credit balances, minimum-credit thresholds and subscription-tier responses are
left unchanged.

## Windows setup and switching

See [the Windows helper instructions](../scripts/antigravity-byok/README.md) for
the bootstrap parameters, preview mode and generated shortcuts. Setup requires
an explicit user policy and generates its version/file checks locally. No
personal installation paths, credential database, certificate private key or
machine-specific manifest is distributed in this repository.

The paired shortcuts enable BYOK or restore the original subscription path.
Save your work and finish active tasks before switching. The helper requests a
normal Antigravity exit and reopens it after that exit; if the client stays open,
finish saving and restart it manually. Windows may request
administrator confirmation. Antigravity itself must restart through a verified
non-elevated desktop shell; a failed or unverifiable launch is reported rather
than treated as success.

The helpers only control processes and hosts entries that they can identify as
their own. They refuse unrelated port occupants and conflicting custom hosts
entries. Review the preview before first use. Existing installations and other
IDE bridges may require stopping them through their original controls first.

## Other platforms and manual configuration

The routing policy and protocol changes are platform-independent JavaScript.
Automatic shortcut/bootstrap management is Windows-only. macOS/Linux users can
use the existing 9Router MITM setup, with an explicit enabled policy at
`DATA_DIR/mitm/antigravity-byok.json` or the path in
`ANTIGRAVITY_BYOK_CONFIG`. Restart MITM after changing the policy. Manual platform
setup and desktop compatibility need their own validation.

Enabling BYOK restricts the bridge listener to loopback. Google upstream TLS
certificate and hostname validation remain enabled; do not disable verification
to work around a trust failure. Configure a trusted CA normally if your network
uses an enterprise TLS proxy.

MITM raw request/response dumps are suppressed in BYOK mode. An optional
`ANTIGRAVITY_BYOK_AUDIT_FILE` records limited routing metadata. The main 9Router
application has separate request/usage logging settings; inspect those settings
if your conversations contain sensitive material.

## Verification

Test each configured target directly in 9Router before using the desktop. Then
select its BYOK label in Antigravity, send two conversation turns, and perform a
small file-tool task with a random challenge. Check the actual output file, tool
steps and returned-model metadata. An HTTP 200 or a model's self-description is
not sufficient proof of successful tool execution or model identity.

The source tests use synthetic fixtures and do not require provider credentials:

```sh
node --test tests/mitm/*.test.cjs
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js tests/translator/antigravity-tool-roundtrip.test.js tests/unit/deepseek-thinking-budget.test.js
```

Install the test package's dependencies with `npm --prefix tests install` first.
The generalized distribution's offline tests and build checks do not substitute
for live provider tests or fresh-machine Windows installation testing.

## Sharing a configuration

Share source, tests, public documentation and credential-free examples. Keep
personal profiles, runtime receipts, databases, request logs, OAuth sessions and
CA private keys outside published files. Preserve the repository's MIT license
and copyright notice when distributing a derived build.
