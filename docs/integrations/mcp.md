# Local MCP integrations

9Router can expose selected local stdio MCP servers through an HTTP SSE bridge. This is intended for integrations running on the same machine as the gateway, such as Browser MCP.

## Available local plugin

The current preset allow-list contains one plugin:

| Plugin id | Name | Purpose |
|---|---|---|
| `browsermcp` | Browser MCP | Controls the user's running Chrome through the Browser MCP extension |

The allow-list is defined by `LOCAL_STDIO_PLUGINS` in `src/shared/constants/coworkPlugins.js`. The bridge does not accept an arbitrary executable, command, or argument supplied by an HTTP client.

## Security boundary

The MCP routes are protected by the dashboard middleware. `/api/mcp` is an authenticated API surface, and `/api/mcp/` is also local-only. A request must either carry the machine-bound `x-9r-cli-token` accepted by the dashboard guard, or be an authenticated request from a loopback client. Remote or tunnel requests are rejected by the local-only check.

Only preset stdio plugins may spawn. The bridge resolves the requested id against `LOCAL_STDIO_PLUGINS` before starting a child process; an unknown id returns 404, and user-defined commands are never spawned. This is the RCE-prevention boundary implemented in `src/lib/mcp/stdioSseBridge.js`.

Treat the plugin process as a local integration with access to the environment inherited by 9Router. The bridge starts the configured command on demand and terminates it when the last SSE session for that plugin disconnects.

## MCP SSE flow

1. Open an SSE connection:

   ```text
   GET /api/mcp/browsermcp/sse
   ```

2. For a known plugin, 9Router responds with `Content-Type: text/event-stream` and sends an `endpoint` event. Its data identifies the message URL and includes a generated session id:

   ```text
   event: endpoint
   data: /api/mcp/browsermcp/message?sessionId=<session-id>
   ```

3. Send each MCP JSON-RPC message to the endpoint from the event:

   ```text
   POST /api/mcp/browsermcp/message?sessionId=<session-id>
   Content-Type: application/json

   {"jsonrpc":"2.0","id":1,"method":"tools/list"}
   ```

4. The bridge writes the JSON-RPC message to the configured stdio process. Responses from the child are forwarded to active SSE sessions as `message` events.

The route currently does not validate the `sessionId` query parameter in the POST handler itself; the bridge routes messages to the plugin's running child. Clients should use the exact endpoint URL supplied by the SSE handshake and keep the SSE connection open while they use the bridge.

## HTTP behavior

### `GET /api/mcp/[plugin]/sse`

- Known preset: opens an SSE stream, registers a session, and emits the `endpoint` event described above.
- Unknown plugin: `404` with `Unknown plugin: <plugin>`.
- Response headers include `text/event-stream`, no-cache/no-transform caching, keep-alive, and `X-Accel-Buffering: no`.
- When the stream is cancelled, the session is unregistered.

### `POST /api/mcp/[plugin]/message`

- Known preset with valid JSON: sends the body to the configured child process and returns `202` with an empty response.
- Unknown plugin: `404` JSON response `{ "error": "Unknown plugin: <plugin>" }`.
- Invalid JSON or a bridge failure: `500` JSON response containing the error message.

The route implementations are `src/app/api/mcp/[plugin]/sse/route.js` and `src/app/api/mcp/[plugin]/message/route.js`. The child-process and SSE-session lifecycle is implemented in `src/lib/mcp/stdioSseBridge.js`.
