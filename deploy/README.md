# Deployment folder

Simple guides for shipping ebRouter to clients and hosting SaaS.

| Doc | Who | What |
|-----|-----|------|
| **[../docs/BUNDLING-AND-DEPLOYMENT.md](../docs/BUNDLING-AND-DEPLOYMENT.md)** | **You (vendor)** | Full guide: build, push image, zip bundle, release |
| [GHCR-PUBLISH.md](./GHCR-PUBLISH.md) | You | Push Docker image to GitHub (`ghcr.io`) |
| **[saas/SAAS-OPS.md](./saas/SAAS-OPS.md)** | **You (SaaS host)** | Multi-tenant production: TLS, backup, upgrades, rate limits |
| [saas/README.md](./saas/README.md) | You | SaaS quick start (Docker Compose + Caddy) |
| [client/VENDOR.md](./client/VENDOR.md) | You | Client bundle checklist |
| [client/README-CLIENT.md](./client/README-CLIENT.md) | Client | On-prem install & daily use |

**On-prem client zip:** compress everything inside `deploy/client/` and send with `README-CLIENT.md`.

**SaaS hosting:** use `deploy/saas/` on your server (see `saas/SAAS-OPS.md`).
