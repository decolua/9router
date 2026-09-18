"use client";

import { Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { cn } from "@/shared/utils/cn";

const BASE_URL = "http://localhost:20128";

const METHOD_VARIANT = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "warning",
  DELETE: "error",
};

const SECTIONS = [
  {
    id: "import",
    title: "Import Codex",
    description: "Import tài khoản Codex/ChatGPT (OAuth) vào 9Router.",
    endpoints: [
      {
        method: "POST",
        path: "/api/oauth/codex/import-auto",
        title: "Import nhiều account (bulk)",
        description:
          "Endpoint riêng, nhận kết quả cuối từ tool auto-login dạng { connections: [...] }. Tool lo phần login/exchange, 9Router chỉ nhận và push vào DB (dedupe theo email: trùng → replace token giữ priority). Trả về sqliteVerified để tool xác nhận đã ghi thành công.",
        request: `{
  "connections": [
    {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "rt-xxxxxxxx",
      "idToken": "eyJhbGciOi...",
      "expiresIn": 864000,
      "providerSpecificData": {
        "chatgptAccountId": "account_xxx",
        "chatgptPlanType": "free"
      }
    }
  ]
}`,
        curl: `curl -X POST ${BASE_URL}/api/oauth/codex/import-auto \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connections": [{
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "rt-xxxxxxxx",
      "idToken": "eyJhbGciOi...",
      "expiresIn": 864000,
      "providerSpecificData": {
        "chatgptAccountId": "account_xxx",
        "chatgptPlanType": "free"
      }
    }]
  }'`,
        response: `{ "inserted": 1, "replaced": 0, "failed": 0, "total": 1, "sqliteVerified": true, "verifiedEmails": ["you@example.com"], "errors": [] }`,
      },
      {
        method: "POST",
        path: "/api/oauth/codex/import-token",
        title: "Import 1 ChatGPT access token",
        description:
          "Import access token lấy từ chatgpt.com settings, bỏ qua refresh flow. Email/plan được decode từ JWT.",
        request: `{ "accessToken": "eyJhbGciOi...", "name": "My ChatGPT" }`,
        curl: `curl -X POST ${BASE_URL}/api/oauth/codex/import-token \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"accessToken": "eyJhbGciOi...", "name": "My ChatGPT"}'`,
        response: `{ "success": true, "connection": { "id": "...", "provider": "codex", "email": "you@example.com", "name": "My ChatGPT", "plan": "free" } }`,
      },
      {
        method: "POST",
        path: "/api/oauth/codex/bulk-import",
        title: "Import nhiều account (legacy)",
        description:
          "Định dạng cũ { accounts: [...] }. Vẫn được giữ để tương thích ngược với tool auto-login cũ.",
        request: `{
  "accounts": [
    { "accessToken": "eyJhbGciOi...", "idToken": "eyJhbGciOi..." },
    { "accessToken": "eyJhbGciOi..." }
  ]
}`,
        curl: `curl -X POST ${BASE_URL}/api/oauth/codex/bulk-import \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "accounts": [
      { "accessToken": "eyJhbGciOi...", "idToken": "eyJhbGciOi..." },
      { "accessToken": "eyJhbGciOi..." }
    ]
  }'`,
        response: `{ "success": 2, "failed": 0, "results": [{ "index": 0, "ok": true, "id": "..." }, ...] }`,
      },
    ],
  },
  {
    id: "completions",
    title: "Completions",
    description: "Endpoint OpenAI/Anthropic-compatible — thay BASE_URL của CLI/SDK trỏ về 9Router.",
    endpoints: [
      {
        method: "POST",
        path: "/v1/chat/completions",
        title: "Chat Completions (streaming)",
        description:
          "Định dạng OpenAI Chat Completions. Bỏ \"stream\": false để nhận JSON một lần. Model lấy từ GET /v1/models.",
        request: `{
  "model": "gpt-5.5",
  "messages": [{ "role": "user", "content": "Xin chào" }],
  "stream": true
}`,
        curl: `curl ${BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [{ "role": "user", "content": "Xin chào" }],
    "stream": true
  }'`,
      },
      {
        method: "POST",
        path: "/v1/responses",
        title: "Responses API (Codex CLI)",
        description:
          "Định dạng OpenAI Responses — dùng cho Codex CLI. Trả về SSE nếu stream: true.",
        request: `{
  "model": "gpt-5.6-sol",
  "input": "Viết hàm hello world bằng Python",
  "stream": true
}`,
        curl: `curl ${BASE_URL}/v1/responses \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.6-sol",
    "input": "Viết hàm hello world bằng Python",
    "stream": true
  }'`,
      },
      {
        method: "POST",
        path: "/v1/messages",
        title: "Messages API (Claude Code)",
        description:
          "Định dạng Anthropic Messages — dùng cho Claude Code CLI (ANTHROPIC_BASE_URL).",
        request: `{
  "model": "claude-opus-4-6",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "Xin chào" }]
}`,
        curl: `curl ${BASE_URL}/v1/messages \\
  -H "Authorization: Bearer $9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "Xin chào" }]
  }'`,
      },
      {
        method: "GET",
        path: "/v1/models",
        title: "Danh sách model",
        description: "Trả về tất cả model + combo ở định dạng OpenAI.",
        curl: `curl ${BASE_URL}/v1/models \\
  -H "Authorization: Bearer $9ROUTER_API_KEY"`,
      },
    ],
  },
];

function CodeBlock({ code, copy, copied, active }) {
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-lg bg-surface-2 border border-border-subtle p-3 text-xs font-mono leading-relaxed text-text-main whitespace-pre">
        {code}
      </pre>
      <button
        onClick={copy}
        className={cn(
          "absolute top-2 right-2 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors border",
          active
            ? "text-green-600 border-green-500/40 bg-green-500/10"
            : "text-text-muted border-border-subtle bg-surface hover:text-text-main"
        )}
      >
        {active ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

function EndpointCard({ endpoint }) {
  const { copied, copy } = useCopyToClipboard(2000);
  const curlId = `${endpoint.method} ${endpoint.path}`;

  return (
    <div className="rounded-[14px] bg-surface border border-border-subtle p-5">
      <div className="flex items-start gap-3 mb-2">
        <Badge variant={METHOD_VARIANT[endpoint.method] || "default"} size="sm" className="font-mono">
          {endpoint.method}
        </Badge>
        <div className="min-w-0 flex-1">
          <code className="text-[13px] font-mono text-text-main break-all">{endpoint.path}</code>
          <h3 className="text-sm font-semibold text-text-main mt-0.5">{endpoint.title}</h3>
        </div>
      </div>

      <p className="text-xs text-text-muted mb-3 leading-snug">{endpoint.description}</p>

      {endpoint.request && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Request body
          </p>
          <CodeBlock code={endpoint.request} copied={copied} active={copied === `${curlId}-body`} copy={() => copy(endpoint.request, `${curlId}-body`)} />
        </div>
      )}

      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">curl</p>
      <CodeBlock code={endpoint.curl} copied={copied} active={copied === curlId} copy={() => copy(endpoint.curl, curlId)} />

      {endpoint.response && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Response
          </p>
          <CodeBlock code={endpoint.response} copied={copied} active={copied === `${curlId}-res`} copy={() => copy(endpoint.response, `${curlId}-res`)} />
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-main">API Docs</h1>
        <p className="text-sm text-text-muted mt-1">
          Các API quan trọng: luồng import Codex và completions.
        </p>
      </div>

      <div className="rounded-[14px] bg-surface border border-border-subtle p-5 mb-6">
        <h2 className="text-sm font-semibold text-text-main mb-2">Auth & Base URL</h2>
        <ul className="text-xs text-text-muted space-y-1.5 leading-snug">
          <li>
            <span className="text-text-main">Base URL:</span>{" "}
            <code className="font-mono text-primary">{BASE_URL}</code>{" "}
            (đổi theo PORT nếu bạn đổi port runtime).
          </li>
          <li>
            <span className="text-text-main">API key:</span> lấy từ trang{" "}
            <code className="font-mono">/dashboard/endpoint</code>, gán vào{" "}
            <code className="font-mono">$9ROUTER_API_KEY</code> trong các lệnh curl bên dưới.
          </li>
          <li>
            Endpoint <code className="font-mono">/v1/*</code> dùng key qua header{" "}
            <code className="font-mono">Authorization: Bearer</code>; các endpoint quản trị{" "}
            <code className="font-mono">/api/oauth/*</code> chấp nhận cùng key (hoặc session
            cookie dashboard).
          </li>
        </ul>
      </div>

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section key={section.id}>
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-text-main">{section.title}</h2>
              <p className="text-xs text-text-muted mt-0.5">{section.description}</p>
            </div>
            <div className="space-y-4">
              {section.endpoints.map((endpoint) => (
                <EndpointCard key={`${endpoint.method} ${endpoint.path}`} endpoint={endpoint} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
