# Custom JSON APIs

Connect a JSON business endpoint without requiring it to implement OpenAI or Anthropic protocols.

## Dashboard setup

1. Open **Providers → Add Custom JSON API**.
2. Enter a name, a model prefix (for example `custom`), and the **complete endpoint URL**, such as `https://example.com/api/chat`. 9Router does not append `/chat/completions`, `/responses` or `/models`.
3. Choose **POST**, **PUT** or **PATCH** and configure authentication: Bearer token, an API key in a named header, or none. Store the secret key in a connection, rather than in the template or custom headers.
4. The request template defaults to `model` and `messages`; no additional fields are required:

   ```json
   {
     "model": "{{model}}",
     "messages": "{{messages}}"
   }
   ```

   Use **添加字段 (Add field)** to include optional fields such as `project_id`. Choose a text/placeholder value or a JSON value (number, boolean, array or object). Remove a field to stop sending it. An untouched empty row is ignored.

   The default response path is `choices[0].message.content`. For a business response `{"data":{"answer":"Example reply"}}`, change it to `data.answer`.

   **完整 JSON（高级） (Full JSON)** remains available for endpoints requiring a different schema. Existing nonstandard templates open in this mode and are preserved without automatically adding fields.
5. Optionally use **Send Test Request**. This sends a real request, using `ping` as the latest user text. Creating a provider or saving its connection does not invoke the endpoint.
6. Create the provider, add a connection and set its default model, such as `custom-model`. Add that model under **Available Models** to expose it to model pickers. Clients can then request `custom/custom-model` through the usual 9Router chat endpoints.

Editing the provider updates the endpoint and template on all its existing connections. Switching back to Chat Completions or Responses removes the business template from those connections.

## Request templates

Templates are JSON objects. They support static JSON values and placeholders inside string values; they do not execute code or substitute object keys.

| Placeholder | Value |
| --- | --- |
| `{{prompt}}` | Text from the latest user message; text parts are joined with newlines |
| `{{messages}}` | Chat history in the OpenAI message format used internally by the router |
| `{{model}}` | The selected upstream model ID, without the provider prefix |
| `{{stream}}` | `false`, because the business endpoint returns JSON |
| `{{request.field}}` | A field on the translated request, including additional fields supplied by an OpenAI Chat Completions client |

A whole placeholder preserves its JSON type. `"history": "{{messages}}"` produces an array, rather than a JSON-encoded string. Embedded placeholders such as `"Explain {{prompt}}"` produce strings, with normal JSON escaping. Quotes, newlines and Unicode do not require special escaping beyond valid JSON.

Missing variables are errors. Fields on `request` refer to the request **after protocol translation**; fields that an upstream protocol translator does not preserve are unavailable. Use static values or `prompt` for fields that must work with every client protocol.

## Responses and limitations

Response paths support dot notation and numeric array indexes, for example `answer`, `data.answer` or `results[0].text`. Use `$` for the entire JSON response. Strings are returned directly; objects, arrays, numbers and booleans are serialized as JSON text. Missing or null response fields, and invalid JSON, produce HTTP 502.

The reply is normalized to OpenAI Chat Completions internally, then converted to the requesting client's protocol. Both non-streaming and streaming clients work. When a client omits `stream`, custom JSON nodes return a single JSON response; downstream SSE requires an explicit `stream: true` (native streaming client formats keep their existing behavior). For streaming clients the router waits for the entire business response, then emits the reply and completion events; this is not token-by-token upstream streaming. Native SSE business endpoints, tool-call mappings and usage-field mappings are outside this feature.

The executor forwards upstream error statuses. It does not automatically replay failed business operations through transport retries, another connection or a fallback combo model. Separate client requests and explicit multi-model fusion still invoke their configured endpoints independently.

## Provider configuration API

`POST /api/provider-nodes` accepts the existing compatible node type with `apiType: "custom-json"`:

```json
{
  "type": "openai-compatible",
  "apiType": "custom-json",
  "name": "Custom API",
  "prefix": "custom",
  "baseUrl": "https://example.com/api/chat",
  "customJson": {
    "method": "POST",
    "authType": "api-key",
    "authHeader": "X-API-Key",
    "headers": {},
    "requestTemplate": {
      "project_id": "demo-project",
      "question": "{{prompt}}"
    },
    "responsePath": "data.answer"
  }
}
```

The same configuration is accepted by `PUT /api/provider-nodes/:id`. Existing OpenAI and Anthropic compatible nodes remain unchanged. No database schema migration is required; custom JSON configuration is stored in the node's existing JSON data column and copied into each connection's `providerSpecificData`.
