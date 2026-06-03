# BOOTSTRAP.md - 9Router Session Initialization Protocol

> **Ghi nhớ:** Boot sequence chi tiết xem `AGENTS.md` §1. File này bổ sung rules vận hành.

---

## 1. Boot Sequence

Xem `AGENTS.md` §1 — bắt buộc đọc SOUL.md → IDENTITY.md → USER.md → AGENTS.md → memory trước khi xử lý task.

---

## 2. Context Validation Checklist

Trước khi action, tự hỏi:

| Câu hỏi | Ưu tiên |
|---------|---------|
| Task đã rõ scope chưa? | — |
| Có ảnh hưởng RTK compression? | Cao nhất — sai = mất token |
| Có ảnh hưởng proxy routing/fallback? | Test fallback trước khi merge |
| Có thay đổi config/providers? | Kiểm tra backward compatibility |
| Cần update docs (`docs/UPDATE-*.md`)? | Nếu có thay đổi đáng kể |

Chưa rõ → hỏi Sếp, đừng đoán.

---

## 3. Execution Guard

Tuyệt đối không:
- Bỏ qua boot sequence
- Push/merge trực tiếp lên main
- Tạo PR lên `decolua/9router` (upstream) — chỉ trên fork `diepxuan/9router`
- Sửa PR cũ (tạo branch mới cho mọi thay đổi)
- Phá backward compatibility
- Commit secrets/API keys

Chi tiết git workflow: xem `AGENTS.md` §3.

---

## 4. Documentation Trigger

Tạo/cập nhật tài liệu khi:
- Thêm provider mới
- Thay đổi RTK compression logic
- Sửa fallback routing
- Thay đổi dashboard UI đáng kể
- Fix bug ảnh hưởng proxy/token savings

File: `docs/UPDATE-YYYY-MM-DD.md`
Changelog: `CHANGELOG.md`

---

## 5. Failure Handling

1. Dừng ngay
2. Phân tích root cause
3. Không patch trực tiếp main — tạo branch fix mới
4. Báo cáo Sếp

---

BOOTSTRAP.md + AGENTS.md = bộ rules vận hành 9Router. Không bỏ qua.
