# TOOLS.md - 9Router Dev Quick Reference

> Tài liệu tham chiếu nhanh cho dev khi làm việc với fork `diepxuan/9router`.
> Quy trình làm việc đầy đủ xem `AGENTS.md`. Bộ nhớ chiến lược xem `MEMORY.md`.
> Checklist rebase upstream xem `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`.

---

## 1. Môi trường (Development)

- **Workspace:** `/root/.openclaw/workspace/projects/9router/`
- **Dashboard:** `http://9router.diepxuan.corp:3000/`
- **Cổng Proxy:** `3000` (chỉ định bởi Sếp, 2026-07-21)
- **Node:** v22.22.2

## 2. Thư mục chính (Key Directories)

| Path                | Mô tả                                             |
| ------------------- | ------------------------------------------------- |
| `src/`              | Source code                                       |
| `src/app/api/`      | API routes (proxy, providers)                     |
| `src/diepxuan/`     | Fork extension layer (custom feature của fork)    |
| `open-sse/`         | SSE engine (base + `open-sse/diepxuan/` cho fork) |
| `docs/`             | Tài liệu (UPDATE-_.md, CUSTOM-FEATURES-_.md)      |
| `scripts/diepxuan/` | Script kiểm tra custom feature sau rebase         |

## 3. Providers

- **Auth profile trong openclaw:** `9router`
- **Base URL:** `http://9router.diepxuan.corp:3000/v1`
- **Models:** openclaw-coder, openclaw-data, openclaw-free

## 4. Cơ sở dữ liệu (Database)

- SQLite: `better-sqlite3` (chính), `sql.js` (fallback)
- Runtime-generated, **không commit**
- `DATA_DIR` mặc định: `~/.9router`

## 5. Triển khai (Deployment)

- Docker + CapRover
- File cấu hình: `captain-definition`, `diepxuan.config.mjs`
- Đồng bộ runtime về host: `bash scripts/sync.sh`

## 6. Kiểm thử (Testing)

| Mục tiêu        | Cách kiểm                                         |
| --------------- | ------------------------------------------------- |
| RTK compression | Verify không mất context, nén chính xác tuyệt đối |
| Fallback        | Provider fail → next provider, không gián đoạn    |
| Quota           | Tracking chính xác, auto-refresh đúng timing      |
| Multi-account   | Round-robin phân phối đều                         |

## 7. Build & verify sau mỗi thay đổi

```bash
# 1. Kiểm tra custom feature còn nguyên (chạy nhanh, ~5s)
node scripts/diepxuan/check-custom-features.mjs

# 2. Production build (chạy ~3-5 phút, bắt lỗi import runtime)
npm run build

# Cả hai phải PASS trước khi push.
```

Script check manifest dựa trên `docs/custom-features.manifest.json` — 11 features, 314+ check, gồm:

- File tồn tại / pattern xuất hiện
- `node --check` syntax
- Phát hiện conflict marker còn sót sau rebase

## 8. Rebase upstream (master)

Mỗi lần upstream `decolua/9router` master có commit mới:

```bash
# 1. Fetch và rebase feature branch
git fetch upstream
git rebase upstream/master

# 2. Nếu có conflict, ưu tiên giữ base upstream, chỉ merge thủ công phần hook
#    (xem AGENTS.md §3 và CUSTOM-FEATURES-MERGE-CHECKLIST.md)

# 3. Sau rebase, chạy verify
node scripts/diepxuan/check-custom-features.mjs
npm run build
```

Nếu script báo FAIL, **dừng lại**, phân tích root cause, không push cho tới khi fix.

## 9. Smoke runtime (sau khi cần xác nhận sâu)

Chỉ chạy khi build PASS nhưng nghi ngờ hook runtime hỏng:

```bash
npm run start &                                     # Khởi động server
curl -sS http://9router.diepxuan.corp:3000/api/health
curl -sS http://9router.diepxuan.corp:3000/api/v1/models | jq .
```

Port chuẩn local: `3000`. Override bằng `PORT=<...>` nếu cần.

Smoke test theo feature: xem `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` mục 11.

## 10. Commit & Push

Theo `AGENTS.md` §3 + `.git-checklist.md`:

- Mỗi task = 1 branch = 1 PR. Tên branch: `task/<short-desc>` hoặc `fix/<short-desc>`.
- **Không** push trực tiếp lên `main` hoặc `master`.
- **Không** tạo PR lên `decolua/9router` (upstream) — chỉ lên fork `diepxuan/9router`.
- **Không** `git commit --amend` sau khi push — tạo commit mới.
- **Không** force push khi chưa hỏi Sếp.
- Sau khi Sếp merge PR: cleanup local branch đã lỗi thời.

Trước khi push:

```bash
git status --short --branch
git diff --cached
git log --oneline -5
```

## 11. Khi nào tạo tài liệu

Theo `AGENTS.md` §7, tạo hoặc cập nhật `docs/UPDATE-YYYY-MM-DD.md` khi:

- Thêm provider mới.
- Thay đổi logic nén RTK.
- Sửa fallback routing.
- Thay đổi dashboard UI đáng kể.
- Sửa lỗi ảnh hưởng đến proxy / token savings.

Đồng thời cập nhật `CHANGELOG.md` cho mọi thay đổi.

## 12. Tham chiếu (Reference)

| File                                      | Mục đích                                       |
| ----------------------------------------- | ---------------------------------------------- |
| `AGENTS.md`                               | Giao thức làm việc, boot sequence, kỷ luật Git |
| `MEMORY.md`                               | Bộ nhớ chiến lược dài hạn (chỉ MAIN SESSION)   |
| `AGENT_WORKSPACE.md`                      | Quick reference workspace                      |
| `SOUL.md`                                 | Bản sắc cốt lõi                                |
| `IDENTITY.md`                             | Con trỏ định danh + cấu hình                   |
| `USER.md`                                 | Hồ sơ Sếp                                      |
| `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` | Checklist rebase upstream, manifest script     |
| `CHANGELOG.md`                            | Lịch sử phiên bản                              |
| `DOCKER.md`                               | Hướng dẫn Docker                               |
| `README.md`                               | Giới thiệu dự án                               |
| `memory/YYYY-MM-DD.md`                    | Nhật ký hàng ngày                              |
