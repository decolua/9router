import type { IncomingMessage, ServerResponse } from "http";

/**
 * Cursor MITM handler — coming soon
 * This feature is currently under development.
 */
export async function intercept(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(501, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: {
      message: "Cursor MITM support is coming soon.",
      type: "not_implemented"
    }
  }));
}
