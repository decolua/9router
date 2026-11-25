import { QWENWORK_CONFIG } from "../constants/oauth.js";
import { createQoderProvider } from "./qoder.js";

// QwenWork (千问办公, gateway.qwenwork.cn) — same Qoder device flow as
// qoder/qoder-cn with two deltas, both handled in QoderService via the
// oauth config block:
//   1. The device-code URL carries client_id + redirect_uri (QWENWORK_CONFIG).
//   2. UserInfo comes from the account-context envelope
//      ({ data: { user: { ... } } }) — userInfoEnvelope: "accountContext".
// The device token itself is the chat token (no jobToken exchange), and
// refresh uses deviceToken/refresh, so no provider-level overrides needed.
// siteId: "qwenwork" rides along in QWENWORK_CONFIG for mapTokens so
// executors/usage can pick the Qoder-family site config.
export default createQoderProvider(QWENWORK_CONFIG);
