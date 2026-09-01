import gitlab from "./gitlab.js";

const models = [
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6 (GitLab Duo)"
  },
  {
    "id": "claude-haiku-4-5",
    "name": "Claude Haiku 4.5 (GitLab Duo)"
  }
];

export default {
  ...gitlab,
  id: "gitlab-duo",
  alias: "gld",
  uiAlias: "gld",
  hidden: false,

  display: {
    ...(gitlab.display || {}),
    name: "GitLab Duo",
    textIcon: "GL",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,

  transport: {
    ...(gitlab.transport || {}),
    baseUrl: "https://gitlab.com/api/v4/code_suggestions/completions",
  },

  models,
  serviceKinds: ["llm"],
  passthroughModels: false,
};
