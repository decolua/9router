---
title: SRE Smoke Checklist VI
createdAt: '2026-02-06T08:44:46.115Z'
updatedAt: '2026-02-06T08:46:42.309Z'
description: Bản tiếng Việt ngắn gọn cho checklist kiểm tra nhanh trước/sau deploy
tags:
  - sre
  - ops
  - runbook
  - checklist
  - vi
---
# 9router SRE Smoke Checklist (VI)

## Mục tiêu
Checklist nhanh trước và sau deploy để phát hiện sớm lỗi ảnh hưởng lớn.

## Cách dùng
- Chạy checklist pre-deploy trên staging/canary trước khi promote.
- Chạy checklist post-deploy ngay sau khi lên production.
- Dừng rollout nếu bất kỳ cổng P0/P1 bị fail.

## Biến môi trường dùng chung
- `BASE_URL` (ví dụ: `http://localhost:3000` hoặc domain production)
- `API_KEY` (key hợp lệ từ `/api/keys`)
- `MODEL` (model ổn định đã biết, ví dụ `cc/claude-sonnet-4-5-20250929`)

## Pre-deploy (bắt buộc pass)
### 1) Reachability dịch vụ
- Probe: `GET $BASE_URL/api/v1/models`
- Pass:
  - HTTP 200
  - JSON có mảng `data`
- Mức độ: P0 (block deploy)

### 2) Kiểm tra auth dashboard
- Probe: `POST $BASE_URL/api/auth/login` với credential vận hành.
- Pass:
  - HTTP 200
  - có cookie `auth_token`
- Mức độ: P1 (block nếu release có scope dashboard/auth)

### 3) Kiểm tra inventory provider
- Probe: `GET $BASE_URL/api/providers`
- Pass:
  - Có ít nhất 1 account hoạt động cho provider quan trọng
  - Không bị tắt hàng loạt (`isActive=false`)
- Mức độ: P0 nếu không còn provider trọng yếu

### 4) Kiểm tra đường request với API key
- Probe: `GET $BASE_URL/api/v1/models` với header `Authorization: Bearer $API_KEY`
- Pass:
  - HTTP 200
  - Trả danh sách model đúng kỳ vọng
- Mức độ: P0

### 5) Chat probe tối thiểu (non-stream)
- Probe: `POST $BASE_URL/v1/chat/completions` payload nhỏ (`stream=false`, `max_tokens` thấp)
- Pass:
  - HTTP 200
  - Có `choices[0]`
- Mức độ: P0

### 6) Kiểm tra pipeline usage
- Probe: sau chat probe gọi `GET $BASE_URL/api/usage/history`
- Pass:
  - Số request tăng hoặc timestamp record mới được cập nhật
- Mức độ: P1

### 7) Cloud sync (nếu bật)
- Probe:
  - `GET $BASE_URL/api/settings`
  - nếu `cloudEnabled=true` thì gọi `POST $BASE_URL/api/sync/cloud` với `{"action":"sync"}`
- Pass:
  - Sync thành công, không có 5xx
- Mức độ: P1

## Post-deploy (10 phút đầu)
### 1) Re-run health probe
- Chạy lại:
  - `/api/v1/models`
  - 1 request `/v1/chat/completions`
- Pass:
  - Không regression so với pre-deploy

### 2) Quét nhanh error budget
- Probe: `GET $BASE_URL/api/usage/logs`
- Pass:
  - Không có spike lỗi `FAILED 4xx/5xx` kéo dài trên provider/model trọng yếu

### 3) Quét trạng thái account
- Probe: `GET $BASE_URL/api/providers`
- Pass:
  - Không rơi hàng loạt vào `unavailable/error`
  - Không bị cooldown đồng thời trên toàn bộ account trọng yếu (`rateLimitedUntil`)

### 4) Xác nhận routing strategy
- Probe: `GET $BASE_URL/api/settings`
- Pass:
  - `fallbackStrategy` và `stickyRoundRobinLimit` đúng cấu hình rollout

### 5) Xác nhận alias/combo trọng yếu
- Probe:
  - `GET $BASE_URL/api/models/alias`
  - `GET $BASE_URL/api/combos`
  - 1 smoke request cho mỗi alias/combo quan trọng
- Pass:
  - Alias resolve đúng provider/model
  - Combo fallback hoạt động đúng

## Lệnh curl mẫu (copy-paste)
### Get models
```bash
curl -sS "$BASE_URL/api/v1/models"
```

### Login check
```bash
curl -i -sS -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d {password:<PASSWORD>}
```

### Provider list
```bash
curl -sS "$BASE_URL/api/providers"
```

### Minimal chat
```bash
curl -sS -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"stream\":false,\"max_tokens\":32}"
```

### Usage quick read
```bash
curl -sS "$BASE_URL/api/usage/history"
```

### Cloud sync (nếu bật)

```bash
curl -sS -X POST "$BASE_URL/api/sync/cloud" 
  -H "Content-Type: application/json" 
  -d '{"action":"sync"}'
```
## Trigger rollback
Rollback ngay nếu kéo dài >3 phút sau deploy:
- Cổng P0 fail (`/api/v1/models` down hoặc chat probe fail liên tục)
- Không còn account khỏe cho provider trọng yếu
- Login/auth dashboard hỏng (khi release có liên quan auth/UI)
- Cloud sync gây ghi đè trạng thái/credential lặp lại

## Trigger escalation
Escalate sang debug code-level khi:
- Lỗi lặp lại sau 1 lần restart sạch + 1 lần re-test provider
- Vòng lặp 401/403 vẫn còn sau re-auth
- Alias/combo routing lệch so với cấu hình

## Tài liệu liên quan
- @doc/project/sre-smoke-checklist
- @doc/project/incident-playbook
- @doc/project/state-machine-map
- @doc/project/api-map
- Task ID: 4bm4rh
