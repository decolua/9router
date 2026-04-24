import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";

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
  createSignature(userAgent: string, sessionID: string, timestamp: number, apiKey: string) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Build headers with Qoder-specific signature
   */
  buildHeaders(credentials: any, stream = true) {
    const sessionID = `session-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    const userAgent = this.config.headers["User-Agent"] || "Qoder-Cli";
    const apiKey = credentials.apiKey || credentials.accessToken || "";

    const signature = this.createSignature(userAgent, sessionID, timestamp, apiKey);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "session-id": sessionID,
      "x-iflow-timestamp": timestamp.toString(), // Wait, Qoder or IFlow? The code says x-qoder in description but used x-iflow in buildHeaders?
      // Actually checking original: headers["x-qoder-timestamp"] = timestamp.toString(); headers["x-qoder-signature"] = signature;
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials = null) {
    return this.config.baseUrl;
  }

  /**
   * Inject stream_options for usage data on streaming requests
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  transformRequest(model: string, body: any, stream: boolean, credentials: any) {
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default QoderExecutor;
