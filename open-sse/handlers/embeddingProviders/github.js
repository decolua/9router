// GitHub Copilot embeddings — api.githubcopilot.com/embeddings with the short-lived Copilot token.
// The GitHub Models inference API (models.github.ai) was retired on 2026-07-30.
import createOpenAIEmbeddingAdapter from "./openai.js";
import { GITHUB_COPILOT } from "../../config/appConstants.js";

const baseAdapter = createOpenAIEmbeddingAdapter("github");

export default {
  ...baseAdapter,
  buildBody: (model, params) => baseAdapter.buildBody(model, {
    ...params,
    input: Array.isArray(params.input) ? params.input : [params.input],
  }),
  buildHeaders: (creds) => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${creds.copilotToken || creds.providerSpecificData?.copilotToken || creds.accessToken}`,
    "copilot-integration-id": "vscode-chat",
    "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    "user-agent": GITHUB_COPILOT.USER_AGENT,
    "x-github-api-version": GITHUB_COPILOT.API_VERSION,
  }),
};
