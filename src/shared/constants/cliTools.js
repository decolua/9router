// CLI Tools configuration
export const CLI_TOOLS = {
  claude: {
    id: "claude",
    name: "cliTools.tools.claude.name",
    icon: "terminal",
    color: "#D97757",
    description: "cliTools.tools.claude.description",
    configType: "env",
    envVars: {
      baseUrl: "ANTHROPIC_BASE_URL",
      model: "ANTHROPIC_MODEL",
      opusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      sonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
      haikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    },
    modelAliases: ["default", "sonnet", "opus", "haiku", "opusplan"],
    settingsFile: "~/.claude/settings.json",
    defaultModels: [
      { id: "opus", name: "cliTools.tools.claude.models.opus", alias: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", defaultValue: "cc/claude-opus-4-5-20251101" },
      { id: "sonnet", name: "cliTools.tools.claude.models.sonnet", alias: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-4-5-20250929" },
      { id: "haiku", name: "cliTools.tools.claude.models.haiku", alias: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", defaultValue: "cc/claude-haiku-4-5-20251001" },
    ],
  },
  codex: {
    id: "codex",
    name: "cliTools.tools.codex.name",
    image: "/providers/codex.png",
    color: "#10A37F",
    description: "cliTools.tools.codex.description",
    configType: "custom",
  },
  droid: {
    id: "droid",
    name: "Factory Droid",
    image: "/providers/droid.png",
    color: "#00D4FF",
    description: "Factory Droid AI Assistant",
    configType: "custom",
  },
  openclaw: {
    id: "openclaw",
    name: "Open Claw",
    image: "/providers/openclaw.png",
    color: "#FF6B35",
    description: "Open Claw AI Assistant",
    configType: "custom",
  },
  cursor: {
    id: "cursor",
    name: "cliTools.tools.cursor.name",
    image: "/providers/cursor.png",
    color: "#000000",
    description: "cliTools.tools.cursor.description",
    configType: "guide",
    requiresCloud: true,
    notes: [
      { type: "warning", textKey: "cliTools.tools.cursor.notes.requiresPro" },
      { type: "cloudCheck", textKey: "cliTools.tools.cursor.notes.cloudOnly" },
    ],
    guideSteps: [
      { step: 1, titleKey: "cliTools.tools.cursor.steps.openSettings.title", descKey: "cliTools.tools.cursor.steps.openSettings.desc" },
      { step: 2, titleKey: "cliTools.tools.cursor.steps.enableOpenAI.title", descKey: "cliTools.tools.cursor.steps.enableOpenAI.desc" },
      { step: 3, titleKey: "cliTools.tools.cursor.steps.baseUrl.title", value: "{{baseUrl}}", copyable: true },
      { step: 4, titleKey: "cliTools.tools.cursor.steps.apiKey.title", type: "apiKeySelector" },
      { step: 5, titleKey: "cliTools.tools.cursor.steps.addCustomModel.title", descKey: "cliTools.tools.cursor.steps.addCustomModel.desc" },
      { step: 6, titleKey: "cliTools.tools.cursor.steps.selectModel.title", type: "modelSelector" },
    ],
  },
  cline: {
    id: "cline",
    name: "cliTools.tools.cline.name",
    image: "/providers/cline.png",
    color: "#00D1B2",
    description: "cliTools.tools.cline.description",
    configType: "guide",
    guideSteps: [
      { step: 1, titleKey: "cliTools.tools.cline.steps.openSettings.title", descKey: "cliTools.tools.cline.steps.openSettings.desc" },
      { step: 2, titleKey: "cliTools.tools.cline.steps.selectProvider.title", descKey: "cliTools.tools.cline.steps.selectProvider.desc" },
      { step: 3, titleKey: "cliTools.tools.cline.steps.baseUrl.title", value: "{{baseUrl}}", copyable: true },
      { step: 4, titleKey: "cliTools.tools.cline.steps.apiKey.title", type: "apiKeySelector" },
      { step: 5, titleKey: "cliTools.tools.cline.steps.selectModel.title", type: "modelSelector" },
    ],
  },
  roo: {
    id: "roo",
    name: "cliTools.tools.roo.name",
    image: "/providers/roo.png",
    color: "#FF6B6B",
    description: "cliTools.tools.roo.description",
    configType: "guide",
    guideSteps: [
      { step: 1, titleKey: "cliTools.tools.roo.steps.openSettings.title", descKey: "cliTools.tools.roo.steps.openSettings.desc" },
      { step: 2, titleKey: "cliTools.tools.roo.steps.selectProvider.title", descKey: "cliTools.tools.roo.steps.selectProvider.desc" },
      { step: 3, titleKey: "cliTools.tools.roo.steps.baseUrl.title", value: "{{baseUrl}}", copyable: true },
      { step: 4, titleKey: "cliTools.tools.roo.steps.apiKey.title", type: "apiKeySelector" },
      { step: 5, titleKey: "cliTools.tools.roo.steps.selectModel.title", type: "modelSelector" },
    ],
  },
  continue: {
    id: "continue",
    name: "cliTools.tools.continue.name",
    image: "/providers/continue.png",
    color: "#7C3AED",
    description: "cliTools.tools.continue.description",
    configType: "guide",
    guideSteps: [
      { step: 1, titleKey: "cliTools.tools.continue.steps.openConfig.title", descKey: "cliTools.tools.continue.steps.openConfig.desc" },
      { step: 2, titleKey: "cliTools.tools.continue.steps.apiKey.title", type: "apiKeySelector" },
      { step: 3, titleKey: "cliTools.tools.continue.steps.selectModel.title", type: "modelSelector" },
      { step: 4, titleKey: "cliTools.tools.continue.steps.addModelConfig.title", descKey: "cliTools.tools.continue.steps.addModelConfig.desc" },
    ],
    codeBlock: {
      language: "json",
      code: `{
  "apiBase": "{{baseUrl}}",
  "title": "{{model}}",
  "model": "{{model}}",
  "provider": "openai",
  "apiKey": "{{apiKey}}"
}`,
    },
  },
  // HIDDEN: gemini-cli
  // "gemini-cli": {
  //   id: "gemini-cli",
  //   name: "Gemini CLI",
  //   icon: "terminal",
  //   color: "#4285F4",
  //   description: "Google Gemini CLI",
  //   configType: "env",
  //   envVars: {
  //     baseUrl: "GEMINI_API_BASE_URL",
  //     model: "GEMINI_MODEL",
  //   },
  //   defaultModels: [
  //     { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", alias: "pro" },
  //     { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", alias: "flash" },
  //   ],
  // },
};

// Get all provider models for mapping dropdown
export const getProviderModelsForMapping = (providers) => {
  const result = [];
  providers.forEach(conn => {
    if (conn.isActive && (conn.testStatus === "active" || conn.testStatus === "success")) {
      result.push({
        connectionId: conn.id,
        provider: conn.provider,
        name: conn.name,
        models: conn.models || [],
      });
    }
  });
  return result;
};

