# Codex CLI with GPT-5.6 reasoning through 9Router

This fork exposes GPT-5.6 reasoning effort and mode as two independent axes:

| 9Router model | Upstream model | Reasoning mode |
| --- | --- | --- |
| `cx/gpt-5.6-sol` | `gpt-5.6-sol` | Standard (the `mode` field is omitted) |
| `cx/gpt-5.6-sol-pro` | `gpt-5.6-sol` | Pro (`reasoning.mode = "pro"`) |

The same virtual `-pro` alias is available for Terra and Luna. The alias is
resolved inside 9Router, so the ChatGPT Codex backend never receives a model ID
ending in `-pro`. Codex CLI has no `model_reasoning_mode` configuration key;
select Pro with the model alias and select effort with
`model_reasoning_effort`.

## Base configuration

Put the shared provider configuration in `~/.codex/config.toml`. Keep provider
configuration at user scope: recent Codex versions intentionally ignore custom
providers in project-local `.codex/config.toml` files.

```toml
model = "cx/gpt-5.6-sol"
model_provider = "9router"
model_reasoning_effort = "xhigh"

[model_providers.9router]
name = "9Router"
base_url = "http://127.0.0.1:20128/v1"
wire_api = "responses"
env_key = "NINEROUTER_API_KEY"
```

Set the API key issued by your 9Router dashboard in the shell that launches
Codex. Do not commit the value:

```shell
export NINEROUTER_API_KEY="<9ROUTER_API_KEY>"
```

The dashboard's Codex setup flow can instead manage file-based credentials in
`~/.codex/auth.json`. Treat that file as a secret. The environment-key method
above keeps the 9Router credential separate from a direct OpenAI API key.

## Profiles for Codex CLI 0.134.0 and later

Current Codex versions load profiles from separate files. They do not read the
legacy `[profiles.<name>]` tables from `config.toml`. Each profile below overlays
the shared provider configuration.

`~/.codex/9router-standard-xhigh.config.toml`:

```toml
model = "cx/gpt-5.6-sol"
model_provider = "9router"
model_reasoning_effort = "xhigh"
```

`~/.codex/9router-standard-max.config.toml`:

```toml
model = "cx/gpt-5.6-sol"
model_provider = "9router"
model_reasoning_effort = "max"
```

`~/.codex/9router-pro-xhigh.config.toml`:

```toml
model = "cx/gpt-5.6-sol-pro"
model_provider = "9router"
model_reasoning_effort = "xhigh"
```

`~/.codex/9router-pro-max.config.toml`:

```toml
model = "cx/gpt-5.6-sol-pro"
model_provider = "9router"
model_reasoning_effort = "max"
```

Select one with either interactive or non-interactive Codex:

```shell
codex --profile 9router-standard-xhigh
codex exec --profile 9router-pro-max "Reply only OK"
```

## Verify the route

Confirm that the local catalogue includes both base and virtual models:

```shell
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${NINEROUTER_API_KEY}" \
  http://127.0.0.1:20128/v1/models
```

For a minimal request, use the same short prompt with each profile and compare
the 9Router trace fields for requested model, upstream model, effective mode,
effective effort, endpoint, status, and aggregate usage. Never log prompts,
authorization headers, OAuth tokens, or encrypted reasoning content.

## Availability and usage expectations

Registry support means the fork preserves `xhigh`, `max`, and Pro on the wire;
it does not grant account entitlement. Rollout and account restrictions can
still make a combination unavailable. A deterministic unsupported-mode,
unsupported-effort, or entitlement error should be reported directly rather
than treated as proof that another account will work.

Higher reasoning effort can increase latency and reasoning-token usage, but
there is no reliable fixed multiplier between XHigh and Max. Pro mode is a
separate service mode, not another effort level. ChatGPT quota consumption is
also not the same as OpenAI API token billing. Measure both combinations with
the same prompt and output limit before using them for sustained workloads.

Normal `/responses` and `/responses/compact` requests are routed independently.
The fork has unit coverage for the Pro compact request shape; backend acceptance
must still be confirmed with the account and Codex rollout used in production.

See the current Codex documentation for
[custom model providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers),
[profiles](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles),
and the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
