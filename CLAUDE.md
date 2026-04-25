# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root app (Next.js dashboard + API)
- Install: `npm install`
- Dev (port 20128): `npm run dev`
- Build: `npm run build`
- Start prod: `npm run start`
- Bun variants: `npm run dev:bun`, `npm run build:bun`, `npm run start:bun`

Common local run env (from README):
- `PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev`

### Cloud worker (`cloud/`)
- Install: `cd cloud && npm install`
- Dev: `npm run dev`
- Deploy: `npm run deploy`

Typical setup uses Wrangler KV + D1 migration:
- `wrangler login`
- `wrangler kv namespace create KV`
- `wrangler d1 create proxy-db`
- `wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql`

### Tests (`tests/`, Vitest)
- Install: `cd tests && npm install`
- All tests: `npm test`
- Watch: `npm run test:watch`
- Single file:
  - `NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/embeddingsCore.test.js --reporter=verbose --config ./vitest.config.js`

## Big-picture architecture

8Router is a local-first AI router exposing an OpenAI-compatible endpoint (`/v1`) plus a web dashboard.

Request flow:
1. Client tools call `http://localhost:20128/v1`.
2. Router normalizes/translates payloads and applies combo/fallback routing.
3. Provider auth/token refresh and account selection are handled per integration.
4. Compatible response/stream is returned; usage/quota is tracked.

Main parts:
- **Root Next.js app**: dashboard UI + server routes (including `/v1`).
- **Routing/translation layer**: OpenAI-style interface to provider-specific behavior.
- **Persistence**: file-based local state (LowDB JSON) for providers/combos/settings/keys; separate usage/log storage.
- **`cloud/` worker**: Cloudflare Worker path for cloud deployment/sync scenarios.
- **`tests/` project**: embeddings-focused Vitest suite (`/v1/embeddings` core + cloud handler behavior).

## Important repo notes

- Default dashboard: `http://localhost:20128/dashboard`
- Default API base: `http://localhost:20128/v1`
- Docs indicate preferring server-side `BASE_URL` and `CLOUD_URL` for cloud runtime behavior.
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` currently present.

## UI typography conventions (dashboard/usage)

- Page title: `text-2xl font-semibold tracking-tight`; page description: `text-sm text-muted-foreground`.
- Card title: `text-sm font-medium`; card description: default `CardDescription` tone (muted), không tăng lên `text-base`.
- Dense data rows (Recent Activity, table secondary text): ưu tiên `text-xs text-muted-foreground`; primary row label giữ `text-sm font-medium`.
- Numeric metrics/KPI value: `text-2xl font-bold tabular-nums`; inline numeric metadata dùng `text-xs tabular-nums`.
- Interactive controls (period/mode buttons): `h-7 text-xs` để đồng bộ mật độ với card header.
- Tránh duplicate hierarchy trong cùng card header: chỉ 1 cụm title/description và 1 cụm control chính.

## UI baseline conventions (dashboard/endpoint as canonical reference)

Dùng `/dashboard/endpoint` làm mẫu thị giác chuẩn khi restyle các trang dashboard khác.

- Hierarchy chuẩn:
  - Page header: eyebrow nhỏ `text-xs text-muted-foreground` + title `text-2xl font-semibold tracking-tight` + description `text-sm text-muted-foreground`.
  - Primary utility card đặt sớm (URL/CTA chính) trước các nhóm thông tin phụ.
- Card system:
  - Card title giữ `text-sm font-medium`; mô tả card giữ `text-xs text-muted-foreground`.
  - Spacing ưu tiên `gap-6`, nội bộ card `p-4` hoặc `p-6`, tránh trộn quá nhiều nhịp dọc.
- Read-only values (URL/status blocks):
  - Render như info block (`div`/`code` style), không giả input editable nếu không cho nhập.
  - Dùng `font-mono text-xs tabular-nums` cho URL/token/value kỹ thuật.
- Status & action:
  - Label trạng thái dùng từ ngắn gọn `Default/Active/Offline`, tránh ALL CAPS ở nội dung chính.
  - Nút thao tác chính cỡ `h-8` hoặc `h-9`, chữ `text-xs`; có trạng thái pending/disabled khi gọi API.
- Tone:
  - Ưu tiên clean enterprise, giảm italic/uppercase/letter-spacing quá mạnh ở vùng nội dung chính.
  - Dùng semantic tokens (`background`, `muted`, `border`, `primary`), tránh hard-coded màu.
- UX consistency:
  - Loading skeleton phản ánh đúng layout thật.
  - Empty state luôn có CTA rõ ràng.
  - Khi action backend có thể trả trạng thái trung gian (ví dụ needsLogin), UI phải phản hồi rõ ràng, không im lặng.
