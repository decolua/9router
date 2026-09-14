import { NextResponse } from "next/server";
import { getAutoBackupConfig, setAutoBackupConfig, getAutoBackupStatus } from "@/lib/db/repos/autoBackupRepo.js";
import { configureTelegramBackup, sendTelegramBackupNow } from "@/shared/services/telegramBackup";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { AUTO_BACKUP_CONFIG } from "@/shared/constants/config";

export const dynamic = "force-dynamic";

function publicConfig(config) {
  // Secrets are write-only for the dashboard: they are never echoed back.
  return {
  enabled: config.enabled === true,
  channel: config.channel === "github" ? "github" : "telegram",
  intervalHours: config.intervalHours,
  tgChatId: config.tgChatId || "",
  ghRepo: config.ghRepo || "",
  hasTgToken: Boolean(config.tgBotToken),
  hasGhToken: Boolean(config.ghToken),
  };
}

function clampIntervalHours(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return AUTO_BACKUP_CONFIG.minIntervalHours;
  return Math.max(AUTO_BACKUP_CONFIG.minIntervalHours, n);
}

export async function GET() {
  try {
  const config = await getAutoBackupConfig();
  const status = await getAutoBackupStatus();
  return NextResponse.json({ config: publicConfig(config), status });
  } catch (error) {
  console.log("Error loading auto-backup config:", error);
  return NextResponse.json({ error: "Failed to load auto-backup config" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
  const body = await request.json();
  const patch = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.channel === "telegram" || body.channel === "github") patch.channel = body.channel;
  if (body.intervalHours !== undefined) patch.intervalHours = clampIntervalHours(body.intervalHours);
  if (typeof body.tgChatId === "string") {
  const digits = body.tgChatId.replace(/\D+/g, ""); // Telegram owner ids are numeric
  if (!digits) {
  return NextResponse.json({ error: "Owner chat id must be the numeric Telegram id" }, { status: 400 });
  }
  patch.tgChatId = digits;
  }
  if (typeof body.ghRepo === "string") patch.ghRepo = body.ghRepo.trim();
  // Empty secrets mean "keep the stored ones" so partial saves never wipe them.
  if (typeof body.tgBotToken === "string" && body.tgBotToken.trim()) patch.tgBotToken = body.tgBotToken.trim();
  if (typeof body.ghToken === "string" && body.ghToken.trim()) patch.ghToken = body.ghToken.trim();

  const config = await setAutoBackupConfig(patch);
  await configureTelegramBackup();
  return NextResponse.json({ config: publicConfig(config) });
  } catch (error) {
  console.log("Error saving auto-backup config:", error);
  return NextResponse.json({ error: error?.message || "Failed to save auto-backup config" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
  const { action, password } = await request.json();
  if (action !== "test") {
  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  if (!(await verifyDashboardPassword(password))) {
  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const { sizeBytes, channel } = await sendTelegramBackupNow();
  return NextResponse.json({ ok: true, sizeBytes, channel });
  } catch (error) {
  console.log("[Settings][AutoBackup] test send failed:", error);
  return NextResponse.json({ ok: false, error: error?.message || "Failed to send test backup" }, { status: 200 });
  }
}
