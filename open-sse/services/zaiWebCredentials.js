// Service boundary for Z.ai web credential parsing.
//
// `extractZaiToken` / `extractZaiCaptchaVerifyParam` live in
// `open-sse/executors/zai-web.js` alongside the transport they were written
// for. App routes (`src/**`) must not import from the executor tree directly,
// so they go through this service instead — same pattern as OmniRoute's
// `zaiWebCredentials.ts` (audited PR #10329).
export { extractZaiToken, extractZaiCaptchaVerifyParam } from "../executors/zai-web.js";
