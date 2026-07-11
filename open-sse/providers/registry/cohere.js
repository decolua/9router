export default {
  id: "cohere",
  priority: 90,
  hasFree: true,
  alias: "cohere",
  display: {
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    notice: {
      apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.cohere.ai/v1/chat/completions",
    validateUrl: "https://api.cohere.ai/v1/models",
  },
  models: [
    { id: "command-r-plus-08-2024", name: "Command R+ (Aug 2024)" },
    { id: "command-r-08-2024", name: "Command R (Aug 2024)" },
    { id: "command-a-03-2025", name: "Command A (Mar 2025)" },
    { id: "command-a-plus-05-2026", name: "Command A+ (May 2026)" },
    { id: "command-a-reasoning-08-2025", name: "Command A Reasoning" },
    { id: "command-a-vision-07-2025", name: "Command A Vision" },
    { id: "command-r7b-12-2024", name: "Command R7B (Dec 2024)" },
    { id: "c4ai-aya-expanse-32b", name: "Aya Expanse 32B" },
    { id: "c4ai-aya-vision-32b", name: "Aya Vision 32B" },
  ],
};
