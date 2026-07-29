# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Latest release tag | Yes |
| Previous minor | Best effort |

## Reporting a Vulnerability

**Do not** open public GitHub issues for security vulnerabilities.

Report security issues privately to the maintainers via GitHub Security Advisories (Preferred) or direct contact with the repository owner.

Include:

- Description and impact
- Steps to reproduce
- Affected version or commit
- Suggested fix (if available)

## Response Targets

| Stage | Target |
| ----- | ------ |
| Initial acknowledgement | 2 business days |
| Triage & severity assignment | 5 business days |
| Fix for Critical/High | 30 days (target) |

## Scope

In scope:

- ebRouter application (`src/`, `open-sse/`)
- Authentication, authorization, and API key handling
- Docker deployment configuration (`Dockerfile`, `docker-compose.yml`, `deploy/client/`)
- CI/CD security workflows

Out of scope:

- Third-party AI provider infrastructure
- Client-side CLI tools not maintained in this repository
- Social engineering attacks

## Secure Development

See [docs/security/](docs/security/README.md) for the full security baseline: automated scanning, OSS governance, audit logging, and enterprise deliverables.

## Security Artifacts

Release artifacts (SBOM, license register, scan reports) are published as GitHub Actions artifacts on tagged releases.
