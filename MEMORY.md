# MEMORY.md - Bộ nhớ Chiến lược 9Router

> Chỉ MAIN SESSION mới được đọc file này. Các session thông thường chỉ ghi vào nhật ký hàng ngày.

---

## 1. Trạng thái dự án

| Thuộc tính | Giá trị |
|------------|---------|
| Kho lưu trữ | diepxuan/9router |
| Phiên bản hiện tại | v0.4.66 (29/05/2026) |
| Dashboard | http://9router.diepxuan.corp:3000/ |
| Triển khai | CapRover (Docker) |

---

## 2. Kiến trúc quan trọng

### RTK Token Saver
- Cơ chế nén nội dung `tool_result`, tiết kiệm 20-40% tokens.
- Yêu cầu độ chính xác tuyệt đối — sai sót dẫn đến mất ngữ cảnh và tốn token.
- Vị trí: `src/services/rtk/`

### Proxy & Fallback
- Cổng Proxy: 3000 (chỉ định bởi Sếp, 2026-07-21). Tài liệu upstream mặc định ghi 20128 — đã đồng bộ sang URL/port Sếp chỉ định.
- Chuỗi Fallback: Subscription $\rightarrow$ Cheap $\rightarrow$ Free, đảm bảo không gián đoạn (zero downtime).
- Thời gian chờ (Timeout stall): 30 giây (từ v0.4.66).

### Cơ sở dữ liệu
- SQLite: better-sqlite3 $\rightarrow$ node:sqlite (Node $\geq$ 22.5) $\rightarrow$ sql.js (fallback).
- Thư mục DATA_DIR: `~/.9router`, xử lý fallback khi gặp lỗi EACCES/EPERM.

---

## 3. Nhà cung cấp & Mô hình (Providers & Models)

### Tổng quan
- Hỗ trợ hơn 40 nhà cung cấp AI.
- Chuyển đổi định dạng mô hình: OpenAI $\leftrightarrow$ Claude $\leftrightarrow$ Gemini.

### Các Provider mới (Tháng 05/2026)
- Qoder (v0.4.66)
- Kiro (v0.4.50)
- xAI Grok (v0.4.58)
- Xiaomi MiMo (v0.4.12)
- Azure OpenAI (v0.4.2)
- Cloudflare Workers AI (v0.4.25)

---

## 4. Quy trình Git (Git Workflow)

- Chỉ tạo Pull Request (PR) lên `diepxuan/9router` (fork).
- TUYỆT ĐỐI KHÔNG push hoặc PR lên `decolua/9router` (upstream).
- Mỗi tác vụ = 1 nhánh (branch) = 1 PR.
- Chờ Sếp duyệt trước khi merge.

---

## 5. Nợ kỹ thuật (Technical Debt)

| Vấn đề | Trạng thái | Ghi chú |
|-------|--------|-------|
| CHANGELOG bị ngắt quãng | Không còn áp dụng | Fork đã chuyển sang dùng `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` làm changelog duy nhất (theo AGENTS.md §7). `CHANGELOG.md` giữ nguyên bản upstream làm tham chiếu. |
| Tài liệu Identity trùng lặp | Đã xử lý | SOUL + IDENTITY trùng lặp 60% — đã refactor (PR #31). |
| Workspace `.git` read-only | Đã ghi nhận (2026-07-21) | `.git` mount `ro` trong môi trường dev hiện tại — mọi thao tác tạo nhánh/commit/cherry-pick cần Sếp phê duyệt. Xem AGENTS.md §11 Sandbox & Escalation. |

---

## 6. Các file Identity và Tài liệu

| File | Mô tả |
|------|-------|
| `SOUL.md` | Bản sắc cốt lõi, nguyên tắc, phong cách |
| `IDENTITY.md` | Con trỏ định danh + cấu hình |
| `USER.md` | Hồ sơ Sếp (Đức Trần) |
| `AGENTS.md` | Giao thức làm việc, boot sequence, kỷ luật Git |
| `BOOTSTRAP.md` | Giao thức khởi tạo session (cho aiagent và agent khác) |
| `MEMORY.md` | Bộ nhớ chiến lược dài hạn |
| `AGENT_WORKSPACE.md` | Quick reference không gian làm việc |
| `TOOLS.md` | Dev quick reference |
| `HEARTBEAT.md` | Điều khiển heartbeat task |
| `CHANGELOG.md` | Lịch sử các phiên bản |
| `DOCKER.md` | Hướng dẫn Docker |
| `README.md` | Giới thiệu dự án |
| `memory/` | Thư mục nhật ký hàng ngày |
| `docs/` | Tài liệu cập nhật chi tiết |

---

## 7. Bài học kinh nghiệm

### Tháng 05/2026
- Việc nén RTK phải được kiểm tra kỹ trước khi merge.
- Logic Fallback cần có unit test chặt chẽ.
- Xây dựng lại Docker image sau khi thay đổi base image.

### Tháng 04/2026
- Đăng nhập OIDC có thể gây khóa tài khoản — cần chế độ phục hồi.
- Xung đột cổng MITM 443 — phải kill process trước khi khởi động.
- Chế độ Tailscale TUN tốt hơn cho Funnel TLS.

---

*MEMORY.md được cập nhật bởi MAIN SESSION. Các session thông thường không đọc/ghi file này.*