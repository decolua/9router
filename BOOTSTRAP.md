# BOOTSTRAP.md - 9Router Session Initialization Protocol

Quy trình khởi động bắt buộc cho mọi session làm việc với 9Router.

---

## 1. Mục tiêu

Đảm bảo:

- Không mất context khi làm việc với 9Router.
- Hiểu rõ kiến trúc proxy & RTK trước khi code.
- Không phá vỡ backward compatibility.
- Không push/merge khi chưa được Sếp cho phép.

---

## 2. Startup Sequence (BẮT BUỘC)

Mỗi session phải thực hiện:

1. Đọc `SOUL.md` — bản sắc & nguyên tắc agent 9router
2. Đọc `IDENTITY.md` — định danh & vai trò
3. Đọc `AGENTS.md` — workspace protocol
4. Đọc `README.md` — tổng quan dự án
5. Đọc memory:
   - `memory/YYYY-MM-DD.md` (hôm nay)
   - `memory/YYYY-MM-DD.md` (hôm qua)
6. Nếu là MAIN SESSION:
   - Đọc `MEMORY.md` (root workspace)

Chỉ sau khi hoàn tất mới được xử lý task.

---

## 3. Context Validation

Trước khi hành động:

- Task đã rõ chưa?
- Có ảnh hưởng RTK token saver không? → Ưu tiên cao nhất
- Có ảnh hưởng proxy routing không? → Test fallback
- Có thay đổi config/providers không? → Kiểm tra compatibility
- Có cần update docs không?

Nếu chưa rõ → hỏi Sếp.

---

## 4. Execution Guard

Không được:

- Bỏ qua boot sequence.
- Tự ý push lên main.
- Tự ý tạo PR.
- Sửa PR cũ.
- Phá backward compatibility.
- Commit secrets/API keys.

---

## 5. Documentation Trigger

Phải tạo/cập nhật tài liệu khi:

- Thêm provider mới.
- Thay đổi RTK compression logic.
- Sửa fallback routing.
- Thay đổi dashboard UI đáng kể.
- Fix bug ảnh hưởng proxy/token savings.

File: `docs/UPDATE-YYYY-MM-DD.md`

---

## 6. Failure Handling

Nếu xảy ra lỗi:

1. Dừng ngay.
2. Phân tích nguyên nhân.
3. Không patch trực tiếp main.
4. Tạo branch mới để fix.
5. Báo cáo Sếp rõ ràng.

---

BOOTSTRAP.md là lớp bảo vệ cho dự án 9Router.
Không được bỏ qua.
