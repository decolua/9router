import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hasRotatingRefreshToken,
  mergeDbCredentials,
  resolveRotatedDbCredentials,
} from "../../src/sse/services/tokenRotationGuard.js";

test("only codex is treated as rotating refresh-token provider", () => {
  assert.equal(hasRotatingRefreshToken("codex"), true);
  assert.equal(hasRotatingRefreshToken("kiro"), false);
  assert.equal(hasRotatingRefreshToken("github"), false);
});

test("mergeDbCredentials overlays token fields and preserves local fields", () => {
  const merged = mergeDbCredentials(
    {
      connectionId: "c1",
      accessToken: "old-at",
      refreshToken: "old-rt",
      expiresAt: "old-exp",
      projectId: "old-project",
      providerSpecificData: { keep: true, old: true },
      connectionName: "UI name",
    },
    {
      accessToken: "new-at",
      refreshToken: "new-rt",
      expiresAt: "new-exp",
      projectId: "new-project",
      providerSpecificData: { old: false, fresh: true },
    }
  );

  assert.deepEqual(merged, {
    connectionId: "c1",
    accessToken: "new-at",
    refreshToken: "new-rt",
    expiresAt: "new-exp",
    projectId: "new-project",
    providerSpecificData: { keep: true, old: false, fresh: true },
    connectionName: "UI name",
  });
});

test("codex uses DB credentials when DB refresh token rotated", () => {
  const result = resolveRotatedDbCredentials(
    "codex",
    { connectionId: "c1", accessToken: "old-at", refreshToken: "old-rt" },
    { accessToken: "new-at", refreshToken: "new-rt" }
  );

  assert.equal(result.wasRotated, true);
  assert.equal(result.creds.accessToken, "new-at");
  assert.equal(result.creds.refreshToken, "new-rt");
});

test("codex does not rotate when DB token is unchanged", () => {
  const creds = { connectionId: "c1", accessToken: "old-at", refreshToken: "same-rt" };
  const result = resolveRotatedDbCredentials("codex", creds, { refreshToken: "same-rt" });

  assert.equal(result.wasRotated, false);
  assert.equal(result.creds, creds);
});

test("non-rotating providers ignore DB refresh-token differences", () => {
  const creds = { connectionId: "c1", accessToken: "old-at", refreshToken: "old-rt" };
  const result = resolveRotatedDbCredentials("kiro", creds, {
    accessToken: "new-at",
    refreshToken: "new-rt",
  });

  assert.equal(result.wasRotated, false);
  assert.equal(result.creds, creds);
});

test("missing connection id disables DB rotation guard", () => {
  const creds = { accessToken: "old-at", refreshToken: "old-rt" };
  const result = resolveRotatedDbCredentials("codex", creds, {
    accessToken: "new-at",
    refreshToken: "new-rt",
  });

  assert.equal(result.wasRotated, false);
  assert.equal(result.creds, creds);
});
