# Admin API Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin-key authenticated API management for customer API keys with plan-based expiration.

**Architecture:** Keep `apiKeys` as the customer/user record. Add small focused helpers for plan math and admin key auth, extend the DB repo for metadata and lazy expiry, expose `/api/admin/keys` routes guarded by the admin key, and update dashboard screens to create/renew keys with plans.

**Tech Stack:** Next.js App Router route handlers, SQLite DB adapter layer, Vitest, React client components.

---

## File Map

Create:

- `src/lib/api-keys/plans.js` - plan validation, month addition, expiration status helpers.
- `src/lib/auth/adminApiKey.js` - admin key generation, hashing, extraction, verification, response-safe metadata.
- `src/app/api/admin/keys/route.js` - admin list/create customer keys.
- `src/app/api/admin/keys/[id]/route.js` - admin get/update/delete customer key.
- `src/app/api/admin/keys/[id]/renew/route.js` - admin renew customer key.
- `src/app/api/settings/admin-key/route.js` - dashboard-authenticated admin key status/create/regenerate.
- `tests/unit/api-key-plans.test.js` - plan/date behavior.
- `tests/unit/admin-api-key-auth.test.js` - admin key auth behavior.
- `tests/unit/admin-keys-routes.test.js` - route auth and payload behavior with mocks.

Modify:

- `src/lib/db/schema.js` - add `planMonths`, `expiresAt`, `deactivatedReason`, `updatedAt` columns to `apiKeys`.
- `src/lib/db/migrations/002-api-key-expiration.js` - versioned additive migration for existing DBs.
- `src/lib/db/migrations/index.js` - register migration 2.
- `src/lib/db/repos/apiKeysRepo.js` - row mapping, create/update/renew, lazy expiry, validate expiry.
- `src/lib/db/repos/settingsRepo.js` - add admin key settings defaults.
- `src/lib/db/index.js` - export/import new API key metadata.
- `src/lib/localDb.js` - re-export new repo helpers through existing shim.
- `src/dashboardGuard.js` - let `/api/admin/keys` through to route-level admin key auth.
- `src/app/api/keys/route.js` - accept optional plan and return new metadata.
- `src/app/api/keys/[id]/route.js` - support metadata updates and manual deactivation reason.
- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` - plan selector, expiration/status display, renew action.
- `src/app/(dashboard)/dashboard/profile/page.js` - admin API key create/regenerate UI.
- `docs/ARCHITECTURE.md` - minor update documenting admin key management.

## Commands

Use these commands throughout:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-plans.test.js
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-api-key-auth.test.js
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-keys-routes.test.js
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/dashboard-guard.test.js
npm run build
```

---

### Task 1: Core Plan Helpers

**Files:**

- Create: `src/lib/api-keys/plans.js`
- Test: `tests/unit/api-key-plans.test.js`

- [x] **Step 1: Write failing plan helper tests**

Create `tests/unit/api-key-plans.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  addPlanMonths,
  getRenewalBaseDate,
  isExpiredAt,
  normalizePlanMonths,
} from "../../src/lib/api-keys/plans.js";

describe("API key plan helpers", () => {
  it("accepts only supported plan lengths", () => {
    expect(normalizePlanMonths(1)).toBe(1);
    expect(normalizePlanMonths("3")).toBe(3);
    expect(normalizePlanMonths(6)).toBe(6);
    expect(normalizePlanMonths(12)).toBe(12);
    expect(() => normalizePlanMonths(2)).toThrow("Plan must be one of 1, 3, 6, 12 months");
    expect(() => normalizePlanMonths("bad")).toThrow("Plan must be one of 1, 3, 6, 12 months");
  });

  it("adds plan months using UTC calendar dates", () => {
    const start = new Date("2026-06-18T14:52:33.301Z");
    expect(addPlanMonths(start, 1).toISOString()).toBe("2026-07-18T14:52:33.301Z");
    expect(addPlanMonths(start, 3).toISOString()).toBe("2026-09-18T14:52:33.301Z");
  });

  it("clamps month end when target month is shorter", () => {
    const start = new Date("2026-01-31T10:00:00.000Z");
    expect(addPlanMonths(start, 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });

  it("renews from existing future expiration", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    const expiresAt = "2026-07-18T14:52:33.301Z";
    expect(getRenewalBaseDate(expiresAt, now).toISOString()).toBe("2026-07-18T14:52:33.301Z");
  });

  it("renews from now when missing or expired", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    expect(getRenewalBaseDate(null, now).toISOString()).toBe(now.toISOString());
    expect(getRenewalBaseDate("2026-06-01T00:00:00.000Z", now).toISOString()).toBe(now.toISOString());
  });

  it("detects expiration only when timestamp is present and not in the future", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    expect(isExpiredAt(null, now)).toBe(false);
    expect(isExpiredAt("2026-06-22T23:59:59.000Z", now)).toBe(true);
    expect(isExpiredAt("2026-06-23T00:00:00.000Z", now)).toBe(true);
    expect(isExpiredAt("2026-06-23T00:00:01.000Z", now)).toBe(false);
  });
});
```

- [x] **Step 2: Run tests and confirm failure**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-plans.test.js
```

Expected: FAIL because `src/lib/api-keys/plans.js` does not exist.

- [x] **Step 3: Implement plan helpers**

Create `src/lib/api-keys/plans.js`:

```js
const ALLOWED_PLAN_MONTHS = new Set([1, 3, 6, 12]);

export function normalizePlanMonths(value) {
  const plan = Number(value);
  if (!Number.isInteger(plan) || !ALLOWED_PLAN_MONTHS.has(plan)) {
    throw new Error("Plan must be one of 1, 3, 6, 12 months");
  }
  return plan;
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addPlanMonths(date, planMonths) {
  const plan = normalizePlanMonths(planMonths);
  const base = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(base.getTime())) throw new Error("Invalid base date");

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const targetMonthIndex = month + plan;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(base.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  ));
}

export function isExpiredAt(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() <= now.getTime();
}

export function getRenewalBaseDate(expiresAt, now = new Date()) {
  if (!expiresAt) return now;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return now;
  return expires.getTime() > now.getTime() ? expires : now;
}

export function calculateExpiresAt(planMonths, baseDate = new Date()) {
  return addPlanMonths(baseDate, planMonths).toISOString();
}
```

- [x] **Step 4: Run tests and confirm pass**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-plans.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/api-keys/plans.js tests/unit/api-key-plans.test.js
git commit -m "test: add api key plan helpers"
```

---

### Task 2: Admin API Key Auth Helper

**Files:**

- Create: `src/lib/auth/adminApiKey.js`
- Test: `tests/unit/admin-api-key-auth.test.js`

- [x] **Step 1: Write failing admin auth tests**

Create `tests/unit/admin-api-key-auth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

const {
  createOrRotateAdminApiKey,
  extractAdminApiKey,
  getAdminApiKeyStatus,
  verifyAdminApiKey,
} = await import("../../src/lib/auth/adminApiKey.js");

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

describe("admin API key auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts bearer key before x-admin-api-key", () => {
    const req = request({
      authorization: "Bearer admin-bearer",
      "x-admin-api-key": "admin-header",
    });
    expect(extractAdminApiKey(req)).toBe("admin-bearer");
  });

  it("extracts x-admin-api-key when bearer is missing", () => {
    expect(extractAdminApiKey(request({ "x-admin-api-key": "admin-header" }))).toBe("admin-header");
  });

  it("creates one plaintext key and stores only hash metadata", async () => {
    mocks.updateSettings.mockImplementation(async (updates) => updates);

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    expect(result.key.startsWith("9r-admin-")).toBe(true);
    expect(result.status.configured).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      adminApiKeyHash: expect.stringMatching(/^sha256:/),
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-23T00:00:00.000Z",
    }));
    expect(mocks.updateSettings.mock.calls[0][0].adminApiKeyHash).not.toContain(result.key);
  });

  it("verifies the generated key against stored hash", async () => {
    let savedSettings = {};
    mocks.updateSettings.mockImplementation(async (updates) => {
      savedSettings = { ...savedSettings, ...updates };
      return savedSettings;
    });
    mocks.getSettings.mockImplementation(async () => savedSettings);

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    await expect(verifyAdminApiKey(result.key)).resolves.toBe(true);
    await expect(verifyAdminApiKey("wrong")).resolves.toBe(false);
  });

  it("returns safe status only", async () => {
    mocks.getSettings.mockResolvedValue({
      adminApiKeyHash: "sha256:secret",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    });

    await expect(getAdminApiKeyStatus()).resolves.toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
  });
});
```

- [x] **Step 2: Run tests and confirm failure**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-api-key-auth.test.js
```

Expected: FAIL because `src/lib/auth/adminApiKey.js` does not exist.

- [x] **Step 3: Implement admin auth helper**

Create `src/lib/auth/adminApiKey.js`:

```js
import crypto from "node:crypto";
import { getSettings, updateSettings } from "@/lib/localDb";

const ADMIN_KEY_PREFIX = "9r-admin-";

function hashAdminKey(key) {
  return `sha256:${crypto.createHash("sha256").update(String(key)).digest("hex")}`;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function generateAdminApiKey() {
  return `${ADMIN_KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

export function extractAdminApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return request.headers.get("x-admin-api-key")?.trim() || "";
}

export async function verifyAdminApiKey(key) {
  if (!key) return false;
  const settings = await getSettings();
  const storedHash = settings.adminApiKeyHash;
  if (!storedHash) return false;
  return timingSafeEqualString(hashAdminKey(key), storedHash);
}

export async function requireAdminApiKey(request) {
  const key = extractAdminApiKey(request);
  return await verifyAdminApiKey(key);
}

export async function getAdminApiKeyStatus() {
  const settings = await getSettings();
  return {
    configured: Boolean(settings.adminApiKeyHash),
    createdAt: settings.adminApiKeyCreatedAt || null,
    updatedAt: settings.adminApiKeyUpdatedAt || null,
  };
}

export async function createOrRotateAdminApiKey(now = new Date()) {
  const settings = await getSettings();
  const timestamp = now.toISOString();
  const key = generateAdminApiKey();
  const updates = {
    adminApiKeyHash: hashAdminKey(key),
    adminApiKeyCreatedAt: settings.adminApiKeyCreatedAt || timestamp,
    adminApiKeyUpdatedAt: timestamp,
  };
  await updateSettings(updates);
  return {
    key,
    status: {
      configured: true,
      createdAt: updates.adminApiKeyCreatedAt,
      updatedAt: updates.adminApiKeyUpdatedAt,
    },
  };
}
```

- [x] **Step 4: Run tests and confirm pass**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-api-key-auth.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/auth/adminApiKey.js tests/unit/admin-api-key-auth.test.js
git commit -m "feat: add admin api key auth helper"
```

---

### Task 3: DB Schema And API Key Repo Expiration

**Files:**

- Modify: `src/lib/db/schema.js`
- Create: `src/lib/db/migrations/002-api-key-expiration.js`
- Modify: `src/lib/db/migrations/index.js`
- Modify: `src/lib/db/repos/apiKeysRepo.js`
- Modify: `src/lib/db/repos/settingsRepo.js`
- Modify: `src/lib/db/index.js`
- Modify: `src/lib/localDb.js`
- Test: `tests/unit/api-keys-repo-expiry.test.js`

- [x] **Step 1: Write failing repo expiry tests**

Create `tests/unit/api-keys-repo-expiry.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = [];

const mocks = vi.hoisted(() => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: mocks.getAdapter,
}));

function makeDb() {
  return {
    all(sql) {
      if (sql.includes("SELECT * FROM apiKeys ORDER BY")) return [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return [];
    },
    get(sql, params) {
      if (sql.includes("SELECT * FROM apiKeys WHERE id = ?")) return rows.find((row) => row.id === params[0]) || null;
      if (sql.includes("SELECT * FROM apiKeys WHERE key = ?")) return rows.find((row) => row.key === params[0]) || null;
      return null;
    },
    run(sql, params) {
      if (sql.startsWith("INSERT INTO apiKeys")) {
        rows.push({
          id: params[0],
          key: params[1],
          name: params[2],
          machineId: params[3],
          isActive: params[4],
          planMonths: params[5],
          expiresAt: params[6],
          deactivatedReason: params[7],
          createdAt: params[8],
          updatedAt: params[9],
        });
        return { changes: 1 };
      }
      if (sql.startsWith("UPDATE apiKeys SET")) {
        const row = rows.find((item) => item.id === params[7]);
        if (!row) return { changes: 0 };
        row.key = params[0];
        row.name = params[1];
        row.machineId = params[2];
        row.isActive = params[3];
        row.planMonths = params[4];
        row.expiresAt = params[5];
        row.deactivatedReason = params[6];
        row.updatedAt = params[8];
        return { changes: 1 };
      }
      if (sql.startsWith("UPDATE apiKeys")) {
        const now = params[0];
        let changes = 0;
        for (const row of rows) {
          if (row.expiresAt && row.expiresAt <= now && row.isActive !== 0) {
            row.isActive = 0;
            row.deactivatedReason = "expired";
            row.updatedAt = now;
            changes += 1;
          }
        }
        return { changes };
      }
      return { changes: 0 };
    },
    transaction(fn) {
      return fn();
    },
  };
}

const repo = await import("../../src/lib/db/repos/apiKeysRepo.js");

describe("apiKeysRepo expiration", () => {
  beforeEach(() => {
    rows.length = 0;
    mocks.getAdapter.mockResolvedValue(makeDb());
  });

  it("lazy expires overdue keys when listing", async () => {
    rows.push({
      id: "expired",
      key: "sk-expired",
      name: "Expired User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const keys = await repo.getApiKeys({ now: new Date("2026-06-23T00:00:00.000Z") });

    expect(keys[0].isActive).toBe(false);
    expect(keys[0].deactivatedReason).toBe("expired");
  });

  it("renewal extends from future expiration", async () => {
    rows.push({
      id: "active",
      key: "sk-active",
      name: "Active User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-07-18T14:52:33.301Z",
      deactivatedReason: null,
      createdAt: "2026-06-18T14:52:33.301Z",
      updatedAt: "2026-06-18T14:52:33.301Z",
    });

    const renewed = await repo.renewApiKey("active", 1, new Date("2026-06-23T00:00:00.000Z"));

    expect(renewed.expiresAt).toBe("2026-08-18T14:52:33.301Z");
    expect(renewed.isActive).toBe(true);
    expect(renewed.deactivatedReason).toBeNull();
  });

  it("validateApiKey rejects expired keys after lazy expiry", async () => {
    rows.push({
      id: "expired",
      key: "sk-expired",
      name: "Expired User",
      machineId: "machine",
      isActive: 1,
      planMonths: 1,
      expiresAt: "2026-06-01T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    await expect(repo.validateApiKey("sk-expired", { now: new Date("2026-06-23T00:00:00.000Z") })).resolves.toBe(false);
  });
});
```

- [x] **Step 2: Run tests and confirm failure**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-keys-repo-expiry.test.js
```

Expected: FAIL because repo does not expose new metadata or `renewApiKey`.

- [x] **Step 3: Add schema columns and migration**

Modify `src/lib/db/schema.js` `SCHEMA_VERSION` and `apiKeys.columns`:

```js
export const SCHEMA_VERSION = 2;
```

```js
apiKeys: {
  columns: {
    id: "TEXT PRIMARY KEY",
    key: "TEXT UNIQUE NOT NULL",
    name: "TEXT",
    machineId: "TEXT",
    isActive: "INTEGER DEFAULT 1",
    planMonths: "INTEGER",
    expiresAt: "TEXT",
    deactivatedReason: "TEXT",
    createdAt: "TEXT NOT NULL",
    updatedAt: "TEXT",
  },
  indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
},
```

Create `src/lib/db/migrations/002-api-key-expiration.js`:

```js
function hasColumn(db, table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export default {
  version: 2,
  name: "api-key-expiration",
  up(db) {
    addColumn(db, "apiKeys", "planMonths", "INTEGER");
    addColumn(db, "apiKeys", "expiresAt", "TEXT");
    addColumn(db, "apiKeys", "deactivatedReason", "TEXT");
    addColumn(db, "apiKeys", "updatedAt", "TEXT");
    db.run(`UPDATE apiKeys SET updatedAt = createdAt WHERE updatedAt IS NULL`);
  },
};
```

Modify `src/lib/db/migrations/index.js`:

```js
import m001 from "./001-initial.js";
import m002 from "./002-api-key-expiration.js";

export const MIGRATIONS = [m001, m002].sort((a, b) => a.version - b.version);
```

- [x] **Step 4: Extend settings defaults**

Modify `DEFAULT_SETTINGS` in `src/lib/db/repos/settingsRepo.js`:

```js
adminApiKeyHash: "",
adminApiKeyCreatedAt: "",
adminApiKeyUpdatedAt: "",
```

Place these near auth settings after `oidcLoginLabel`.

- [x] **Step 5: Extend API key repo**

Modify `src/lib/db/repos/apiKeysRepo.js` to include:

```js
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { calculateExpiresAt, getRenewalBaseDate, isExpiredAt, normalizePlanMonths } from "@/lib/api-keys/plans.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    planMonths: row.planMonths === null || row.planMonths === undefined ? null : Number(row.planMonths),
    expiresAt: row.expiresAt || null,
    deactivatedReason: row.deactivatedReason || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

async function expireApiKeys(db, now = new Date()) {
  const ts = now.toISOString();
  db.run(
    `UPDATE apiKeys
       SET isActive = 0, deactivatedReason = 'expired', updatedAt = ?
     WHERE expiresAt IS NOT NULL
       AND expiresAt <= ?
       AND isActive != 0`,
    [ts, ts]
  );
}

function normalizeUpdateData(row, data, now = new Date()) {
  const current = rowToKey(row);
  const next = { ...current, ...data };
  if (Object.prototype.hasOwnProperty.call(data, "planMonths")) {
    next.planMonths = data.planMonths === null ? null : normalizePlanMonths(data.planMonths);
  }
  if (Object.prototype.hasOwnProperty.call(data, "isActive")) {
    next.isActive = data.isActive === true;
    if (next.isActive) {
      if (isExpiredAt(next.expiresAt, now)) {
        next.isActive = false;
        next.deactivatedReason = "expired";
      } else {
        next.deactivatedReason = null;
      }
    } else {
      next.deactivatedReason = data.deactivatedReason || "manual";
    }
  }
  return next;
}
```

Then update exported functions:

```js
export async function getApiKeys(options = {}) {
  const db = await getAdapter();
  await expireApiKeys(db, options.now || new Date());
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id, options = {}) {
  const db = await getAdapter();
  await expireApiKeys(db, options.now || new Date());
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const now = options.now || new Date();
  const planMonths = options.planMonths === undefined ? null : normalizePlanMonths(options.planMonths);
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    planMonths,
    expiresAt: planMonths ? calculateExpiresAt(planMonths, now) : null,
    deactivatedReason: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, planMonths, expiresAt, deactivatedReason, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.planMonths, apiKey.expiresAt, apiKey.deactivatedReason, apiKey.createdAt, apiKey.updatedAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data, options = {}) {
  const db = await getAdapter();
  let result = null;
  const now = options.now || new Date();
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = normalizeUpdateData(row, data, now);
    merged.updatedAt = now.toISOString();
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, planMonths = ?, expiresAt = ?, deactivatedReason = ?, updatedAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.planMonths, merged.expiresAt, merged.deactivatedReason, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function renewApiKey(id, planMonths, now = new Date()) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const plan = normalizePlanMonths(planMonths);
    const baseDate = getRenewalBaseDate(current.expiresAt, now);
    const updatedAt = now.toISOString();
    const expiresAt = calculateExpiresAt(plan, baseDate);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, planMonths = ?, expiresAt = ?, deactivatedReason = ?, updatedAt = ? WHERE id = ?`,
      [current.key, current.name, current.machineId, 1, plan, expiresAt, null, updatedAt, id]
    );
    result = { ...current, isActive: true, planMonths: plan, expiresAt, deactivatedReason: null, updatedAt };
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key, options = {}) {
  const db = await getAdapter();
  await expireApiKeys(db, options.now || new Date());
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const parsed = rowToKey(row);
  return parsed.isActive === true && !isExpiredAt(parsed.expiresAt, options.now || new Date());
}
```

- [x] **Step 6: Update DB import/export**

Modify `src/lib/db/index.js` `exportDb()` `apiKeys` mapping:

```js
apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  machineId: r.machineId,
  isActive: r.isActive === 1,
  planMonths: r.planMonths ?? null,
  expiresAt: r.expiresAt || null,
  deactivatedReason: r.deactivatedReason || null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt || r.createdAt,
})),
```

Modify `importDb()` API key insert:

```js
db.run(
  `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, planMonths, expiresAt, deactivatedReason, createdAt, updatedAt)
   VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    k.id,
    k.key,
    k.name || null,
    k.machineId || null,
    k.isActive === false ? 0 : 1,
    k.planMonths ?? null,
    k.expiresAt || null,
    k.deactivatedReason || null,
    k.createdAt || new Date().toISOString(),
    k.updatedAt || k.createdAt || new Date().toISOString(),
  ]
);
```

Modify legacy import in `src/lib/db/migrate.js` in the same way for `apiKeys`, keeping missing plan fields null.

- [x] **Step 7: Export new repo functions**

Modify `src/lib/db/index.js` API keys export:

```js
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey, renewApiKey,
} from "./repos/apiKeysRepo.js";
```

Modify `src/lib/localDb.js` export list:

```js
getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey, renewApiKey,
```

- [x] **Step 8: Run tests**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-plans.test.js tests/unit/api-keys-repo-expiry.test.js
```

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add src/lib/db/schema.js src/lib/db/migrations/002-api-key-expiration.js src/lib/db/migrations/index.js src/lib/db/repos/apiKeysRepo.js src/lib/db/repos/settingsRepo.js src/lib/db/index.js src/lib/db/migrate.js src/lib/localDb.js tests/unit/api-keys-repo-expiry.test.js
git commit -m "feat: add api key expiration metadata"
```

---

### Task 4: Admin API Routes

**Files:**

- Create: `src/app/api/admin/keys/route.js`
- Create: `src/app/api/admin/keys/[id]/route.js`
- Create: `src/app/api/admin/keys/[id]/renew/route.js`
- Create: `tests/unit/admin-keys-routes.test.js`
- Modify: `src/dashboardGuard.js`
- Test: `tests/unit/dashboard-guard.test.js`

- [x] **Step 1: Write failing route tests**

Create `tests/unit/admin-keys-routes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => new Response(JSON.stringify(body), { status: init?.status || 200 })),
  requireAdminApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  renewApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/auth/adminApiKey", () => ({
  requireAdminApiKey: mocks.requireAdminApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
  createApiKey: mocks.createApiKey,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
  renewApiKey: mocks.renewApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const adminListRoute = await import("../../src/app/api/admin/keys/route.js");
const adminItemRoute = await import("../../src/app/api/admin/keys/[id]/route.js");
const adminRenewRoute = await import("../../src/app/api/admin/keys/[id]/renew/route.js");

function request(body, headers = {}) {
  return new Request("http://localhost/api/admin/keys", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return await response.json();
}

describe("admin key routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiKey.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue("machine");
  });

  it("rejects missing or wrong admin key", async () => {
    mocks.requireAdminApiKey.mockResolvedValue(false);
    const response = await adminListRoute.GET(new Request("http://localhost/api/admin/keys"));
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "Unauthorized" });
  });

  it("lists keys with admin key", async () => {
    mocks.getApiKeys.mockResolvedValue([{ id: "key-1", name: "User" }]);
    const response = await adminListRoute.GET(new Request("http://localhost/api/admin/keys"));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ keys: [{ id: "key-1", name: "User" }] });
  });

  it("creates key with required name and plan", async () => {
    mocks.createApiKey.mockResolvedValue({ id: "key-1", key: "sk-new", name: "User", planMonths: 1 });
    const response = await adminListRoute.POST(request({ name: "User", planMonths: 1 }));
    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith("User", "machine", { planMonths: 1 });
    expect(await json(response)).toEqual({ key: { id: "key-1", key: "sk-new", name: "User", planMonths: 1 } });
  });

  it("rejects invalid create body", async () => {
    const response = await adminListRoute.POST(request({ name: "", planMonths: 2 }));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "Name and valid planMonths are required" });
  });

  it("rejects unknown patch fields", async () => {
    const response = await adminItemRoute.PATCH(request({ owner: "wrong" }), { params: Promise.resolve({ id: "key-1" }) });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "Unsupported field: owner" });
  });

  it("renews key", async () => {
    mocks.renewApiKey.mockResolvedValue({ id: "key-1", expiresAt: "2026-08-18T00:00:00.000Z" });
    const response = await adminRenewRoute.POST(request({ planMonths: 1 }), { params: Promise.resolve({ id: "key-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.renewApiKey).toHaveBeenCalledWith("key-1", 1);
  });
});
```

- [x] **Step 2: Run tests and confirm failure**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-keys-routes.test.js
```

Expected: FAIL because admin routes do not exist.

- [x] **Step 3: Implement admin list/create route**

Create `src/app/api/admin/keys/route.js`:

```js
import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { createApiKey, getApiKeys } from "@/lib/localDb";
import { normalizePlanMonths } from "@/lib/api-keys/plans";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

async function unauthorized(request) {
  if (await requireAdminApiKey(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request) {
  const authError = await unauthorized(request);
  if (authError) return authError;
  const keys = await getApiKeys();
  return NextResponse.json({ keys });
}

export async function POST(request) {
  const authError = await unauthorized(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const name = String(body?.name || "").trim();
    const planMonths = normalizePlanMonths(body?.planMonths);
    if (!name) throw new Error("invalid");
    const machineId = await getConsistentMachineId();
    const key = await createApiKey(name, machineId, { planMonths });
    return NextResponse.json({ key }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Name and valid planMonths are required" }, { status: 400 });
  }
}
```

- [x] **Step 4: Implement admin item route**

Create `src/app/api/admin/keys/[id]/route.js`:

```js
import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "@/lib/api-keys/plans";

const ALLOWED_PATCH_FIELDS = new Set(["name", "isActive", "planMonths"]);

async function unauthorized(request) {
  if (await requireAdminApiKey(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function buildPatch(body) {
  const patch = {};
  for (const key of Object.keys(body || {})) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) throw new Error(`Unsupported field: ${key}`);
  }
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
    patch.isActive = body.isActive === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "planMonths")) {
    patch.planMonths = normalizePlanMonths(body.planMonths);
  }
  return patch;
}

export async function GET(request, { params }) {
  const authError = await unauthorized(request);
  if (authError) return authError;
  const { id } = await params;
  const key = await getApiKeyById(id);
  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  return NextResponse.json({ key });
}

export async function PATCH(request, { params }) {
  const authError = await unauthorized(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const body = await request.json();
    const patch = buildPatch(body);
    const updated = await updateApiKey(id, patch);
    if (!updated) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Invalid key update" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const authError = await unauthorized(request);
  if (authError) return authError;
  const { id } = await params;
  const deleted = await deleteApiKey(id);
  if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
  return NextResponse.json({ message: "Key deleted successfully" });
}
```

- [x] **Step 5: Implement admin renew route**

Create `src/app/api/admin/keys/[id]/renew/route.js`:

```js
import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { normalizePlanMonths } from "@/lib/api-keys/plans";
import { renewApiKey } from "@/lib/localDb";

export async function POST(request, { params }) {
  if (!(await requireAdminApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const body = await request.json();
    const planMonths = normalizePlanMonths(body?.planMonths);
    const key = await renewApiKey(id, planMonths);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch {
    return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
  }
}
```

- [x] **Step 6: Allow admin key routes through dashboard guard**

Modify `src/dashboardGuard.js`:

```js
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/version",
  "/api/settings/require-login",
  "/api/admin/keys",
];
```

Append tests to `tests/unit/dashboard-guard.test.js`:

```js
it("lets admin key routes reach route-level admin auth", async () => {
  const response = await proxy(request("/api/admin/keys", { host: "router.example.com" }));

  expect(response).toBe(mocks.nextResponse);
  expect(mocks.validateApiKey).not.toHaveBeenCalled();
});
```

- [x] **Step 7: Run route and guard tests**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/admin-keys-routes.test.js tests/unit/dashboard-guard.test.js
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/app/api/admin/keys/route.js 'src/app/api/admin/keys/[id]/route.js' 'src/app/api/admin/keys/[id]/renew/route.js' src/dashboardGuard.js tests/unit/admin-keys-routes.test.js tests/unit/dashboard-guard.test.js
git commit -m "feat: add admin customer key API"
```

---

### Task 5: Dashboard Admin Key Route

**Files:**

- Create: `src/app/api/settings/admin-key/route.js`
- Modify: `src/app/(dashboard)/dashboard/profile/page.js`

- [x] **Step 1: Implement dashboard admin key API route**

Create `src/app/api/settings/admin-key/route.js`:

```js
import { NextResponse } from "next/server";
import { createOrRotateAdminApiKey, getAdminApiKeyStatus } from "@/lib/auth/adminApiKey";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAdminApiKeyStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to load admin API key status" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await createOrRotateAdminApiKey();
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create admin API key" }, { status: 500 });
  }
}
```

- [x] **Step 2: Add Profile page state and loader**

Modify `src/app/(dashboard)/dashboard/profile/page.js` state near other profile state:

```js
const [adminKeyStatus, setAdminKeyStatus] = useState({ configured: false, createdAt: null, updatedAt: null });
const [adminKeyPlaintext, setAdminKeyPlaintext] = useState("");
const [adminKeyLoading, setAdminKeyLoading] = useState(false);
const [adminKeyMessage, setAdminKeyMessage] = useState({ type: "", message: "" });
```

Add loader function before `handlePasswordChange`:

```js
const loadAdminKeyStatus = async () => {
  try {
    const res = await fetch("/api/settings/admin-key", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setAdminKeyStatus(data);
  } catch {
    setAdminKeyMessage({ type: "error", message: "Failed to load admin API key status" });
  }
};
```

In the existing initial `useEffect`, keep the current `fetch("/api/settings")` chain unchanged. Add this line immediately after that chain and before the closing `}, []);`:

```js
loadAdminKeyStatus();
```

- [x] **Step 3: Add Profile create/regenerate handler**

Add handler:

```js
const rotateAdminKey = async () => {
  setAdminKeyLoading(true);
  setAdminKeyMessage({ type: "", message: "" });
  try {
    const res = await fetch("/api/settings/admin-key", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setAdminKeyMessage({ type: "error", message: data.error || "Failed to generate admin API key" });
      return;
    }
    setAdminKeyStatus(data.status);
    setAdminKeyPlaintext(data.key);
    setAdminKeyMessage({ type: "success", message: "Admin API key generated. Copy it now; it will not be shown again." });
  } catch {
    setAdminKeyMessage({ type: "error", message: "Failed to generate admin API key" });
  } finally {
    setAdminKeyLoading(false);
  }
};
```

- [x] **Step 4: Add Profile UI section**

In the Profile page JSX near password/auth settings, add:

```jsx
<Card>
  <div className="flex items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold">Admin API Key</h2>
      <p className="text-sm text-text-muted">
        Manage customer API keys without dashboard JWT.
      </p>
    </div>
    <Button
      icon={adminKeyStatus.configured ? "sync" : "key"}
      onClick={rotateAdminKey}
      loading={adminKeyLoading}
    >
      {adminKeyStatus.configured ? "Regenerate" : "Create"}
    </Button>
  </div>

  <div className="mt-4 rounded-lg border border-border p-3">
    <p className="text-sm text-text-muted">
      Status: {adminKeyStatus.configured ? "Configured" : "Not configured"}
    </p>
    {adminKeyStatus.updatedAt && (
      <p className="mt-1 text-xs text-text-muted">
        Updated {new Date(adminKeyStatus.updatedAt).toLocaleString()}
      </p>
    )}
    {adminKeyPlaintext && (
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-sidebar px-2 py-2 text-xs">
          {adminKeyPlaintext}
        </code>
        <Button size="sm" icon="content_copy" onClick={() => navigator.clipboard.writeText(adminKeyPlaintext)}>
          Copy
        </Button>
      </div>
    )}
    {adminKeyMessage.message && (
      <p className={`mt-2 text-sm ${adminKeyMessage.type === "error" ? "text-red-500" : "text-green-600"}`}>
        {adminKeyMessage.message}
      </p>
    )}
  </div>
</Card>
```

- [x] **Step 5: Run build check**

Run:

```bash
npm run build
```

Expected: build completes. If build finds JSX placement/import issues, fix before committing.

- [x] **Step 6: Commit**

```bash
git add src/app/api/settings/admin-key/route.js 'src/app/(dashboard)/dashboard/profile/page.js'
git commit -m "feat: add dashboard admin key controls"
```

---

### Task 6: Dashboard Customer Key Plans And Renewals

**Files:**

- Modify: `src/app/api/keys/route.js`
- Modify: `src/app/api/keys/[id]/route.js`
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`

- [x] **Step 1: Update dashboard key routes**

Modify `src/app/api/keys/route.js` POST by replacing the create block with this concrete flow:

```js
const { name, planMonths } = body;
if (!name) {
  return NextResponse.json({ error: "Name is required" }, { status: 400 });
}

const machineId = await getConsistentMachineId();
const createOptions = {};
if (planMonths !== undefined) createOptions.planMonths = planMonths;
const apiKey = await createApiKey(name, machineId, createOptions);

return NextResponse.json({ key: apiKey }, { status: 201 });
```

Modify `src/app/api/keys/[id]/route.js` imports:

```js
import { deleteApiKey, getApiKeyById, renewApiKey, updateApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "@/lib/api-keys/plans";
```

Modify `PUT` to allow:

```js
const { isActive, name, planMonths } = body;
const updateData = {};
if (isActive !== undefined) updateData.isActive = isActive;
if (name !== undefined) updateData.name = String(name || "").trim();
if (planMonths !== undefined) updateData.planMonths = normalizePlanMonths(planMonths);
```

Add `POST` for dashboard renewal:

```js
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const planMonths = normalizePlanMonths(body?.planMonths);
    const key = await renewApiKey(id, planMonths);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch {
    return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
  }
}
```

- [x] **Step 2: Add Endpoint page plan state**

Modify `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` state near key modal state:

```js
const PLAN_OPTIONS = [1, 3, 6, 12];
const [newKeyPlanMonths, setNewKeyPlanMonths] = useState(1);
const [renewState, setRenewState] = useState(null);
```

Add helpers near `maskKey`:

```js
const formatPlan = (planMonths) => planMonths ? `${planMonths} month${planMonths > 1 ? "s" : ""}` : "No plan";

const getKeyStatus = (key) => {
  if (key.deactivatedReason === "expired") return { label: "Expired", className: "text-red-500" };
  if (key.isActive === false) return { label: "Paused", className: "text-orange-500" };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return { label: "Expired", className: "text-red-500" };
  return { label: "Active", className: "text-green-600" };
};
```

- [x] **Step 3: Update create key handler**

Modify `handleCreateKey` body:

```js
body: JSON.stringify({ name: newKeyName, planMonths: newKeyPlanMonths }),
```

On success reset plan:

```js
setNewKeyPlanMonths(1);
```

- [x] **Step 4: Add renew handler**

Add:

```js
const handleRenewKey = async () => {
  if (!renewState?.id) return;
  try {
    const res = await fetch(`/api/keys/${renewState.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planMonths: renewState.planMonths }),
    });
    if (res.ok) {
      await fetchData();
      setRenewState(null);
    }
  } catch (error) {
    console.log("Error renewing key:", error);
  }
};
```

- [x] **Step 5: Update key list display**

Inside `keys.map`, compute status at the start of the existing row render:

```jsx
const status = getKeyStatus(key);
```

Change the current expression-body `keys.map` callback into a block-body callback so the `status` constant is available before returning the existing row JSX. Keep the current row JSX, then insert the metadata and Renew button from the next two snippets.

Add metadata below created date:

```jsx
<div className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted">
  <span>{formatPlan(key.planMonths)}</span>
  {key.expiresAt && <span>Expires {new Date(key.expiresAt).toLocaleDateString()}</span>}
  <span className={status.className}>{status.label}</span>
</div>
```

Add Renew button next to toggle/delete:

```jsx
<button
  onClick={() => setRenewState({ id: key.id, name: key.name, planMonths: key.planMonths || 1 })}
  className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all"
  title="Renew key"
>
  <span className="material-symbols-outlined text-[18px]">event_repeat</span>
</button>
```

- [x] **Step 6: Add create modal plan selector**

In create key modal, add after name input:

```jsx
<div>
  <label className="mb-2 block text-sm font-medium">Plan</label>
  <select
    className="w-full rounded-lg border border-border bg-background px-3 py-2"
    value={newKeyPlanMonths}
    onChange={(e) => setNewKeyPlanMonths(Number(e.target.value))}
  >
    {PLAN_OPTIONS.map((months) => (
      <option key={months} value={months}>{formatPlan(months)}</option>
    ))}
  </select>
</div>
```

- [x] **Step 7: Add renew modal**

Near existing modals, add:

```jsx
<Modal isOpen={!!renewState} onClose={() => setRenewState(null)} title="Renew API Key">
  {renewState && (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Renew {renewState.name}
      </p>
      <select
        className="w-full rounded-lg border border-border bg-background px-3 py-2"
        value={renewState.planMonths}
        onChange={(e) => setRenewState((prev) => ({ ...prev, planMonths: Number(e.target.value) }))}
      >
        {PLAN_OPTIONS.map((months) => (
          <option key={months} value={months}>{formatPlan(months)}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setRenewState(null)}>Cancel</Button>
        <Button icon="event_repeat" onClick={handleRenewKey}>Renew</Button>
      </div>
    </div>
  )}
</Modal>
```

- [x] **Step 8: Build check**

Run:

```bash
npm run build
```

Expected: build completes. Fix JSX errors if the modal API props differ from local component signatures.

- [x] **Step 9: Commit**

```bash
git add src/app/api/keys/route.js 'src/app/api/keys/[id]/route.js' 'src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js'
git commit -m "feat: add key plans and renewals to dashboard"
```

---

### Task 7: Documentation And Final Verification

**Files:**

- Modify: `docs/ARCHITECTURE.md`

- [x] **Step 1: Update architecture doc**

Add under `## 4) Auth + Security Surfaces`:

```markdown
- Admin customer-key management: dashboard can create/regenerate one admin API key, stored hashed in settings. `/api/admin/keys/*` accepts that key via `Authorization: Bearer` or `x-admin-api-key` and manages customer API keys without dashboard JWT.
- Customer API key expiration: `apiKeys` records can carry `planMonths`, `expiresAt`, `deactivatedReason`, and `updatedAt`; lazy expiry runs before key lists and key validation.
```

- [x] **Step 2: Run focused tests**

Run:

```bash
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/api-key-plans.test.js tests/unit/admin-api-key-auth.test.js tests/unit/api-keys-repo-expiry.test.js tests/unit/admin-keys-routes.test.js tests/unit/dashboard-guard.test.js
```

Expected: PASS.

- [x] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

Result: blocked locally because `next` is not installed in local dependencies (`sh: next: command not found`). Focused route tests and JSX/route syntax checks passed.

- [x] **Step 4: Manual API smoke with dev server**

Start dev server:

```bash
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Then, from another terminal:

```bash
curl -s http://localhost:20128/api/settings/admin-key
```

Expected: protected by dashboard guard unless authenticated in browser. Use browser dashboard to create admin key, then:

```bash
curl -s -H "Authorization: Bearer <admin-key>" http://localhost:20128/api/admin/keys
curl -s -X POST -H "Authorization: Bearer <admin-key>" -H "Content-Type: application/json" -d '{"name":"Smoke User","planMonths":1}' http://localhost:20128/api/admin/keys
```

Expected: first command returns a JSON object with a `keys` array and second command returns `201` JSON with a new customer key and `expiresAt`.

Result: blocked locally because the dev server also cannot start without `next` (`sh: next: command not found`). Admin route behavior is covered by focused route tests.

- [x] **Step 5: Commit docs**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: document admin key management"
```

- [x] **Step 6: Final review**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree except intentionally uncommitted local artifacts. Latest commits are focused and do not mention AI.

## Docs Impact

Docs impact: minor. `docs/ARCHITECTURE.md` should mention the new admin API key auth surface and lazy customer-key expiration.

## Unresolved Questions

None.
