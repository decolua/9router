## Parent

https://github.com/vitou-vitou/9router/issues/5

## What to build

An Operator opening the Render Blueprint sees a free-tier **bandwidth / outbound usage** caveat alongside the existing ephemeral-disk guidance (and WAF notes). It explains that a hosted Router sits on the Client↔Provider path, so low free egress (on the order of a few GB) exhausts quickly under agent workloads, and that fixing persistence (e.g. Supabase) does not fix bandwidth. Do not change `plan: free` or runtime env vars.

## Acceptance criteria

- [ ] Free-tier caveats in the Blueprint mention outbound usage / bandwidth as distinct from ephemeral storage
- [ ] Wording uses Operator / Client / Router / Provider vocabulary and does not hard-code a brittle vendor quota number (illustrative "few GB" OK)
- [ ] No runtime code, dashboard, or env-var contract changes

## Blocked by

- None (can start immediately)
