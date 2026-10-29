// Root-level vitest guard — see AGENTS.md "Tests" section.
//
// The 9Router test suite is an independent ESM package under tests/ with its
// own vitest.config.js (the @/ and open-sse aliases are configured there).
// A root-cwd `npx vitest run` previously produced a false-red suite (~249
// alias-resolution failures, 12/12 federation suites "failed"), which a
// stand-in PM cycle misread as the federation feature being broken. This
// file makes root runs fail fast with the correct invocation instead.
//
// NOTE: no imports here on purpose — the repo root has no vitest package
// installed (runs resolve via npx cache), so importing "vitest/config"
// itself fails before this message can load.
throw new Error(
  "9Router's test suite lives in tests/ with its own vitest config. " +
    "Run `npm test` from the repo root (or `cd tests && ./node_modules/.bin/vitest run`) — " +
    "a root-cwd run breaks @/ alias resolution and reports hundreds of false failures."
);
