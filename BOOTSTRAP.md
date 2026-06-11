# BOOTSTRAP.md - Giao thức Khởi tạo Session 9Router

> **Quan trọng:** File này được aiagent OpenClaw và các agent khác đọc khi khởi tạo session.
> Chi tiết boot sequence đầy đủ xem `AGENTS.md`. File này bổ sung các quy tắc vận hành riêng cho 9Router.

---

## 1. Boot Sequence

Xem `AGENTS.md` §1 — **Bắt buộc** đọc SOUL.md → IDENTITY.md → USER.md → AGENTS.md → memory trước khi xử lý tác vụ.

---

## 2. Danh sách kiểm tra Xác thực Ngữ cảnh

**Trước khi hành động, tự hỏi:**

| Câu hỏi | Mức ưu tiên |
|---------|---------|
| Tác vụ đã rõ phạm vi chưa? | — |
| Có ảnh hưởng đến nén RTK compression? | **Cao nhất** — sai = mất token |
| Có ảnh hưởng đến proxy routing/fallback? | Kiểm tra fallback trước khi merge |
| Có thay đổi config/providers? | Kiểm tra tương thích ngược |
| Cần tạo tài liệu (`docs/UPDATE-*.md`)? | Nếu có thay đổi đáng kể |

**Chưa rõ ràng → hỏi Sếp, tuyệt đối không đoán.**

---

## 3. Biên giới Thực thi

**TUYỆT ĐỐI KHÔNG được thực hiện:**

- Bỏ qua boot sequence.
- Push hoặc merge trực tiếp lên nhánh main.
- Tạo PR lên `decolua/9router` (upstream) — chỉ trên fork `diepxuan/9router`.
- Chỉnh sửa PR cũ (tạo nhánh mới cho mọi thay đổi).
- Phá tương thích ngược.
- Commit secrets/API keys.

**Chi tiết kỷ luật Git:** Xem `AGENTS.md` §3.

---

## 4. Trigger Tạo Tài liệu

**Tạo hoặc cập nhật tài liệu khi:**

- Thêm nhà cung cấp (provider) mới.
- Thay đổi logic nén RTK compression.
- Sửa fallback routing.
- Thay đổi dashboard UI đáng kể.
- Sửa lỗi ảnh hưởng đến proxy/token savings.

| Loại | File |
|------|------|
| Changelog | `CHANGELOG.md` |
| Cập nhật chi tiết | `docs/UPDATE-YYYY-MM-DD.md` |

---

## 5. Xử lý Sự cố

1. **Dừng ngay** — không tiếp tục hành động.
2. **Phân tích nguyên nhân gốc** (root cause analysis).
3. **Không vá trực tiếp trên main** — tạo nhánh sửa mới.
4. **Báo cáo Sếp** — kèm phân tích và hướng xử lý.

---

## 6. Các Agent khác

Khi các agent khác đọc BOOTSTRAP.md này, chúng cần:

1. Đọc đầy đủ nội dung.
2. Tuân thủ boot sequence trong `AGENTS.md`.
3. Không thực hiện các hành động bị cấm trong §3.

---

*BOOTSTRAP.md bổ sung cho AGENTS.md với các quy tắc vận hành cụ thể của 9Router.*