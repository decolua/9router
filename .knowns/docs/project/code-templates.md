---
title: Code Templates
createdAt: '2026-02-06T09:06:30.015Z'
updatedAt: '2026-02-06T09:06:53.429Z'
description: >-
  Reusable Knowns templates for 9router code scaffolding and workflow
  consistency
tags:
  - templates
  - dx
  - onboarding
---
# 9router Code Templates

## Mục tiêu
Chuẩn hóa scaffold code theo cấu trúc hiện tại để tái sử dụng nhanh và giảm lệch pattern giữa các lần triển khai.

## Danh sách template hiện có
- `next-api-route`
  - Sinh `src/app/api/<route>/route.js` cho case GET + POST đơn giản.
- `provider-crud`
  - Sinh cặp route CRUD:
    - `src/app/api/<resource>/route.js`
    - `src/app/api/<resource>/[id]/route.js`
- `dashboard-page`
  - Sinh `src/app/(dashboard)/dashboard/<page>/page.js` có fetch + loading + error.
- `knowns-doc`
  - Sinh helper service trong `src/sse/services/<module>.js`.

## Cách chạy template
### 1) Xem danh sách
```bash
knowns template list --plain
```

### 2) Xem chi tiết template
```bash
knowns template view <template-name> --plain
```

### 3) Chạy thử (không ghi file)
```bash
knowns template run <template-name> --dry-run
```

### 4) Chạy thật
```bash
knowns template run <template-name>
```

## Ví dụ sử dụng
### A) Tạo route GET/POST đơn giản
```bash
knowns template run next-api-route
```
Khi prompt, nhập ví dụ:
- `routeName`: `provider-limits`
- `entityName`: `provider limit`
- `responseKey`: `limits`
- `itemKey`: `limit`
- `listFn`: `getProviderLimits`
- `createFn`: `createProviderLimit`
- `requiredField`: `name`

### B) Tạo CRUD route đầy đủ
```bash
knowns template run provider-crud
```
Khi prompt, nhập ví dụ:
- `resourceName`: `provider-tags`
- `listFn`: `getProviderTags`
- `createFn`: `createProviderTag`
- `getByIdFn`: `getProviderTagById`
- `updateFn`: `updateProviderTag`
- `deleteFn`: `deleteProviderTag`
- `resourceLabel`: `Provider tag`

### C) Tạo dashboard page mới
```bash
knowns template run dashboard-page
```
Khi prompt, nhập ví dụ:
- `pageName`: `health-check`
- `endpointPath`: `/api/health-check`
- `responseKey`: `data`

### D) Tạo SSE service helper
```bash
knowns template run knowns-doc
```
Khi prompt, nhập ví dụ:
- `moduleName`: `provider-health`
- `exportFn`: `getProviderHealth`
- `dependencyPath`: `@/lib/localDb`
- `dependencyFn`: `getProviderConnections`

## Quy ước sử dụng
- Luôn `--dry-run` trước khi generate thật.
- Sau khi generate, review kỹ import path và tên function cho đúng module thực tế.
- Nếu template tạo file mới trùng path cũ, chỉ dùng `-f/--force` khi chắc chắn muốn ghi đè.

## Khi nào dùng template nào
- Muốn route API nhanh, ít logic: `next-api-route`.
- Muốn route CRUD chuẩn có `[id]`: `provider-crud`.
- Muốn page dashboard mới có skeleton/error: `dashboard-page`.
- Muốn helper logic trong tầng `src/sse/services`: `knowns-doc`.

## Bảo trì template
- Khi pattern route thay đổi trong `src/app/api/**`, cập nhật `next-api-route` và `provider-crud` trước.
- Khi pattern UI page thay đổi ở dashboard, cập nhật `dashboard-page`.
- Khi conventions tầng SSE đổi, cập nhật `knowns-doc`.

## Related docs
- @doc/project/project-overview
- @doc/project/api-map
- @doc/project/ops-quick-links
- Task ID: 2o5eb3
