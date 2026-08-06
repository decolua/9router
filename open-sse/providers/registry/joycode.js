import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "joycode",
  priority: 122,
  alias: "joycode",
  uiAlias: "joycode",
  display: {
    name: "JD JoyCode",
    icon: "code",
    color: "#FF6B35",
    textIcon: "JC",
    website: "https://joycode.jd.com",
    notice: {
      apiKeyUrl: "https://joycode.jd.com/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.joycode.jd.com/v1/chat/completions",
    validateUrl: "https://api.joycode.jd.com/v1/models",
  },
  models: [
    { id: "joycode-v1", name: "JoyCode V1" },
    { id: "joycode-v1-code", name: "JoyCode V1 Code" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};