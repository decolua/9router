import crypto from "node:crypto";
import net from "node:net";
import { detectClientTool } from "open-sse/utils/clientDetector.js";
import { getPrivateMachineId } from "@/shared/utils/machineId";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,64}$/;

export function normalizeClientId(value) {
  if (typeof value !== "string") return null;
  const clientId = value.trim();
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : null;
}

export function maskClientNetwork(value) {
  if (!value || net.isIP(value) === 0) return "Unknown";
  if (value === "127.0.0.1" || value === "::1") return "Local";
  if (net.isIP(value) === 4) {
    const parts = value.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  const prefix = value.split(":").filter(Boolean).slice(0, 3).join(":");
  return `${prefix || "ipv6"}::*`;
}

function getClientFamily(headers, body) {
  const detected = detectClientTool(headers, body);
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
  const ip = headers["x-9r-real-ip"] || "";
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
    ipSource: headers["x-9r-ip-source"] || "unknown",
  };
}
