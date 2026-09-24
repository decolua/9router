# Railway deployment

[`railway.ts`](railway.ts) is the project-level Infrastructure as Code definition for this repository's Railway deployment. It declares one GitHub-backed 9router service and one persistent volume. The service uses the root `Dockerfile`, listens on port 20128, and has `/api/health` as its health check. The `9router-data` volume mounts at `/app/data`; SQLite and its backups live under `/app/data/db/`.

Railway's older `railway.json` and `railway.toml` Config as Code format is deprecated. The current [Railway IaC](https://docs.railway.com/infrastructure-as-code) file is evaluated by the Railway CLI with `railway config plan` and `railway config apply`. Railway does **not** apply changes to this file just because a commit is pushed.

## Apply a configuration change

1. Use Node 22 or newer, install dependencies with `npm install`, and authenticate the Railway CLI with an account or workspace credential authorized for the target project.
2. Select the intended Railway project and environment with `railway link`. In CI or with a workspace-scoped API token, set `RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID` instead; the CLI can use those IDs without a local link.
3. Run `railway config plan`. Confirm the target project/environment and review every proposed resource or variable change. This file describes the **whole project**: removing a service or volume from it can plan a deletion, including loss of volume data.
4. Run `railway config apply` to apply the reviewed configuration. A clean plan reports that Railway is already up to date.

```sh
npm install
railway config plan
railway config apply
```

The production service is currently connected to `eladrave/9router` on `codex/codex-live-model-discovery`. Change the branch in `railway.ts` when the release branch changes. Generated Railway domains are configured in Railway and are not included by the IaC importer.

## Deploy application code

Infrastructure changes and application commits have separate deployment triggers. The current production service has [GitHub auto-deploy](https://docs.railway.com/deployments/github-autodeploys) disabled, so pushing this branch alone does not deploy a new commit. In Railway, use the Command Palette's **Deploy Latest Commit** action to deploy the connected branch's current HEAD. `railway redeploy` rebuilds the previously deployed commit; it does not select a newer GitHub commit. Confirm the deployed commit and `SUCCESS` status before treating a push as live.

If auto-deploy is enabled later, GitHub pushes to the connected branch can trigger deployments automatically. Keep this runbook aligned with that setting.

## Variables, domain, and storage

`railway.ts` sets the non-secret runtime values `DATA_DIR=/app/data`, `PORT=20128`, `NODE_ENV=production`, and `AUTH_COOKIE_SECURE=true`. It uses `preserve()` for `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `BASE_URL`, and `NEXT_PUBLIC_BASE_URL`: their existing Railway values remain in Railway and never enter Git.

For a new Railway project, provision strong values for the four secrets in Railway. Create a Railway HTTPS domain routed to port 20128, then set both URL variables to that domain before using the public service. `preserve()` does not generate values in a fresh project. The IaC file recreates infrastructure, **not** the contents of an existing SQLite volume; restore data separately when migrating an installation.

For the existing production service, find the generated first-login password in the service's Railway Variables tab under `INITIAL_PASSWORD`.

Before applying a plan that changes the volume, confirm it will retain the existing `9router-data` resource and `/app/data` mount. A volume resize upwards is supported, while reducing its size, detaching it, or deleting it can affect persisted data. Back up the volume before such a change.

## Verify the deployment

Check that Railway reports the expected commit and a successful deployment, then check the public health endpoint:

```sh
railway service status
curl --fail https://<service-domain>/api/health
```

The health endpoint should return `{"ok":true}`. Also inspect the mounted volume in Railway and confirm `/app/data/db/data.sqlite` exists after a redeploy. The health response alone does not prove the database is on persistent storage.
