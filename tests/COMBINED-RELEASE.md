# Combined Activity, analytics/pricing and manual quota replay

Use Node 22.22.0. From a clean repository checkout, install application dependencies (`npm ci`), then bootstrap the pinned local test tools without changing the application lockfile:

```sh
npm install --no-save --package-lock=false vitest@3.2.4 vite@7.3.6
npm install --no-save --package-lock=false --ignore-scripts --prefix .quota-ui-deps jsdom@29.1.1
mkdir -p .analytics-pricing-home .analytics-pricing-data
export HOME="$PWD/.analytics-pricing-home" DATA_DIR="$PWD/.analytics-pricing-data"
cd tests
../node_modules/.bin/vitest run --config client-analytics.config.js --no-file-parallelism \
  unit/activity-*.test.js unit/request-details*.test.js \
  unit/dashboard-guard.test.js unit/auth-status.test.js unit/session-manager.test.js \
  unit/custom-server-peer-headers.test.js unit/local-request-peer-trust-3294.test.js \
  unit/*pricing*.test.js unit/*cost*.test.js unit/*cache*.test.js \
  unit/astra-usage-extraction.test.js unit/client-key-*.test.js \
  unit/quota-toggle.test.js unit/quota-routes.test.js unit/quota-guard.test.js \
  unit/quota-ui.test.js unit/quota-roundtrip.test.js unit/quota-legacy.test.js \
  unit/quota-interaction.test.js unit/quota-matrix.test.js unit/quota-aliases.test.js
cd ..
npm run build
```

Keep HOME and DATA_DIR isolated for both tests and build; never point them at production. Serialize suites because DB import tests clear shared tables. The interaction suite imports `.quota-ui-deps/node_modules/jsdom/lib/api.js`; this is a test-only dependency, not a production artifact. Do not stage dependency trees, isolated data/home directories, or logs.

This is the targeted combined release gate, not the full upstream suite. Existing `antigravity-cache` tests skip. The unrelated unchanged `quota-auto-ping` suite has two known Vitest fake-timer ordering failures and is not included; no claim of an all-green full upstream suite. Tests mock upstream dispatch and do not demonstrate successful provider completion. Production deployment additionally requires independent review approval, a consistent SQLite backup, preserved custom-server peer protection, narrow CLI restart, and authenticated HTTP verification.
