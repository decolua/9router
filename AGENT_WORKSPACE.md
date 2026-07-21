# AGENT_WORKSPACE.md - Không gian làm việc 9Router Agent

Không gian làm việc của Agent **9router** trong hệ thống OpenClaw.

---

## 1. Dự án: 9Router

AI Router & Token Saver — kết nối các công cụ lập trình CLI với hơn 40 nhà cung cấp AI.

| Thuộc tính            | Giá trị                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| **Kho lưu trữ**       | `git@github.com:diepxuan/9router.git`                                   |
| **Dashboard**         | `http://9router.diepxuan.corp:3000/`                                    |
| **Tập hợp công nghệ** | Next.js ^16.1.6, React 19, Express.js 5, SQLite, Zustand, TailwindCSS 4 |

---

## 2. Các File Định danh

| File           | Mô tả                                                  |
| -------------- | ------------------------------------------------------ |
| `SOUL.md`      | Bản sắc cốt lõi, phong cách, chuyên môn                |
| `IDENTITY.md`  | Con trỏ định danh + cấu hình                           |
| `AGENTS.md`    | Giao thức làm việc, boot sequence, kỷ luật Git         |
| `BOOTSTRAP.md` | Giao thức khởi tạo session (cho aiagent và agent khác) |
| `TOOLS.md`     | Dev quick reference (commands, paths, providers)       |
| `HEARTBEAT.md` | Điều khiển heartbeat task                              |
| `memory/`      | Thư mục nhật ký hàng ngày                              |
| `docs/`        | Tài liệu cập nhật (UPDATE-YYYY-MM-DD.md)               |

---

## 3. Tính năng chính

1. **RTK Token Saver** — Nén `tool_result`, tiết kiệm 20-40% tokens.
2. **Auto Fallback** — Subscription → Cheap → Free, không gián đoạn.
3. **Quota Tracking** — Theo dõi hạn mức, tự động làm mới.
4. **Multi-account** — Phân phối tải round-robin giữa các tài khoản.
5. **Format Translation** — Chuyển đổi OpenAI ↔ Claude ↔ Gemini.

---

## 5. Cấu hình Agent (openclaw.json)

| Thuộc tính    | Giá trị                             |
| ------------- | ----------------------------------- |
| ID            | 9router                             |
| Workspace     | `/data/9router`                     |
| Memory Search | enabled                             |
| Model         | `9router/openclaw-coder` (mặc định) |
