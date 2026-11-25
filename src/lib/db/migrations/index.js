// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-key-policy.js";

import m003 from "./003-key-budgets.js";

import m004 from "./004-calendar-request-quotas.js";

import m005 from "./005-key-verifiers.js";

import m006 from "./006-encrypted-gateway-keys.js";

import m007 from "./007-request-id.js";

import m008 from "./008-log-privacy.js";

import m009 from "./009-notifications.js";

import m010 from "./010-key-ownership.js";

import m011 from "./011-key-connections.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
