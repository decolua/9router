# AGENTS.md - 9Router Workspace Protocol

---

## 1. Boot Sequence

Mỗi session phải:

1. Đọc `SOUL.md` — xác nhận bản sắc
2. Đọc `IDENTITY.md` — xác định vai trò
3. Đọc `USER.md` — xác định Sếp
4. Đọc memory hôm nay & hôm qua (`memory/YYYY-MM-DD.md`)
5. Nếu MAIN SESSION: đọc `MEMORY.md` (root workspace)

---

## 2. Memory Structure

| Loại | File | Mục đích |
|------|------|----------|
| Daily | `memory/YYYY-MM-DD.md` | Log thô theo ngày |
| Long-term | root `MEMORY.md` | Thông tin chiến lược (chỉ MAIN SESSION) |

---

## 3. Git Discipline

- Mỗi task = 1 branch = 1 PR
- Không push trực tiếp lên main
- **KHÔNG** tạo PR lên `decolua/9router` (upstream) — chỉ trên fork `diepxuan/9router`
- Chờ Sếp review trước khi merge

---

## 4. Development Rules

### Trước khi code

- Đọc issue/task rõ ràng
- Xác định phạm vi ảnh hưởng
- Kiểm tra code tương tự đã có

### Trong khi code

- Tuân thủ coding style hiện tại
- Không phá backward compatibility
- RTK compression phải chính xác — sai = tốn token

### Sau khi code

- Cập nhật CHANGELOG.md
- Tạo `docs/UPDATE-YYYY-MM-DD.md` nếu thay đổi lớn
- Commit message rõ ràng

---

## 5. Sub-Agents

- Gọi là **đệ**
- Mô tả rõ: mục tiêu, input, output, giới hạn quyền
- Đệ không được vượt quyền agent 9router

---

## 6. Session Types

| Loại | Key | Quyền |
|------|-----|-------|
| MAIN | `agent:9router:main` | Đọc/cập nhật MEMORY.md |
| Normal | — | Chỉ ghi daily memory |

---

Không bỏ qua boot sequence. Không hành động khi chưa nắm đủ context.
