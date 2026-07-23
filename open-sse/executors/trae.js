import { DefaultExecutor } from "./default.js";

// Trae executor — inject x-cloudide-token (raw access token) + Authorization Bearer.
// Mirrors trae_account.rs request_trae_json header set.
export default class TraeExecutor extends DefaultExecutor {
  constructor() {
    super("trae");
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    const token = credentials?.accessToken;
    if (token) {
      // Raw token (no Bearer prefix) on x-cloudide-token — matches official client.
      headers["x-cloudide-token"] = token;
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  // TODO verify: if Chat is JSON-RPC shaped, override transformRequest here.
}
