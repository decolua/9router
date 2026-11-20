// Kiro IDE identity sent on every Kiro / Amazon Q call. Kiro's client-version gate
// (since 2026-11-09; the floor rises to IDE 0.12.291 on 2027-01-15) rejects older
// identities such as `kiro-ide/1.0.0` with "This version of Kiro is no longer
// supported" (#5613). Current stable IDE release per the official update metadata
// (published 2026-11-10):
// https://prod.download.desktop.kiro.dev/stable/metadata-linux-x64-stable.json
export const KIRO_IDE_VERSION = "1.4.154";
export const KIRO_SDK_VERSION = "1.0.0";
export const KIRO_AGENT_OS = "windows";
export const KIRO_AGENT_OS_VERSION = "10.0.26200";
export const KIRO_NODE_VERSION = "22.21.1";

// The IDE uses a different AWS SDK client per API: the streaming client for
// generateAssistantResponse, the runtime client for ListAvailableModels,
// ListAvailableProfiles and GetUsageLimits. Each one names itself in the User-Agent.
export const KIRO_SDK_CLIENTS = {
  streaming: { api: "codewhispererstreaming", metrics: "E" },
  runtime: { api: "codewhispererruntime", metrics: "N,E" },
};
