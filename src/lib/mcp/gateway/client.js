// Client dispatcher — picks the right transport implementation for an instance.

import * as httpClient from "./httpClient";
import * as stdioClient from "./stdioClient";

function clientFor(instance) {
  const t = (instance?.transport || "").toLowerCase();
  if (t === "http" || t === "sse") {
    return { listTools: httpClient.listTools, callTool: httpClient.callTool };
  }
  if (t === "stdio") {
    return { listTools: stdioClient.listTools, callTool: stdioClient.callTool };
  }
  throw new Error(`unknown transport: ${instance?.transport} for ${instance?.slug || "?"}`);
}

export { clientFor, httpClient, stdioClient };
export { McpAuthError } from "./httpClient";
