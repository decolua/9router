import { createHash } from "crypto";

const KIRO_RUNTIME_SDK_VERSION = "1.0.0";
const KIRO_AGENT_OS = "windows";
const KIRO_AGENT_OS_VERSION = "10.0.26200";
const KIRO_NODE_VERSION = "22.21.1";
const KIRO_VERSION = "0.10.32";

export function buildKiroClientFingerprintHeaders(credentials = {}) {
  const profile = credentials.providerSpecificData || {};
  const seed = profile.clientId
    || credentials.refreshToken
    || profile.profileArn
    || credentials.apiKey
    || credentials.accessToken
    || "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");
  const identity = `KiroIDE-${KIRO_VERSION}-${machineId}`;

  return {
    "User-Agent":
      `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ua/2.1 ` +
      `os/${KIRO_AGENT_OS}#${KIRO_AGENT_OS_VERSION} ` +
      `lang/js md/nodejs#${KIRO_NODE_VERSION} ` +
      `api/codewhispererruntime#${KIRO_RUNTIME_SDK_VERSION} m/N,E ${identity}`,
    "x-amz-user-agent": `aws-sdk-js/${KIRO_RUNTIME_SDK_VERSION} ${identity}`,
    "x-amzn-kiro-agent-mode": "vibe",
    "x-amzn-codewhisperer-optout": "true",
  };
}
