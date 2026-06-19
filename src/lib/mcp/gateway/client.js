// Client dispatcher — picks the right transport implementation for an instance.
// Server-layer code calls clientFor(i).listTools(i) / .callTool(i, name, args)
// without branching on transport.

import * as httpClient from "./httpClient.js";
import * as stdioClient from "./stdioClient.js";

function clientFor(instance) {
  const t = (instance?.transport || "").toLowerCase();
  if (t === "http" || t === "sse") return httpClient;
  if (t === "stdio") return stdioClient;
  throw new Error(`unknown transport: ${instance?.transport} for ${instance?.slug || "?"}`);
}

export { clientFor, httpClient, stdioClient };
export { McpAuthError } from "./httpClient.js";
