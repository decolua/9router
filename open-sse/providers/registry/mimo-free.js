// Xiaomi ended the free MiMo channel ("MiMo free API service has ended").
// Kept visible as a configurable card so the user can choose whether it shows
// on the usage topology canvas; by default it is hidden there (service ended),
// and it carries a deprecation notice. Override the default via the
// topologyVisibility setting toggle on the providers page.
export default {
  id: "mimo-free",
  hidden: false,
  priority: 50,
  hasFree: true,
  alias: "mmf",
  uiAlias: "mmf",
  display: {
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
    deprecationNotice:
      "MiMo free API service has ended. This provider is no longer free. It is hidden from the usage topology by default — enable it via the toggle if you still want it shown.",
  },
  topologyHiddenByDefault: true,
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto" },
  ],
  modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  passthroughModels: true,
};
