import crypto from "node:crypto";
import net from "node:net";
import { getPrivateMachineId } from "@/shared/utils/machineId";
import { getTrustedRequestOrigin, isLoopbackAddress } from "@/lib/requestOrigin";
import clientIp from "../../client-ip.js";

const { normalizeIp } = clientIp;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,64}$/;

export function normalizeClientId(value) {
  if (typeof value !== "string") return null;
  const clientId = value.trim();
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : null;
}

export function maskClientNetwork(value) {
  const ip = normalizeIp(value);
  if (!ip) return "Unknown";
  if (isLoopbackAddress(ip)) return "Local";
  if (net.isIP(ip) === 4) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  const [left = "", right = ""] = ip.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const parts = ip.includes("::")
    ? [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill("0"), ...rightParts]
    : leftParts;
  return `${parts.slice(0, 3).join(":")}::*`;
}

function getClientFamily(headers, body) {
  const ua = String(headers["user-agent"] || "").toLowerCase();
  const xApp = String(headers["x-app"] || "").toLowerCase();
  const intent = String(headers["openai-intent"] || "").toLowerCase();
  const initiator = String(headers["x-initiator"] || "").toLowerCase();
  let detected = null;
  if (body.userAgent === "antigravity") detected = "antigravity";
  else if (ua.includes("githubcopilotchat") || intent === "conversation-panel" || initiator === "user") detected = "github-copilot";
  else if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") detected = "claude";
  else if (ua.includes("gemini-cli")) detected = "gemini-cli";
  else if (ua.includes("codex-cli") || ua.includes("codex_cli_rs") || ua.includes("codex_exec")) detected = "codex";
  else if (ua.includes("deepseek-tui")) detected = "deepseek-tui";
  if (detected) return detected;
  const product = String(headers["user-agent"] || "")
    .trim()
    .split(/\s+/, 1)[0]
    .split("/", 1)[0]
    .replace(/[^A-Za-z0-9._/+:-]/g, "")
    .slice(0, 64);
  return product || "unknown";
}

export async function getApiKeyClientIdentity(request, body = {}) {
  const headers = Object.fromEntries(request.headers.entries());
  const clientId = normalizeClientId(headers["x-9router-client-id"]);
  const origin = getTrustedRequestOrigin(request);
  const ip = origin?.ip || "";
  if (!clientId && net.isIP(ip) === 0) return null;

  const clientFamily = getClientFamily(headers, body);
  const material = clientId
    ? `client-id\0${clientId}`
    : `network\0${ip}\0client\0${clientFamily}`;
  const secret = await getPrivateMachineId("api-key-client-fingerprint");
  const fingerprint = crypto
    .createHmac("sha256", secret)
    .update(material)
    .digest("hex")
    .slice(0, 32);

  return {
    fingerprint,
    clientLabel: clientId || clientFamily,
    clientFamily,
    maskedNetwork: maskClientNetwork(ip),
    ipSource: origin?.source || "unknown",
  };
}
