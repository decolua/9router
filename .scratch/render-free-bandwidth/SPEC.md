## Problem Statement

Operators who host the Router on Render’s free plan often exhaust the plan’s outbound usage allowance (on the order of ~5GB). Because every Client turn is proxied through the hosted Router to Providers and back, coding-tool traffic (streams, tool results, large contexts) consumes egress quickly. When the allowance is gone, the hosted Router stops being usable even though the software itself is fine. Today’s deploy docs and `render.yaml` warn about ephemeral disk and WAF on free Render, but they do not warn about bandwidth, so Operators discover the limit the hard way.

## Solution

Document the free-tier bandwidth reality at the deploy surface Operators already use: the README Deployment section and `render.yaml` comments. Make it explicit that a cloud free web service is a poor fit for a full-time Router in the middle of Client↔Provider traffic; steer Operators toward local, Docker-on-a-machine-they-control, VPS/paid plans, or other hosts whose egress limits match agent workloads. No runtime product change in this spec.

## User Stories

1. As an Operator, I want Render free-tier bandwidth limits called out before I deploy, so that I do not lose the Router mid-month without warning.
2. As an Operator, I want to understand why a Router burns egress faster than a normal website, so that the ~5GB cap makes sense.
3. As an Operator, I want clear recommended alternatives (local, Docker, VPS, paid Render, other hosts), so that I can keep Clients working without hitting free egress walls.
4. As an Operator reading `render.yaml`, I want bandwidth called out alongside ephemeral disk and WAF caveats, so that one Blueprint file holds the free-tier gotchas.
5. As an Operator following the README Deployment section, I want a short “cloud free tier” warning near VPS/Docker instructions, so that I see it in the same place I copy deploy commands.
6. As an Operator, I want the docs to say that Client and Provider bytes both traverse the host, so that I can estimate whether free egress is enough for my usage.
7. As an Operator, I want the docs to distinguish “Router software is free” from “host egress may not be”, so that I am not surprised by platform limits.
8. As an Operator evaluating Render specifically, I want language that matches our Blueprint (`plan: free`) reality, so that docs and `render.yaml` do not contradict each other.
9. As an Operator who already hit the cap, I want the docs to name the failure mode (service unusable / capped), so that I can confirm I hit bandwidth rather than a Router bug.
10. As an Operator, I want guidance that heavy agent/tool-result traffic is especially costly on egress, so that I know RTK reduces tokens but does not remove host bandwidth accounting.
11. As a documentation maintainer, I want a single coherent warning (not scattered marketing claims), so that “Deploy Anywhere” does not imply free cloud is always viable for production Router traffic.
12. As an Operator deploying with Docker on a VPS, I want that path affirmed as appropriate for always-on routing, so that I pick a durable host.
13. As an Operator staying on localhost, I want local use confirmed as the default that avoids cloud egress caps, so that I am not pushed to Render unnecessarily.
14. As an Operator using Supabase sync on Render free for persistence, I want bandwidth warned separately from disk persistence, so that fixing wipe-on-sleep does not hide the egress problem.
15. As an Operator sharing one hosted Router across devices, I want to know that multi-Client use multiplies egress, so that I size the host accordingly.
16. As a contributor editing deploy docs, I want out-of-scope boundaries clear (no meter UI, no auto-migrate off Render), so that the change stays documentation-only.
17. As an Operator reading i18n READMEs later, I want the English source updated first, so that translations can follow without inventing policy.
18. As an AFK agent implementing this, I want acceptance criteria tied only to README + `render.yaml` text, so that the change is reviewable without runtime tests.
19. As an Operator, I want no change to required env vars for this fix, so that existing deploys do not break when docs update.
20. As an Operator on paid Render or a high-egress host, I want the warning aimed at free/low caps, so that I am not told my setup is invalid.

## Implementation Decisions

- Seam: documentation and deploy Blueprint comments only — README Deployment area and `render.yaml` free-tier caveats header. No dashboard warning, no byte meter, no routing behavior change.
- Add an explicit free-tier **bandwidth / outbound usage** caveat next to the existing ephemeral-storage and WAF notes in `render.yaml`.
- Add a short subsection or callout under README Deployment (near VPS/Docker) explaining: hosted Router sits on the Client↔Provider path; free PaaS egress (illustrative ~5GB class limits) exhausts quickly under agent workloads; prefer local or a host with adequate egress.
- Keep domain vocabulary from `CONTEXT.md`: Operator, Client, Router, Provider, RTK (note RTK is not a substitute for egress headroom).
- Do not change `plan: free` in the Blueprint by default; this spec documents risk, it does not force paid plan.
- Do not rewrite unrelated deploy tables or require editing every i18n README in the first change (English source is enough unless the agent has capacity for a minimal cross-link note).
- Marketing lines like “Deploy Anywhere” may get a one-line qualifier if they currently imply cost-free always-on cloud routing; avoid a broad marketing rewrite.

## Testing Decisions

- Good tests here check **external operator-facing behavior of the docs**: the warning is present and accurate, not implementation trivia.
- Primary “module” under test: the deploy documentation surface (README Deployment + `render.yaml` comments).
- Prefer lightweight assertions if the repo already has doc/fixture checks; otherwise manual review checklist is acceptable because this is prose:
  - `render.yaml` mentions bandwidth/outbound usage on free tier
  - README Deployment mentions free cloud egress risk and points Operators to local/VPS/adequate-egress hosts
  - No new runtime code paths introduced
- Prior art: existing `render.yaml` free-tier comment block (ephemeral disk, WAF) is the pattern to extend; README Deployment details for VPS/Docker are the reader entry point.

## Out of Scope

- Dashboard or health-endpoint warnings when `BASE_URL` is `*.onrender.com`
- Egress/byte metering, soft quotas, or alerts inside the Router
- Changing Render WAF behavior, custom domains, or CDN fronting
- Migrating Operators automatically to Hugging Face, Fly, Railway, etc.
- Paid Render Blueprint defaults or billing integration
- RTK or Fallback behavior changes
- Translating all i18n READMEs in the same change (follow-up OK)

## Further Notes

- Tracker note: this fork previously had Issues disabled; triage label `ready-for-agent` applies — no further triage needed.
- Illustrative “~5GB” is Operator-reported order-of-magnitude; docs should describe the failure mode and free-tier unsuitability without hard-coding a vendor number that may change — phrase as “low free-tier outbound allowance (e.g. on the order of a few GB)” unless citing a current Render docs link.
- Related existing caveats in `render.yaml`: ephemeral disk without Supabase; Cloudflare edge WAF on `onrender.com` blocking some Client payloads — keep those; add bandwidth as a third free-tier footgun.
