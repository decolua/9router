import { DefaultExecutor } from "./default.js";
import zcodeConfig from "../../src/lib/zcode/config.js";
import { GLM_CODING_PLAN_MODEL_MAP } from "../../src/lib/zcode/constants.js";
import { injectZcodeSystemPrompt } from "../../src/lib/zcode/systemPrompt.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import {
  getCaptchaManager,
  getZcodeCaptchaPort,
  isCaptchaError,
} from "../../src/lib/zcode/captcha-service.js";
import {
  applyZcodeApiKeyHeaders,
  applyZcodeCodingPlanHeaders,
} from "../../src/lib/zcode/headers.js";

const MAX_CAPTCHA_RETRIES = 3;

export class GlmExecutor extends DefaultExecutor {
  constructor() {
    super("glm");
    this._glmUrlIndex = 0;
  }

  usesCodingPlan(credentials) {
    if (!credentials?.providerSpecificData?.useCodingPlan) return false;
    return !!(credentials.providerSpecificData?.zcodeJwtToken || credentials.accessToken);
  }

  usesApiKeyOnly(credentials) {
    return !!credentials?.apiKey && !this.usesCodingPlan(credentials);
  }

  usesZcodeApiKeyUpstream(credentials) {
    return (
      this.usesApiKeyOnly(credentials) ||
      (this.usesCodingPlan(credentials) && this._glmUrlIndex === 1)
    );
  }

  canFallbackToApiKey(credentials) {
    return this.usesCodingPlan(credentials) && !!credentials?.apiKey;
  }

  getFallbackCount() {
    if (!this._currentCredentials) return 1;
    return this.canFallbackToApiKey(this._currentCredentials) ? 2 : 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    this._glmUrlIndex = urlIndex;
    if (this.usesCodingPlan(credentials)) {
      if (urlIndex === 0) return zcodeConfig.codingPlanUrl;
      if (this.canFallbackToApiKey(credentials)) {
        return zcodeConfig.apiKeyFallbackUrl;
      }
    }
    if (this.usesApiKeyOnly(credentials)) {
      return zcodeConfig.apiKeyFallbackUrl;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    const modelId = transformed.model || model;
    if (typeof modelId !== "string") return transformed;

    const mapped =
      getModelUpstreamId("glm", modelId) ||
      GLM_CODING_PLAN_MODEL_MAP[modelId.toLowerCase()] ||
      modelId;

    if (mapped !== modelId) {
      transformed.model = mapped;
    }

    if (this.usesCodingPlan(credentials) && this._glmUrlIndex === 0) {
      return injectZcodeSystemPrompt(transformed, {
        modelRef: `builtin:zai-start-plan/${transformed.model || mapped}`,
      });
    }

    return transformed;
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    if (this.usesCodingPlan(credentials) && this._glmUrlIndex === 0) {
      applyZcodeCodingPlanHeaders(headers, credentials);
    } else if (this.usesZcodeApiKeyUpstream(credentials)) {
      applyZcodeApiKeyHeaders(headers, credentials);
    }

    return headers;
  }

  shouldRetry(status, urlIndex) {
    if (
      status === 401 &&
      urlIndex === 0 &&
      this.canFallbackToApiKey(this._currentCredentials)
    ) {
      return true;
    }
    return super.shouldRetry(status, urlIndex);
  }

  parseError(response, bodyText) {
    if (!bodyText) {
      return super.parseError(response, bodyText);
    }

    try {
      const json = JSON.parse(bodyText);
      const err = json?.error;
      const code = err?.code ?? json?.code;
      const message = err?.message ?? json?.msg ?? json?.message;

      if (code === "1113" || (typeof message === "string" && message.includes("1113"))) {
        return {
          status: response.status || 429,
          message:
            "GLM quota exhausted or no active resource package for this model. " +
            "Check ZCode Start/Coding Plan balance, try glm-5-turbo, or wait for daily reset.",
        };
      }

      if (code === "3010" || (typeof message === "string" && message.includes("concurrency limit"))) {
        return {
          status: response.status || 429,
          message:
            "Z.AI model admission concurrency limit exceeded. Close other ZCode/9router sessions and retry.",
        };
      }

      if (typeof message === "string" && message.length > 0) {
        return { status: response.status, message };
      }
    } catch {
      /* fall through */
    }

    return super.parseError(response, bodyText);
  }

  async execute(params) {
    const { credentials } = params;
    this._currentCredentials = credentials;

    const captchaManager = getCaptchaManager();
    const port = getZcodeCaptchaPort();

    for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
      let verifyParam;
      try {
        verifyParam = await captchaManager.getVerifyParam(port);
      } catch (err) {
        throw new Error(`Captcha verification failed: ${err.message}`);
      }

      const credsWithCaptcha = {
        ...credentials,
        providerSpecificData: {
          ...(credentials.providerSpecificData || {}),
          _captchaVerifyParam: verifyParam,
        },
      };

      const result = await super.execute({ ...params, credentials: credsWithCaptcha });

      if (result.response.status === 403 && (await isCaptchaError(result.response))) {
        captchaManager.invalidate();
        continue;
      }

      return result;
    }

    throw new Error("Captcha expired multiple times. Restart the service or check CloakBrowser.");
  }
}

export default GlmExecutor;