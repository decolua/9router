import { QODER_CN_CONFIG } from "../constants/oauth.js";
import { createQoderProvider } from "./qoder.js";

// Qoder CN (qoder.com.cn) — same device flow as intl Qoder, CN endpoints.
export default createQoderProvider(QODER_CN_CONFIG);
