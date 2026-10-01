# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue or pull request for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on
[decolua/9router](https://github.com/decolua/9router/security/advisories/new).
Include the affected version, the route or component, and reproduction steps.

A public issue or PR describes the attack before a fixed release exists, so every
exposed instance is at risk until users upgrade. Private reports let a fix ship
first; the advisory is published with credit afterwards.

## Supported versions

Only the latest release receives security fixes. 9Router ships frequently, so
please upgrade before reporting and confirm the issue on the current `master`.

## Scope

In scope: the gateway and dashboard (`src/`, `open-sse/`, `custom-server.js`), the
CLI launcher (`cli/`), and the published Docker image.

Especially relevant, based on past advisories:

- Authentication/authorization bypasses in `src/dashboardGuard.js` (public prefixes,
  rewrites, local-only routes, `requireLogin`)
- Client-IP / locality spoofing (`x-9r-real-ip`, `X-Forwarded-For`, tunnels)
- SSRF from any route that fetches a caller-supplied URL
- Credential or API-key disclosure in API responses, logs, or exports
- Command execution through MCP plugins, CLI-tool configuration, or installers

Out of scope: attacks that need the dashboard password on an instance you control,
and findings that only affect `next dev`.

## Hardening checklist for deployments

- Change the default dashboard password (`123456`) or set `INITIAL_PASSWORD`.
- Leave `JWT_SECRET` unset to use the auto-generated secret, or set a unique
  random value. Never reuse the example value from `.env.example` or the docs.
- Keep `requireLogin` and `requireApiKey` on for anything reachable from a network.
- Expose the dashboard through a tunnel only when you need it (`tunnelDashboardAccess`).
