// Windsurf provider registry — Firebase+Codeium+Devin auth chain.
// Chat = Codeium gRPC-web protobuf:
//   POST {base}  Content-Type: application/grpc-web+proto
//   Service: exa.language_server_pb.LanguageServerService / GetChatMessage
export default {
  id: "windsurf",
  alias: "ws",
  uiAlias: "ws",
  display: {
    name: "Windsurf",
    icon: "surfing",
    color: "#14B8A6",
    website: "https://windsurf.com",
    notice: { signupUrl: "https://windsurf.com" },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth", "apikey"],

  transport: {
    baseUrl: "https://server.codeium.com/exa.language_server_pb.LanguageServerService/GetChatMessage",
    format: "openai",
    headers: {
      "Content-Type": "application/grpc-web+proto",
      "Accept": "application/grpc-web+proto",
      "X-Grpc-Web": "1",
    },
    // apiKey (sk-ws-... or Firebase-derived) as Bearer + in protobuf Metadata.api_key.
    auth: { combined: true, header: "Authorization", scheme: "Bearer" },
  },

  // Auth chain (4 terminal paths, all yield apiKey):
  //  1) OAuth web → Firebase JWT → POST register.windsurf.com/.../RegisterUser {firebase_id_token} → {apiKey, apiServerUrl, name}
  //  2) sk-ws-... direct API key (apiKey used as metadata.apiKey on GetUserStatus)
  //  3) Firebase JWT (eyJ...) → same RegisterUser exchange as #1
  //  4) Devin auth1_... → self-serve chain → ide_token used as apiKey on server.self-serve.windsurf.com
  oauth: {
    clientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
    firebaseApiKey: "AIzaSyDsOl-1XpT5err0Tcn0TFFod1H8gVGIycY",
    firebaseSignInUrl: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
    registerUrl: "https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser",
    apiServerUrl: "https://server.codeium.com",
    auth1ApiServerUrl: "https://server.self-serve.windsurf.com",
    platform: "windsurf",
    // Quota (Connect RPC, protobuf): POST windsurf.com/_backend/.../GetPlanStatus,
    // headers Content-Type:application/proto + Connect-Protocol-Version:1 + X-Auth-Token:<session>,
    // body = field1:session_token, field2:varint 1.
    quotaUrl: "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/GetPlanStatus",
  },

  // Catalog verified against model_configs_v2.bin from Devin CLI (2026.5.x).
  // Dot-notation ids; the executor MODEL_ALIAS_MAP maps these to Windsurf modelUid.
  // contextLength dropped — 9router schema uses id+name only.
  models: [
    // Cognition / SWE
    { id: "swe-1.6-fast", name: "SWE-1.6 Fast" },
    { id: "swe-1.6", name: "SWE-1.6" },
    { id: "swe-1.5-fast", name: "SWE-1.5 Fast" },
    { id: "swe-1.5", name: "SWE-1.5" },
    // Claude Opus 4.7 — effort-tiered
    { id: "claude-opus-4.7-max", name: "Claude Opus 4.7 Max" },
    { id: "claude-opus-4.7-xhigh", name: "Claude Opus 4.7 XHigh" },
    { id: "claude-opus-4.7-high", name: "Claude Opus 4.7 High" },
    { id: "claude-opus-4.7-medium", name: "Claude Opus 4.7 Medium" },
    { id: "claude-opus-4.7-low", name: "Claude Opus 4.7 Low" },
    { id: "claude-opus-4.7-review", name: "Claude Opus 4.7 Review" },
    // Claude Sonnet/Opus 4.6
    { id: "claude-sonnet-4.6-thinking-1m", name: "Claude Sonnet 4.6 Thinking 1M" },
    { id: "claude-sonnet-4.6-1m", name: "Claude Sonnet 4.6 1M" },
    { id: "claude-sonnet-4.6-thinking", name: "Claude Sonnet 4.6 Thinking" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4.6-thinking", name: "Claude Opus 4.6 Thinking" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    // Claude 4.5
    { id: "claude-opus-4.5-thinking", name: "Claude Opus 4.5 Thinking" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.5-thinking", name: "Claude Sonnet 4.5 Thinking" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    // GPT-5.5 — effort-tiered
    { id: "gpt-5.5-xhigh-fast", name: "GPT-5.5 XHigh Fast" },
    { id: "gpt-5.5-xhigh", name: "GPT-5.5 XHigh" },
    { id: "gpt-5.5-high-fast", name: "GPT-5.5 High Fast" },
    { id: "gpt-5.5-high", name: "GPT-5.5 High" },
    { id: "gpt-5.5-medium-fast", name: "GPT-5.5 Medium Fast" },
    { id: "gpt-5.5-medium", name: "GPT-5.5 Medium" },
    { id: "gpt-5.5-low-fast", name: "GPT-5.5 Low Fast" },
    { id: "gpt-5.5-low", name: "GPT-5.5 Low" },
    { id: "gpt-5.5-none-fast", name: "GPT-5.5 None Fast" },
    { id: "gpt-5.5-none", name: "GPT-5.5 None" },
    // GPT-5.4 — effort-tiered
    { id: "gpt-5.4-xhigh-fast", name: "GPT-5.4 XHigh Fast" },
    { id: "gpt-5.4-xhigh", name: "GPT-5.4 XHigh" },
    { id: "gpt-5.4-high-fast", name: "GPT-5.4 High Fast" },
    { id: "gpt-5.4-high", name: "GPT-5.4 High" },
    { id: "gpt-5.4-medium-fast", name: "GPT-5.4 Medium Fast" },
    { id: "gpt-5.4-medium", name: "GPT-5.4 Medium" },
    { id: "gpt-5.4-low-fast", name: "GPT-5.4 Low Fast" },
    { id: "gpt-5.4-low", name: "GPT-5.4 Low" },
    { id: "gpt-5.4-none-fast", name: "GPT-5.4 None Fast" },
    { id: "gpt-5.4-none", name: "GPT-5.4 None" },
    { id: "gpt-5.4-mini-xhigh", name: "GPT-5.4 Mini XHigh" },
    { id: "gpt-5.4-mini-high", name: "GPT-5.4 Mini High" },
    { id: "gpt-5.4-mini-medium", name: "GPT-5.4 Mini Medium" },
    { id: "gpt-5.4-mini-low", name: "GPT-5.4 Mini Low" },
    // GPT-5.3 Codex
    { id: "gpt-5.3-codex-xhigh-fast", name: "GPT-5.3 Codex XHigh Fast" },
    { id: "gpt-5.3-codex-xhigh", name: "GPT-5.3 Codex XHigh" },
    { id: "gpt-5.3-codex-high-fast", name: "GPT-5.3 Codex High Fast" },
    { id: "gpt-5.3-codex-high", name: "GPT-5.3 Codex High" },
    { id: "gpt-5.3-codex-medium-fast", name: "GPT-5.3 Codex Medium Fast" },
    { id: "gpt-5.3-codex-medium", name: "GPT-5.3 Codex Medium" },
    { id: "gpt-5.3-codex-low-fast", name: "GPT-5.3 Codex Low Fast" },
    { id: "gpt-5.3-codex-low", name: "GPT-5.3 Codex Low" },
    // GPT-5.2 / 5
    { id: "gpt-5.2-xhigh", name: "GPT-5.2 XHigh" },
    { id: "gpt-5.2-high", name: "GPT-5.2 High" },
    { id: "gpt-5.2-medium", name: "GPT-5.2 Medium" },
    { id: "gpt-5.2-low", name: "GPT-5.2 Low" },
    { id: "gpt-5.2-none", name: "GPT-5.2 None" },
    { id: "gpt-5", name: "GPT-5" },
    // GPT-4.1 / 4o
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    // Gemini
    { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro High" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro Low" },
    { id: "gemini-3.0-flash-high", name: "Gemini 3 Flash High" },
    { id: "gemini-3.0-flash-medium", name: "Gemini 3 Flash Medium" },
    { id: "gemini-3.0-flash-low", name: "Gemini 3 Flash Low" },
    { id: "gemini-3.0-flash-minimal", name: "Gemini 3 Flash Minimal" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    // Others
    { id: "deepseek-v4", name: "DeepSeek V4" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5.1", name: "GLM-5.1" },
  ],
};
