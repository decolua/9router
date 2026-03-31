import fs from "fs";
import path from "path";
import os from "os";
import { createProviderConnection, getProviderConnections } from "@/lib/localDb";
import { testSingleConnection } from "@/app/api/providers/[id]/test/testUtils";

const AGT_DIR = path.join(os.homedir(), ".antigravity_tools");
const ACCOUNTS_JSON = path.join(AGT_DIR, "accounts.json");
const ACCOUNTS_DIR = path.join(AGT_DIR, "accounts");

/**
 * Read account list from ~/.antigravity_tools/accounts.json
 */
function readAccountsList() {
  if (!fs.existsSync(ACCOUNTS_JSON)) return [];
  const data = JSON.parse(fs.readFileSync(ACCOUNTS_JSON, "utf-8"));
  return data.accounts || [];
}

/**
 * Read full account data from ~/.antigravity_tools/accounts/{uuid}.json
 */
function readAccountDetail(uuid) {
  const filePath = path.join(ACCOUNTS_DIR, `${uuid}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * GET /api/antigravity-tools/import — Preview importable accounts
 */
export async function GET() {
  try {
    if (!fs.existsSync(AGT_DIR)) {
      return Response.json({
        error: "~/.antigravity_tools not found",
        accounts: [],
      }, { status: 404 });
    }

    const accountsList = readAccountsList();
    const existingConnections = await getProviderConnections({ provider: "antigravity" });
    const existingEmails = new Set(existingConnections.map(c => c.email));

    const accounts = accountsList.map(acc => {
      const detail = readAccountDetail(acc.id);
      return {
        id: acc.id,
        email: acc.email,
        name: acc.name,
        disabled: acc.disabled,
        hasToken: !!(detail?.token?.access_token),
        hasRefreshToken: !!(detail?.token?.refresh_token),
        isNew: !existingEmails.has(acc.email),
      };
    });

    return Response.json({ accounts, total: accounts.length });
  } catch (error) {
    console.error("[antigravity-tools/import] Preview error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/antigravity-tools/import — Execute import
 */
export async function POST() {
  try {
    if (!fs.existsSync(AGT_DIR)) {
      return Response.json({ error: "~/.antigravity_tools not found" }, { status: 404 });
    }

    const accountsList = readAccountsList();
    const existingConnections = await getProviderConnections({ provider: "antigravity" });
    const existingEmails = new Set(existingConnections.map(c => c.email));

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const acc of accountsList) {
      try {
        // Skip disabled accounts
        if (acc.disabled) {
          skipped++;
          continue;
        }

        const detail = readAccountDetail(acc.id);
        if (!detail?.token?.access_token) {
          skipped++;
          continue;
        }

        const token = detail.token;

        // Convert expiry_timestamp (epoch seconds) to ISO string
        let expiresAt = null;
        if (token.expiry_timestamp) {
          expiresAt = new Date(token.expiry_timestamp * 1000).toISOString();
        } else if (token.expires_in) {
          expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
        }

        const connectionData = {
          provider: "antigravity",
          authType: "oauth",
          email: acc.email || token.email,
          name: acc.name || acc.email,
          accessToken: token.access_token,
          refreshToken: token.refresh_token || null,
          expiresAt,
          projectId: token.project_id || null,
          isActive: true,
        };

        const isExisting = existingEmails.has(connectionData.email);

        // createProviderConnection does upsert by provider + email
        const connection = await createProviderConnection(connectionData);

        // Test the connection to set testStatus (active/error)
        try {
          const testResult = await testSingleConnection(connection.id);
          console.log(`[antigravity-tools/import] Tested ${connectionData.email}: ${testResult.valid ? "active" : "error"} (${testResult.latencyMs}ms)`);
        } catch (testErr) {
          console.log(`[antigravity-tools/import] Test failed for ${connectionData.email}: ${testErr.message}`);
        }

        if (isExisting) {
          updated++;
        } else {
          imported++;
          existingEmails.add(connectionData.email);
        }
      } catch (err) {
        errors.push({ email: acc.email, error: err.message });
      }
    }

    console.log(`[antigravity-tools/import] Done: imported=${imported}, updated=${updated}, skipped=${skipped}, errors=${errors.length}`);

    return Response.json({ imported, updated, skipped, errors, total: accountsList.length });
  } catch (error) {
    console.error("[antigravity-tools/import] Import error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
