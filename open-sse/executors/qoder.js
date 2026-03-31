import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * QoderExecutor - Executor for Qoder API with HMAC-SHA256 signature
 * Requires 3 custom headers to avoid 406 error: session-id, x-qoder-timestamp, x-qoder-signature
 */
export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  /**
   * Create Qoder signature using HMAC-SHA256
   * Formula: HMAC-SHA256(key=apiKey, message="UserAgent:sessionID:timestamp")
   */
  createSignature(userAgent, sessionID, timestamp, apiKey) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Build headers with Qoder-specific signature
   */
  buildHeaders(credentials, stream = true) {
    const sessionID = `session-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    const userAgent = this.config.headers["User-Agent"] || "Qoder-Cli";
    const apiKey = credentials.apiKey || credentials.accessToken || "";

    const signature = this.createSignature(userAgent, sessionID, timestamp, apiKey);

    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "session-id": sessionID,
      "x-qoder-timestamp": timestamp.toString(),
      "x-qoder-signature": signature,
    };

    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return this.config.baseUrl;
  }

  /**
   * Inject stream_options for usage data on streaming requests
   */
  transformRequest(model, body, stream, credentials) {
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default QoderExecutor;
