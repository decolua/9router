# Claude Identity Compatibility — 三次提交说明

## 1. `0700099` — Transparent Anthropic Proxy

- 增加 Claude Code 到 Anthropic-compatible 网关的透明代理路径。
- 保留请求与 SSE 响应的端到端传输，仅替换路由模型和上游认证。

## 2. `ab91786` — Claude Identity Manager

- 增加进程内 Claude Identity 捕获、查询、清除与注入基础能力。
- Anthropic-compatible 节点可通过 `injectClaudeIdentity` 复用 Claude Code 身份头。

## 3. 本次提交 — Safety-first Identity Compatibility

- 可信来源校验后才刷新身份；按 provider node 命名空间隔离。
- 按 Never / Sensitive / Client Preferred / Identity / Observe 分类，只重放允许的身份头。
- API Key、Authorization、Cookie 和代理头不保存原值、不参与重放；Debug 仅输出脱敏摘要且仅限本地访问。
- 加入字段级刷新、降级捕获保护、stale 标记与 TTL（默认 24h / 6h）。
- Anthropic-compatible 非透明请求默认协商未压缩响应，避免压缩 JSON 被误判为 502；日志显示 `content-encoding`。
- 补充 Identity 安全、隔离、stale、TTL 与降级捕获回归测试。
