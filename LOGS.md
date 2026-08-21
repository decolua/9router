# Project Log

## 2026-08-20 - Upstream v0.5.55 Dev Deployment

- Merged `decolua/9router` v0.5.55 into `sync/decolua-v0.5.55` while retaining the fork's API-key/CORS guard behavior.
- Added test fixture updates for embedding policy mocks, DNS lookup records, and Fusion combo entry binding.
- Pushed candidate SHA `035c1a9979b6f6d3b68582a11e025837b8147307` to `origin/sync/decolua-v0.5.55`.
- Homelab Docker build succeeded and `ninerouter-dev` was recreated with `9router-dev-data:/app/data` preserved; `/api/health` returned 200.
- Local full Vitest run from repository root: 1819 passed, 82 failed, 11 skipped. Residual failures are upstream-inherited stale/live tests, Windows-only file-lock/path/snapshot variance, and tests requiring separate upstream remediation; they did not block the authoritative homelab build.
