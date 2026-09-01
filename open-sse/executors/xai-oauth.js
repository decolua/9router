import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";

export class XaiOAuthExecutor
  extends DefaultExecutor
{
  constructor() {
    super("xai-oauth");
  }

  buildUrl(
    model,
    stream,
    urlIndex = 0,
    credentials = null
  ) {
    const config =
      PROVIDERS["xai-oauth"] ||
      this.config ||
      {};

    const meta =
      Array.isArray(config.models)
        ? config.models.find(
            (entry) =>
              entry?.id === model
          )
        : null;

    if (
      meta?.targetFormat ===
        "openai-responses" &&
      config.responsesBaseUrl
    ) {
      return config.responsesBaseUrl;
    }

    return (
      config.baseUrl ||
      config.transport?.baseUrl ||
      super.buildUrl(
        model,
        stream,
        urlIndex,
        credentials
      )
    );
  }
}

export default XaiOAuthExecutor;
