export default {
  id: "codebuddy",
  hidden: true,
  priority: 90,
  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://copilot.tencent.com",
    notice: {
      signupUrl: "https://copilot.tencent.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://copilot.tencent.com/v1/chat/completions",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    baseUrl: "https://copilot.tencent.com",
    stateUrl: "https://copilot.tencent.com/v2/plugin/auth/state",
    tokenUrl: "https://copilot.tencent.com/v2/plugin/auth/token",
    refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.63.2 CodeBuddy/2.63.2",
    platform: "CLI",
    pollInterval: 5000,
  },
};
