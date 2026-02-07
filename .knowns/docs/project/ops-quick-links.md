---
title: Ops Quick Links
createdAt: '2026-02-06T08:48:30.542Z'
updatedAt: '2026-02-06T08:52:31.292Z'
description: Single-page index for 9router operational documentation
tags:
  - ops
  - index
  - onboarding
  - knowns
---
# 9router Ops Quick Links

## Mục tiêu
Trang home cho team vận hành với 2 nhánh rõ ràng:
1) Onboarding path
2) Incident response path

## Onboarding path (đọc tuần tự)
### Bước 1 - Nắm bức tranh tổng thể
- @doc/project/project-overview
  - Hiểu mục tiêu sản phẩm, kiến trúc, luồng request và auth/storage.

### Bước 2 - Nắm API surface
- @doc/project/api-map
  - Xác định endpoint theo domain (v1, auth, providers, usage, sync...).

### Bước 3 - Nắm mô hình dữ liệu
- @doc/project/data-model-map
  - Hiểu schema LowDB, key fields và quan hệ entity.

### Bước 4 - Nắm state machine vận hành
- @doc/project/state-machine-map
  - Hiểu trạng thái account, cooldown/backoff, refresh và fallback.

### Bước 5 - Nắm checklist deploy
- @doc/project/sre-smoke-checklist
- @doc/project/sre-smoke-checklist-vi
  - Chọn bản EN hoặc VI tùy đối tượng vận hành.

### Bước 6 - Nắm runbook sự cố
- @doc/project/incident-playbook
  - Triage nhanh và mitigation theo scenario.

## Incident response path (vào thẳng khi có sự cố)
### 0-2 phút: khoanh vùng nhanh
- @doc/project/incident-playbook
  - Dùng phần triage để phân loại sự cố.

### 2-5 phút: xác nhận health + blast radius
- @doc/project/sre-smoke-checklist
- @doc/project/sre-smoke-checklist-vi
  - Chạy probe trọng yếu để biết mức độ ảnh hưởng.

### 5-10 phút: đào sâu theo loại lỗi
- Lỗi routing/fallback/account state:
  - @doc/project/state-machine-map
- Lỗi endpoint/hành vi API:
  - @doc/project/api-map
- Lỗi lệch dữ liệu/schema:
  - @doc/project/data-model-map

### 10+ phút: ổn định và hậu kiểm
- Cập nhật/tinh chỉnh scenario trong @doc/project/incident-playbook
- Cập nhật checklist trong @doc/project/sre-smoke-checklist hoặc @doc/project/sre-smoke-checklist-vi nếu cần

## Quick links theo nhu cầu
- Debug 5xx/chat nhanh:
  - @doc/project/incident-playbook
  - @doc/project/state-machine-map
- Verify trước/sau deploy:
  - @doc/project/sre-smoke-checklist
  - @doc/project/sre-smoke-checklist-vi
- Tra endpoint:
  - @doc/project/api-map
- Tra schema/quan hệ dữ liệu:
  - @doc/project/data-model-map
- Onboard thành viên mới:
  - @doc/project/project-overview

## Gợi ý bảo trì

- Thêm endpoint mới -> cập nhật @doc/project/api-map trước
- Đổi schema/localDb -> cập nhật @doc/project/data-model-map
- Đổi fallback/refresh logic -> cập nhật @doc/project/state-machine-map
- Có incident mới -> bổ sung scenario vào @doc/project/incident-playbook
- Đổi quy trình deploy -> cập nhật @doc/project/sre-smoke-checklist (+ bản VI nếu cần)
## Related work
- Task ID: rfdg1h
- Task ID: 6y6m3j
