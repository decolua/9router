# node-forge GHSA-86w9-cpqp-85rv — no fix available upstream (measured 2026-10-12)

**Status: ACCEPTED RISK, documented. Do not attempt to "fix" it by downgrading, removing, or
vendoring node-forge.** This artifact is the in-repo record of the one production
(`npm audit --omit=dev`) finding that remains after the SEC-9ROUTER-001 dependency
remediation, so the next audit does not start from zero (same pattern as
`2026-09-19-eslint10-deferral.md`). The re-check is one command — `npm audit --omit=dev`.

## The finding

```
node-forge  *
Severity: high
node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm
elements - https://github.com/advisories/GHSA-86w9-cpqp-85rv
No fix available
node_modules/node-forge
```

- **Severity:** high — GitHub advisory GHSA-86w9-cpqp-85rv / **CVE-2026-85393**
  (signature forgery, CWE-347, CVSS 8.7).
- **Dependency shape:** DIRECT production dependency (`package.json` → `node-forge: ^1.3.3`;
  the published CLI package pins the same in `cli/package.json`). This is not a transitive
  pin problem: `overrides` cannot help because there is no fixed version to override to.
- **Why no fix:** the advisory affects the entire node-forge 1.x line and npm reports
  `fixAvailable: false`. The newest published node-forge at measurement time is **1.4.0**
  (`npm view node-forge@latest version`, already what the lockfile installs), and the
  advisory has no patched release. A major-version downgrade does not exist (1.x is the
  only maintained line), and switching libraries is a code change, not a dependency bump.

## Exposure in this repo

The direct consumer is `src/mitm/cert/rootCA.js` (local Root-CA + per-host leaf certificate
generation for the optional MITM inspection feature, loaded by `src/mitm/server.js` and
`src/mitm/manager.js`). The flagged code path is RSA PKCS#1 v1.5 signature VERIFICATION;
9router only uses forge's `pki` certificate/key GENERATION APIs here, not its verifier,
which keeps real-world exposure low — but the audit counts the dependency, and no code
change short of dropping node-forge clears it.

## Re-check / unblock procedure

1. `npm audit --omit=dev` — while it prints the block above, the finding stands.
2. `npm view node-forge versions` — when a version NEWER than the last one recorded here
   (1.4.0) appears, check whether GHSA-86w9-cpqp-85rv lists it as patched.
3. If patched: bump `node-forge` in `package.json` + `cli/package.json`, run
   `npm install` at root and in `cli/`, re-run `npm audit --omit=dev` (expect 0
   vulnerabilities), the focused MITM tests, `npm run build` and `npm run lint:gate`,
   then delete this document in the same commit.
4. If node-forge is ever removed entirely (e.g. MITM cert generation moves to a maintained
   library), delete this document in the same commit.

Measured 2026-10-12 on the SEC-9ROUTER-001 remediation branch: `npm audit --omit=dev` =
**1 high severity vulnerability** (node-forge, no fix available), down from 11 findings
before the remediation (next ^16.3.6→^16.4.0, dompurify override 3.4.13→3.4.17,
http-proxy-middleware removed from direct dependencies).
