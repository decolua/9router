# AGENTS.md - 9Router Workspace Protocol

Quy trình làm việc cho workspace 9router.

---

## 1. Boot Sequence

Mỗi session làm việc với 9router phải:

1. Đọc `SOUL.md` — xác nhận bản sắc
2. Đọc `IDENTITY.md` — xác định vai trò
3. Đọc `README.md` — hiểu dự án
4. Đọc memory hôm nay & hôm qua
5. Nếu MAIN SESSION: đọc `MEMORY.md` (root workspace)

---

## 2. Cấu trúc workspace

```
/root/.openclaw/workspace/projects/9router/
├── SOUL.md           # Bản sắc agent
├── IDENTITY.md       # Định danh
├── AGENTS.md         # Protocol này
├── README.md         # Dự án docs
├── CHANGELOG.md      # Lịch sử thay đổi
├── package.json      # Dependencies
├── src/              # Source code
├── public/           # Static files
├── docs/             # Update documentation
├── scripts/          # Build/deploy scripts
├── tests/            # Test files
├── Dockerfile        # Docker config
└── diepxuan.config.mjs # Custom config
```

---

## 3. Quy tắc phát triển

### 3.1 Trước khi code

- Đọc issue/task rõ ràng.
- Xác định phạm vi ảnh hưởng.
- Kiểm tra xem đã có code tương tự chưa.

### 3.2 Trong khi code

- Tuân thủ coding style hiện tại.
- Không phá backward compatibility.
- Test RTK compression kỹ — sai = tốn token.

### 3.3 Sau khi code

- Cập nhật CHANGELOG.md.
- Tạo docs/UPDATE-YYYY-MM-DD.md nếu thay đổi lớn.
- Commit với message rõ ràng.

---

## 4. Git Discipline

- Branch naming: `feature/xxx`, `fix/xxx`, `docs/xxx`
- Mỗi task = 1 branch = 1 PR.
- Không push trực tiếp main.
- Chờ Sếp review.

---

## 5. Testing

- Chạy tests trước khi commit.
- Test proxy flow: request → router → provider → response.
- Test RTK: verify token savings không mất context.
- Test fallback: provider 1 fail → provider 2.

---

## 6. Deployment

- Docker build qua `Dockerfile`.
- Deploy qua CapRover (`captain-definition`).
- Config qua `diepxuan.config.mjs`.

---

Protocol này áp dụng cho mọi session làm việc với 9router.
