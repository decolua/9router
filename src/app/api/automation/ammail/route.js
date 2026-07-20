import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb.js";
import { getAmmailClientFromSettings } from "@/lib/automation/ammailClient.js";
import { listAmmailOtps, deleteAmmailOtpsBulk } from "@/lib/db/index.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const settings = await getSettings();
    const client = await getAmmailClientFromSettings();
    const otps = await listAmmailOtps();

    let configured = client.configured;
    let connectionOk = false;
    let connectionError = "";
    let domains = [];
    let inboxes = [];
    let webhook = null;

    if (configured) {
      try {
        const info = await client.info();
        domains = info.domains || [];
        connectionOk = true;
        
        try {
          inboxes = await client.listInboxes();
        } catch (e) {
          console.warn("Failed to list inboxes:", e);
        }

        try {
          webhook = await client.getWebhook();
        } catch (e) {
          console.warn("Failed to get webhook:", e);
        }
      } catch (err) {
        connectionError = err.message || String(err);
      }
    }

    let tunnelUrl = (settings.tunnelEnabled && settings.tunnelUrl) ? settings.tunnelUrl : "";
    let webhookUrl = "";
    if (tunnelUrl) {
      webhookUrl = `${tunnelUrl.replace(/\/+$/, "")}/api/automation/ammail/webhook`;
    } else {
      const scheme = request.headers.get("x-forwarded-proto") || "http";
      const host = request.headers.get("host");
      webhookUrl = `${scheme}://${host}/api/automation/ammail/webhook`;
    }

    if (connectionOk && inboxes.length > 0) {
      // Run message synchronization in the background
      (async () => {
        try {
          const existingIds = new Set(otps.map(o => o.messageShortId).filter(Boolean));
          for (const inbox of inboxes) {
            try {
              const messages = await client.listMessages(inbox.alias);
              for (const msg of messages) {
                const msgId = String(msg.id || "");
                if (msgId && !existingIds.has(msgId)) {
                  try {
                    const fullMsg = await client.getMessage(msgId);
                    const textBody = String(fullMsg.text || msg.snippet || "");
                    const htmlBody = String(fullMsg.html || "");
                    const sender = String(fullMsg.from_address || fullMsg.from_name || msg.from_address || "");
                    const subject = String(fullMsg.subject || msg.subject || "");
                    const address = inbox.address;
                    const alias = inbox.alias;
                    const domain = inbox.domain;

                    const { extractOtp } = await import("@/lib/automation/ammailClient.js");
                    const { code, verifyUrl } = extractOtp(textBody, htmlBody, subject);

                    const { insertAmmailOtp } = await import("@/lib/db/index.js");
                    await insertAmmailOtp({
                      address,
                      alias,
                      domain,
                      sender,
                      subject,
                      otpCode: code,
                      verifyUrl,
                      bodyText: textBody,
                      bodyHtml: htmlBody,
                      messageShortId: msgId,
                      rawEventJson: JSON.stringify(fullMsg).substring(0, 32000),
                    });
                    console.log(`Sync: Stored missing email for ${address}, OTP: ${code || "-"}`);
                  } catch (err) {
                    console.error(`Sync: Failed to fetch message details for ${msgId}:`, err);
                  }
                }
              }
            } catch (err) {
              console.error(`Sync: Failed to list messages for inbox ${inbox.alias}:`, err);
            }
          }
        } catch (err) {
          console.error("Background sync error:", err);
        }
      })();
    }

    return NextResponse.json({
      configured,
      connection_ok: connectionOk,
      connection_error: connectionError,
      domains,
      inboxes: inboxes.map(i => ({
        alias: i.alias,
        address: i.address,
        domain: i.domain,
        createdAt: i.createdAt
      })),
      webhook,
      webhook_url: webhookUrl,
      settings: {
        base_url: settings.ammail_base_url || "",
        api_key: settings.ammail_api_key || "",
        default_domain: settings.ammail_default_domain || "",
        webhook_secret: settings.ammail_webhook_secret || "",
        cf_account_id: settings.ammail_cf_account_id || "",
        cf_api_token: settings.ammail_cf_api_token || "",
        cf_domain: settings.ammail_cf_domain || "",
        cf_telegram_bot_token: settings.ammail_cf_telegram_bot_token || "",
        cf_workers_dev_url: settings.ammail_cf_workers_dev_url || "",
      },
      otps: otps.map(o => ({
        id: o.id,
        address: o.address,
        alias: o.alias,
        sender: o.sender,
        subject: o.subject,
        otp_code: o.otpCode,
        verify_url: o.verifyUrl,
        received_at: o.receivedAt,
        used_at: o.usedAt
      }))
    });
  } catch (error) {
    console.error("Error in GET /api/automation/ammail:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Action: List Domains ─────────────────────────────────────────
    if (action === "list-domains") {
      const settings = await getSettings();
      const client = await getAmmailClientFromSettings();
      let domains = [];
      if (client.configured) {
        try {
          const info = await client.info();
          domains = info.domains || [];
        } catch (e) {
          // fallback to default domain from settings
        }
      }
      if (domains.length === 0 && settings.ammail_default_domain) {
        domains = [settings.ammail_default_domain];
      }
      return NextResponse.json({
        ok: true,
        domains,
        default_domain: settings.ammail_default_domain || domains[0] || ""
      });
    }

    // ── Action: Save Settings ────────────────────────────────────────
    if (action === "settings") {
      const { base_url, api_key, default_domain, webhook_secret, cf_account_id, cf_api_token, cf_domain, cf_telegram_bot_token, cf_workers_dev_url } = body;
      const updates = {};
      if (base_url !== undefined) updates.ammail_base_url = base_url;
      if (api_key !== undefined) updates.ammail_api_key = api_key;
      if (default_domain !== undefined) updates.ammail_default_domain = default_domain;
      if (cf_account_id !== undefined) updates.ammail_cf_account_id = cf_account_id;
      if (cf_api_token !== undefined) updates.ammail_cf_api_token = cf_api_token;
      if (cf_domain !== undefined) updates.ammail_cf_domain = cf_domain;
      if (cf_telegram_bot_token !== undefined) updates.ammail_cf_telegram_bot_token = cf_telegram_bot_token;
      if (cf_workers_dev_url !== undefined) updates.ammail_cf_workers_dev_url = cf_workers_dev_url;
      
      let secret = webhook_secret;
      if (secret === undefined || secret === "") {
        const settings = await getSettings();
        secret = settings.ammail_webhook_secret || crypto.randomBytes(16).toString("hex");
      }
      updates.ammail_webhook_secret = secret;

      await updateSettings(updates);
      return NextResponse.json({ ok: true });
    }

    // ── Action: Test Connection ──────────────────────────────────────
    if (action === "test-connection") {
      const { base_url, api_key } = body;
      try {
        const testClient = await getAmmailClientFromSettings({ base_url, api_key });
        const info = await testClient.info();
        return NextResponse.json({ ok: true, info });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
      }
    }

    // ── Action: Auto Deploy ──────────────────────────────────────────
    if (action === "auto-deploy") {
      const { cf_account_id, cf_api_token, cf_domain, telegram_bot_token } = body;
      
      if (!cf_account_id || !cf_api_token || !cf_domain) {
        return NextResponse.json({ error: "Account ID, API Token, dan Domain wajib diisi." }, { status: 400 });
      }

      const execEnv = {
        ...process.env,
        CLOUDFLARE_API_TOKEN: cf_api_token,
        CLOUDFLARE_ACCOUNT_ID: cf_account_id,
      };

      const cwd = fs.existsSync("/Users/husni/Documents/project/node/9router/tempmail") 
        ? "/Users/husni/Documents/project/node/9router/tempmail" 
        : (fs.existsSync("/home/data/Project/9router/tempmail") 
          ? "/home/data/Project/9router/tempmail" 
          : path.resolve(process.cwd(), "tempmail"));

      try {
        // 1. Resolve D1 database
        let databaseId = "";
        try {
          const listRes = await execAsync("npx wrangler d1 list --json", { env: execEnv, cwd });
          const dbs = JSON.parse(listRes.stdout);
          const found = dbs.find(d => d.name === "tempmail-9router");
          if (found) {
            databaseId = found.uuid || found.database_id;
          }
        } catch (err) {
          try {
            const listRes = await execAsync("npx wrangler d1 list", { env: execEnv, cwd });
            const match = listRes.stdout.match(/tempmail-9router\s+([a-f0-9-]{36})/i);
            if (match) databaseId = match[1];
          } catch (e) {
            console.error("D1 database search failed", e);
          }
        }

        // Create database if not found
        if (!databaseId) {
          try {
            const createRes = await execAsync("npx wrangler d1 create tempmail-9router --json", { env: execEnv, cwd });
            const createData = JSON.parse(createRes.stdout);
            databaseId = createData.uuid || createData.database_id;
          } catch (err) {
            const createRes = await execAsync("npx wrangler d1 create tempmail-9router", { env: execEnv, cwd });
            const stdout = createRes.stdout;
            const match = stdout.match(/database_id\s*=\s*"([^"]+)"/i) || stdout.match(/uuid\s*:\s*([a-f0-9-]{36})/i) || stdout.match(/([a-f0-9-]{36})/i);
            if (match) {
              databaseId = match[1];
            } else {
              throw new Error("Gagal mengekstrak ID database D1: " + stdout);
            }
          }
        }

        if (!databaseId) {
          throw new Error("Gagal mendapatkan atau membuat database D1.");
        }

        const parts = cf_domain.split(".");
        const emailDomain = parts.slice(-2).join(".");

        // 2. Write wrangler.jsonc
        const wranglerConfig = {
          "$schema": "./node_modules/wrangler/config-schema.json",
          "name": "tempmail-9router",
          "main": "src/index.js",
          "compatibility_date": "2026-04-10",
          "workers_dev": true,
          "routes": [
            {
              "pattern": cf_domain,
              "custom_domain": true
            }
          ],
          "compatibility_flags": [
            "nodejs_compat"
          ],
          "observability": {
            "enabled": true,
            "head_sampling_rate": 1
          },
          "triggers": {
            "crons": [
              "0 */6 * * *"
            ]
          },
          "vars": {
            "MAIL_DOMAIN": emailDomain,
            "MAIL_DOMAINS": emailDomain,
            "PUBLIC_BASE_URL": `https://${cf_domain}`,
            "ADMIN_IDS": "8458234191",
            "ADMIN_CONTACT": "@pixelnest_admin",
            "INBOX_TTL_HOURS": "24",
            "MAX_BODY_CHARS": "100000",
            "AUTO_DELETE_EXPIRED": "true"
          },
          "d1_databases": [
            {
              "binding": "DB",
              "database_name": "tempmail-9router",
              "database_id": databaseId
            }
          ]
        };
        await fs.promises.writeFile(`${cwd}/wrangler.jsonc`, JSON.stringify(wranglerConfig, null, 2));

        // 3. Apply database migration
        await execAsync("echo 'y' | npx wrangler d1 migrations apply tempmail-9router --remote", { env: execEnv, cwd });

        // 4. Create system API key for 9router
        const generatedApiKey = "tm_" + crypto.randomBytes(16).toString("hex");
        const sqlCommand = `
          INSERT OR IGNORE INTO chats (chat_id, username, first_name, last_name, created_at, updated_at)
          VALUES ('9router', '9router_admin', '9Router', 'Admin', datetime('now'), datetime('now'));

          INSERT OR REPLACE INTO api_access (user_id, api_key, quota_daily, quota_used, quota_date, granted_by, granted_at, expires_at)
          VALUES ('9router', '${generatedApiKey}', 0, 0, strftime('%Y-%m-%d', 'now'), 'admin', datetime('now'), '2099-12-31T23:59:59Z');
        `;
        await execAsync(`npx wrangler d1 execute tempmail-9router --remote --command="${sqlCommand.replace(/\n/g, " ").replace(/"/g, '\\"')}"`, { env: execEnv, cwd });

        // 5. Save Secrets (Telegram)
        if (telegram_bot_token) {
          await execAsync(`echo "${telegram_bot_token.trim()}" | npx wrangler secret put TELEGRAM_BOT_TOKEN`, { env: execEnv, cwd });
        } else {
          await execAsync(`echo "123456:dummy-token" | npx wrangler secret put TELEGRAM_BOT_TOKEN`, { env: execEnv, cwd });
        }

        const webhookSecretToken = crypto.randomBytes(16).toString("hex");
        await execAsync(`echo "${webhookSecretToken}" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, { env: execEnv, cwd });

        // 6. Deploy Worker
        const deployRes = await execAsync("npx wrangler deploy", { env: execEnv, cwd });
        const deployStdout = deployRes.stdout || "";
        console.log("Wrangler deploy stdout:", deployStdout);

        let workersDevUrl = "";
        const devUrlMatch = deployStdout.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
        if (devUrlMatch) {
          workersDevUrl = devUrlMatch[0];
        }

        // 7. Set Telegram bot webhook
        if (telegram_bot_token) {
          try {
            await fetch(`https://api.telegram.org/bot${telegram_bot_token.trim()}/setWebhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: `https://${cf_domain}/telegram/webhook`,
                secret_token: webhookSecretToken,
                allowed_updates: ["message", "callback_query"]
              })
            });
          } catch (e) {
            console.error("Gagal mendaftarkan webhook Telegram:", e);
          }
        }

        // 8. Update Settings
        const updates = {
          ammail_base_url: `https://${cf_domain}`,
          ammail_api_key: generatedApiKey,
          ammail_default_domain: emailDomain,
          ammail_webhook_secret: webhookSecretToken,
          ammail_cf_account_id: cf_account_id,
          ammail_cf_api_token: cf_api_token,
          ammail_cf_domain: cf_domain,
          ammail_cf_telegram_bot_token: telegram_bot_token || "",
          ammail_cf_workers_dev_url: workersDevUrl
        };
        await updateSettings(updates);

        return NextResponse.json({
          ok: true,
          base_url: updates.ammail_base_url,
          api_key: updates.ammail_api_key,
          default_domain: updates.ammail_default_domain,
          webhook_secret: updates.ammail_webhook_secret,
          cf_workers_dev_url: workersDevUrl
        });
      } catch (err) {
        console.error("Auto deploy failed:", err);
        return NextResponse.json({ error: err.message || String(err) }, { status: 502 });
      }
    }

    const client = await getAmmailClientFromSettings();
    if (!client.configured) {
      return NextResponse.json({ error: "Ammail belum dikonfigurasi." }, { status: 400 });
    }

    // ── Action: Create Inbox ─────────────────────────────────────────
    if (action === "inbox-create") {
      const { alias, domain } = body;
      try {
        const createRes = await client.createInbox(alias, domain);
        return NextResponse.json({ ok: true, inbox: createRes.inbox });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
      }
    }

    // ── Action: Register Webhook ─────────────────────────────────────
    if (action === "webhook-register") {
      const settings = await getSettings();
      let secret = settings.ammail_webhook_secret;
      if (!secret) {
        secret = crypto.randomBytes(32).toString("hex");
        await updateSettings({ ammail_webhook_secret: secret });
      }

      let tunnelUrl = (settings.tunnelEnabled && settings.tunnelUrl) ? settings.tunnelUrl : "";
      let webhookUrl = "";
      if (tunnelUrl) {
        webhookUrl = `${tunnelUrl.replace(/\/+$/, "")}/api/automation/ammail/webhook`;
      } else {
        const scheme = request.headers.get("x-forwarded-proto") || "http";
        const host = request.headers.get("host");
        webhookUrl = `${scheme}://${host}/api/automation/ammail/webhook`;
      }

      try {
        const webhookRes = await client.setWebhook(webhookUrl, secret);
        return NextResponse.json({ ok: true, webhook: webhookRes });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
      }
    }

    // ── Action: Webhook Test ─────────────────────────────────────────
    if (action === "webhook-test") {
      try {
        const testRes = await client.testWebhook();
        return NextResponse.json({ ok: true, result: testRes });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
      }
    }

    // ── Action: Delete Inbox ─────────────────────────────────────────
    if (action === "inbox-delete") {
      const { alias } = body;
      try {
        const ok = await client.deleteInbox(alias);
        try {
          await deleteAmmailOtpsBulk({ alias });
        } catch (dbErr) {
          console.error("Failed to delete local emails for alias:", alias, dbErr);
        }
        return NextResponse.json({ ok });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 502 });
      }
    }

    // ── Action: Delete Bulk OTPs ─────────────────────────────────────
    if (action === "otps-delete-bulk") {
      const { folder, address } = body;
      try {
        await deleteAmmailOtpsBulk({ folder, address });
        return NextResponse.json({ ok: true });
      } catch (e) {
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in POST /api/automation/ammail:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
