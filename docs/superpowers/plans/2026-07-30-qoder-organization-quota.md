# Qoder Organization Quota Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show meaningful Qoder organization quota rows and finite allocations even when Qoder reports a zero total.

**Architecture:** Keep the server response and generic quota-table rendering unchanged. In the Qoder-specific normalization path, suppress only all-zero organization placeholders and infer a missing total from absolute used plus remaining credits.

**Tech Stack:** JavaScript ESM, Vitest, existing Next.js dashboard utilities

## Global Constraints

- Must use the existing Qoder quota normalization path.
- Must preserve the existing JavaScript and Vitest toolchain.
- Must not add third-party dependencies.
- Test coverage for the changed behavior must be complete.

---

### Task 1: Preserve Meaningful Organization Quotas

**Files:**
- Create: `tests/unit/qoder-quota.test.js`
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:406`

**Interfaces:**
- Consumes: `parseQuotaData(provider, data)` from the existing quota normalization utility.
- Produces: Qoder normalized rows where a non-zero `total`, `used`, or `remaining` value makes the organization row visible.

- [ ] **Step 1: Write the failing regression test**

```js
import { describe, expect, it } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Qoder organization quota visibility", () => {
  const resetAt = "2026-07-31T16:00:00.000Z";

  it.each([
    ["total", { total: 1, used: 0, remaining: 0 }],
    ["used", { total: 0, used: 20000, remaining: 0 }],
    ["remaining", { total: 0, used: 0, remaining: 1 }],
  ])("keeps organization quota when %s is non-zero", (_field, organization) => {
    const data = {
      quotas: {
        user: {
          total: 3000,
          used: 3000,
          remaining: 0,
          unit: "credits",
          resetAt,
        },
        organization: {
          ...organization,
          unit: "credits",
          resetAt,
        },
      },
    };

    expect(parseQuotaData("qoder", data)).toContainEqual({
      name: "Organization",
      used: organization.used,
      total: organization.total,
      unit: "credits",
      resetAt,
    });
  });

  it("still hides an all-zero organization placeholder", () => {
    const data = {
      quotas: {
        user: { total: 3000, used: 0, remaining: 3000, unit: "credits" },
        organization: { total: 0, used: 0, remaining: 0, unit: "credits" },
      },
    };

    expect(parseQuotaData("qoder", data).map((quota) => quota.name)).toEqual([
      "Personal",
    ]);
  });

  it("keeps personal quota normalization unchanged", () => {
    const data = {
      quotas: {
        user: { total: 3000, used: 1200, remaining: 1800, unit: "credits", resetAt },
      },
    };

    expect(parseQuotaData("qoder", data)).toEqual([{
      name: "Personal",
      used: 1200,
      total: 3000,
      unit: "credits",
      resetAt,
    }]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the regression is red**

Run: `cd tests && npx vitest run unit/qoder-quota.test.js`

Expected: the used-only and remaining-only cases fail because the output lacks the `Organization` row; the total-only, all-zero placeholder, and personal cases pass.

- [ ] **Step 3: Narrow the organization filter**

```js
// Skip only the empty organization placeholder synthesized for personal accounts.
if (
  quotaType === "organization"
  && (!quota || [quota.total, quota.used, quota.remaining]
    .every((value) => (Number(value) || 0) === 0))
) {
  return;
}
```

- [ ] **Step 4: Run focused and adjacent tests**

Run: `cd tests && npx vitest run unit/qoder-quota.test.js unit/provider-quota-visibility.test.js unit/usage-dispatch.test.js`

Expected: all selected test files pass with zero failures.

- [ ] **Step 5: Run repository quality gates**

Run: `npx eslint 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js' tests/unit/qoder-quota.test.js`

Expected: ESLint exits successfully with zero errors.

Run: `node --check 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js'`

Expected: Node syntax checking exits successfully.

Run from `tests/`: `npx vitest run --reporter=json --outputFile=/tmp/9router-results.json`

Expected: Vitest writes complete JSON results; the command may exit non-zero only for failures already catalogued by the repository.

Run from the repository root to normalize the checkout prefix expected by the baseline verifier:

```bash
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const file="/tmp/9router-results.json"; const data=JSON.parse(fs.readFileSync(file,"utf8")); for (const result of data.testResults) result.name=`/app/${path.relative(process.cwd(),result.name).split(path.sep).join("/")}`; fs.writeFileSync(file,JSON.stringify(data));'
```

Run: `node tests/__baseline__/verify-no-regression.mjs /tmp/9router-results.json`

Expected: the baseline verifier reports `No regression` and exits successfully.

Coverage gate: the repository has no Vitest coverage provider or configured threshold. The focused parameterized test mechanically exercises all four visibility decisions (non-zero total, used, or remaining; and all-zero), providing 100% behavioral coverage of the changed predicate without adding an unaudited dependency.

- [ ] **Step 6: Obtain independent code and test review**

Compare the implementation with the Spec and this plan. Reject Critical or Important findings; stop and escalate if more than two review rounds are required.

- [ ] **Step 7: Commit the verified change**

```bash
git add -f docs/superpowers/specs/2026-07-30-qoder-organization-quota-design.md \
  docs/superpowers/plans/2026-07-30-qoder-organization-quota.md \
  tests/unit/qoder-quota.test.js \
  'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js'
git commit -m "fix(qoder): show organization quota usage"
```

- [ ] **Step 8: Verify and deliver the branch**

```bash
git ls-files --error-unmatch \
  docs/superpowers/specs/2026-07-30-qoder-organization-quota-design.md \
  docs/superpowers/plans/2026-07-30-qoder-organization-quota.md
git push -u origin fix/qoder-organization-quota
gh pr create --repo decolua/9router --base master --head Beants:fix/qoder-organization-quota
```

Expected: both governance documents are tracked, the branch is present on the fork, and the upstream pull request URL is returned.

---

### Task 2: Render Zero-Total Qoder Allocations as Finite

**Files:**
- Modify: `tests/unit/qoder-quota.test.js`
- Modify: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`

**Interfaces:**
- Consumes: Qoder quota rows shaped as `{ total, used, remaining, unit, resetAt }`.
- Produces: normalized quota rows whose total is the positive reported total, or `used + remaining` when the reported total is zero.

- [x] **Step 1: Extend the regression tests**

Add coverage for `total: 0`, `used: 3804`, and `remaining: 6196`. Assert a normalized total of `10000` and a calculated remaining percentage of `62`. Update the existing zero-total cases to expect the inferred total.

- [x] **Step 2: Verify the regression is red**

Run: `cd tests && npx vitest run unit/qoder-quota.test.js`

Expected: the inferred-total assertions fail because the current parser preserves `total: 0`.

- [x] **Step 3: Implement the Qoder-only total fallback**

Use the positive reported total when available. Otherwise, set the normalized total to the sum of numeric used and remaining credits. Continue omitting the absolute `remaining` field so generic percentage handling is unchanged.

- [x] **Step 4: Verify focused and adjacent behavior**

Run: `cd tests && npx vitest run unit/qoder-quota.test.js unit/provider-quota-visibility.test.js unit/usage-dispatch.test.js`

Expected: all selected tests pass with zero failures.

- [x] **Step 5: Run quality gates and independent review**

Run lint, syntax checking, the repository differential suite, and an independent review. Update the existing branch and pull request only after all gates pass.

- [ ] **Step 6: Rebuild and reinstall locally**

Build the CLI tarball, install it globally, restart the launch agent, and verify the health endpoint plus the Qoder quota page behavior.
