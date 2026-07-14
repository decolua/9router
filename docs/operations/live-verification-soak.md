# Live Verification Soak

Run each checkpoint manually from the repository root. The verifier is read-only and does not restart, repair, deploy, or modify configuration.

```bash
./scripts/verify-live-9router.sh --checkpoint T+0 --report --canary
./scripts/verify-live-9router.sh --checkpoint T+1h --report
./scripts/verify-live-9router.sh --checkpoint T+6h --report
./scripts/verify-live-9router.sh --checkpoint T+24h --report --canary
```

If the canary endpoint requires authentication, provide it only through `NINEROUTER_CANARY_API_KEY`. Do not place credentials in arguments, reports, or files.

Exit codes:

- `0`: all requested gates passed.
- `1`: an operational gate failed.
- `2`: verifier usage, dependency, or configuration error.

Reports are created immutably with mode `0600` under `.runtime/verification-reports`. Each invocation is independent; no sleep or background process is created. Installing cron, systemd timers, or another scheduler is outside this procedure and requires separate approval after `T+24h` passes.
