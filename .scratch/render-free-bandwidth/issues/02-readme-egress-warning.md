## Parent

https://github.com/vitou-vitou/9router/issues/5

## What to build

An Operator reading the README Deployment section sees a short cloud free-tier egress warning: why Client↔Provider traffic burns host bandwidth, that RTK does not replace egress headroom, what failure looks like when capped, and where to run instead (local, Docker on a machine they control, VPS / paid / adequate-egress hosts). Soften any "Deploy Anywhere" implication that free cloud is always fine for always-on Router traffic. English README only; no i18n sweep.

## Acceptance criteria

- [ ] Deployment docs warn that free/low-egress PaaS hosting is a poor fit for a hosted Router under agent workloads
- [ ] Docs steer Operators to local / adequate-egress alternatives and note RTK is not an egress substitute
- [ ] Marketing "Deploy Anywhere" (or equivalent) does not overpromise free always-on cloud routing without a qualifier
- [ ] Wording stays consistent with the Blueprint bandwidth caveat; no runtime code changes

## Blocked by

- https://github.com/vitou-vitou/9router/issues/6
