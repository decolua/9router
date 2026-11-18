import { DefaultExecutor } from "./default.js";
import { applyZcodeHeaders } from "../../src/lib/zcode/headers.js";
import { injectZcodeSystemPrompt } from "../../src/lib/zcode/systemPrompt.js";
import { getCaptchaManager, isCaptchaError } from "../../src/lib/zcode/captcha-service.js";

const CAPTCHA_RETRIES = 3;

function isZcodePlan(credentials) {
  return ["start-plan", "off-peak", "highspeed"].includes(credentials?.providerSpecificData?.plan);
}

export class GlmExecutor extends DefaultExecutor {
  constructor() {
    super("glm");
  }

  transformRequest(model, body, stream, credentials) {
    let transformed = super.transformRequest(model, body, stream, credentials);
    if (!isZcodePlan(credentials) || !transformed || typeof transformed !== "object") return transformed;
    transformed = { ...transformed, model: String(transformed.model || model).toUpperCase() };
    return injectZcodeSystemPrompt(transformed, transformed.model);
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    if (isZcodePlan(credentials)) {
      applyZcodeHeaders(headers, credentials, credentials.providerSpecificData?._captchaVerifyParam);
    }
    return headers;
  }

  async execute(params) {
    if (!isZcodePlan(params.credentials)) return super.execute(params);
    const captcha = getCaptchaManager();
    for (let attempt = 0; attempt < CAPTCHA_RETRIES; attempt++) {
      const verifyParam = attempt === 0 && captcha.cachedVerifyParam
        ? captcha.cachedVerifyParam
        : await captcha.getVerifyParam();
      const credentials = {
        ...params.credentials,
        providerSpecificData: { ...params.credentials.providerSpecificData, _captchaVerifyParam: verifyParam },
      };
      const result = await super.execute({ ...params, credentials });
      if (!(await isCaptchaError(result.response))) return result;
      captcha.invalidate();
    }
    throw new Error("ZCode captcha was rejected repeatedly; complete the visible verification and retry");
  }
}
