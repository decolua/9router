// OmniRoute phind provider — cookie-auth web provider. Uses the PhindExecutor
// (registered in open-sse/executors/index.js) which posts to Phind's /api/agent
// endpoint with a session cookie. The fork's DefaultExecutor.applyAuth path
// needs an explicit auth.combined header since the credential is a raw cookie
// (not a Bearer token), so transport.auth is configured with combined:true
// and the header name "Cookie".
const phind = {
  id: "phind",
  priority: 70,
  alias: "ph",
  display: {
    name: "Phind",
    icon: "code",
    color: "#0B0B0B",
    textIcon: "PH",
    website: "https://www.phind.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://www.phind.com/api/agent",
    validateUrl: "https://www.phind.com",
    auth: {
      combined: true,
      header: "Cookie",
      scheme: "",
    },
  },
  passthroughModels: true,
  models: [
    { id: "phind-model", name: "Phind Model (Auto)" },
    { id: "gpt-4o", name: "GPT-4o (via Phind)" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (via Phind)" },
  ],
};
export default phind;
