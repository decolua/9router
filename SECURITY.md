# Security Policy

## Reporting a Vulnerability

Please **do not** open public issues or pull requests for security problems.

Report vulnerabilities privately via GitHub:
👉 **[Report a vulnerability on decolua/9router](https://github.com/decolua/9router/security/advisories/new)**

When reporting, please include:
- The affected 9Router version / commit.
- The affected component or endpoint (e.g. `src/`, `open-sse/`, CLI, or API routes).
- Clear, minimal step-by-step reproduction instructions or proof-of-concept.

Private reports allow the maintainers to investigate, fix, and ship a secure release before vulnerability details are made public. Advisories will be published with credit to the reporter once patched.

## Supported Versions

Only the latest release receives security updates. Please verify the issue on current `master` or latest release before reporting.

| Version | Supported |
|:---|:---|
| Latest release (`master`) | :white_check_mark: |
| Older releases | :x: |

## Scope

**In Scope:**
- 9Router gateway, core routing, and dashboard (`src/`, `open-sse/`, `custom-server.js`)
- CLI launcher (`cli/`)
- Official Docker images
- Authentication/authorization mechanisms (`src/dashboardGuard.js`, `requireLogin`, `requireApiKey`)
- Credential protection (preventing leakage of provider API keys, OAuth tokens, and secrets)

**Out of Scope:**
- Attacks requiring physical/local machine access or existing dashboard password control
- Issues reproducible solely in local development mode (`next dev`)

## Deployment Hardening Checklist

For production or public-facing instances (VPS, tunnel, Cloudflare, etc.):
- Change the default dashboard password (`123456`) or configure `INITIAL_PASSWORD`.
- Keep `JWT_SECRET` unique and random (or leave it unset for auto-generation); never reuse example secrets from `.env.example`.
- Ensure `requireLogin` and `requireApiKey` are enabled.
- Only enable tunnel access when explicitly needed.
