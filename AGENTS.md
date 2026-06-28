# AGENTS.md - Giao thức Làm việc 9Router

> Phiên bản này bao gồm toàn bộ nội dung từ BOOTSTRAP.md (đã gộp).
> KHÔNG cần đọc BOOTSTRAP.md riêng biệt.

---

## 1. Boot Sequence (Chuỗi Khởi động)

**Mọi session bắt buộc phải thực hiện đầy đủ các bước sau:**

1. Đọc `SOUL.md` — Xác nhận bản sắc.
2. Đọc `IDENTITY.md` — Xác định vai trò + quyền hạn.
3. Đọc `USER.md` — Xác định Sếp.
4. Đọc nhật ký hôm nay và hôm qua (`memory/YYYY-MM-DD.md`).
5. Nếu là **MAIN SESSION**: đọc `MEMORY.md` (root workspace).

> **TUYỆT ĐỐI KHÔNG BỎ QUA boot sequence. KHÔNG hành động khi chưa nắm đủ ngữ cảnh.**

---

## 2. Cấu trúc Bộ nhớ

| Loại              | File                   | Mục đích                                |
| ----------------- | ---------------------- | --------------------------------------- |
| Nhật ký hàng ngày | `memory/YYYY-MM-DD.md` | Ghi chép thô theo ngày                  |
| Bộ nhớ dài hạn    | root `MEMORY.md`       | Thông tin chiến lược (chỉ MAIN SESSION) |

---

## 3. Kỷ luật Git

- Mỗi tác vụ = 1 nhánh (branch) = 1 Pull Request (PR).
- Tuyệt đối không push trực tiếp lên nhánh main.
- **KHÔNG** tạo PR lên `decolua/9router` (upstream) — chỉ tạo trên fork `diepxuan/9router`.
- Chờ Sếp duyệt trước khi merge.
- Sau khi merge: dọn dẹp các nhánh cục bộ đã lỗi thời (stale branches).

---

## 4. Nguyên tắc Phát triển

### Trước khi viết code

- Đọc issue/task thật kỹ.
- Xác định phạm vi ảnh hưởng.
- Kiểm tra code tương tự đã có.

### Trong khi viết code

- Tuân thủ phong cách code hiện tại.
- Không phá tương thích ngược (backward compatibility).
- Nén RTK phải chính xác tuyệt đối — sai = tốn token.

### Sau khi viết code

- Cập nhật `CHANGELOG.md`.
- Tạo `docs/UPDATE-YYYY-MM-DD.md` nếu thay đổi lớn.
- Viết commit message rõ ràng.

---

## 5. Danh sách kiểm tra Xác thực Ngữ cảnh

**Trước khi thực hiện, tự hỏi:**

| Câu hỏi                                  | Mức ưu tiên                       |
| ---------------------------------------- | --------------------------------- |
| Task đã rõ phạm vi chưa?                 | —                                 |
| Có ảnh hưởng đến nén RTK compression?    | **Cao nhất** — sai = mất token    |
| Có ảnh hưởng đến proxy routing/fallback? | Kiểm tra fallback trước khi merge |
| Có thay đổi config/providers?            | Kiểm tra tương thích ngược        |
| Cần tạo tài liệu (`docs/UPDATE-*.md`)?   | Nếu có thay đổi đáng kể           |

**Chưa rõ ràng → hỏi Sếp, tuyệt đối không đoán.**

---

## 6. Execution Guard (Biên giới Thực thi)

**BAT BUOC PHAI THUC HIEN:**

- Phải đọc boot sequence.
- Push hoặc merge trực tiếp lên nhánh khác base từ main.
- Chỉ tạo PR trên fork `diepxuan/9router`.
- Tạo nhánh mới cho mọi thay đổi, base từ main.
- Phải tương thích ngược.
- Xoá, ẩn đi secrets/API keys.
- Phải tạo commit mới thay vì amend.
- Luôn luôn hỏi trước khi force push.
- **Chi duoc viet trong layer fork (`src/diepxuan/`, `open-sse/diepxuan/`), tuyet doi khong sua truc tiep base file upstream.**

---

## 7. Tài liệu và Changelog

### Quy tắc changelog

Fork `diepxuan/9router` chỉ dùng `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` thay cho `CHANGELOG.md` làm changelog duy nhất. Mọi thay đổi — thêm provider, sửa feature, fix bug, cập nhật logic — đều ghi vào file `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`.

Mục đích: giúp các agent/session khác (kể cả aiagent hoặc session mới) hiểu ngay fork này custom những gì, thay đổi những gì, không cần đọc CHANGELOG gốc.

### Trigger tạo tài liệu

| Tình huống                                  | File tài liệu                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Thêm provider mới                           | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` + section mới cho provider                 |
| Thay đổi logic nén RTK                      | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`                                            |
| Sửa fallback routing                        | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`                                            |
| Thay đổi dashboard UI đáng kể               | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`                                            |
| Sửa lỗi ảnh hưởng đến proxy/token savings   | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`                                            |
| Thay đổi fork governance / quy tắc làm việc | Cập nhật `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`                                            |
| Thay đổi lớn về kiến trúc hệ thống          | Thêm `docs/UPDATE-YYYY-MM-DD.md` (giữ nguyên, file này dùng để ghi chi tiết kỹ thuật sâu hơn) |

### Nguyên tắc viết changelog trong CUSTOM-FEATURES-MERGE-CHECKLIST.md

- Mỗi feature custom = 1 section riêng, có mục đích, file cần giữ, checklist, smoke test.
- Nếu sửa base file, phải document lý do và file gốc bị ảnh hưởng.
- Nếu mắc lỗi (sửa nhầm base file thay vì fork layer), ghi rõ lỗi đó để các agent/session khác tránh lặp lại.
- Không xóa nội dung cũ; chỉ thêm mới hoặc cập nhật section hiện có.

### Trigger tạo tài liệu

**Tạo hoặc cập nhật tài liệu khi:**

- Thêm nhà cung cấp (provider) mới.
- Thay đổi logic nén RTK compression.
- Sửa fallback routing.
- Thay đổi dashboard UI đáng kể.
- Sửa lỗi ảnh hưởng đến proxy/token savings.

**File tài liệu:** `docs/UPDATE-YYYY-MM-DD.md` (chi tiết kỹ thuật)
**Changelog (bắt buộc):** `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md`

---

## 8. Xử lý Sự cố (Failure Handling)

1. **Dừng ngay** — không tiếp tục hành động.
2. **Phân tích nguyên nhân gốc** (root cause analysis).
3. **Không vá trực tiếp trên main** — tạo nhánh sửa mới.
4. **Báo cáo Sếp** — kèm phân tích và hướng xử lý.

### Tiêu chí Escalation (Khi nào phải báo Sếp ngay)

| Tình huống                       | Hành động                   |
| -------------------------------- | --------------------------- |
| Proxy ngừng hoạt động > 5 phút   | Báo Sếp NGAY                |
| Token bị rò rỉ (API key exposed) | Báo Sếp NGAY, rollback ngay |
| Lỗi ảnh hưởng đến > 1 người dùng | Báo Sếp NGAY                |
| Lỗi ảnh hưởng đến 1 người dùng   | Sửa → PR → thông báo Sếp    |

---

## 9. Sub-Agents (Các Agent con)

- Gọi là **đệ** (không dùng "agent con").
- Mô tả bắt buộc khi gọi: mục tiêu, đầu vào (input), đầu ra (output), giới hạn quyền.
- Đệ không được vượt quyền 9Router Agent.

---

## 10. Loại Session

| Loại   | Key                  | Quyền hạn                 |
| ------ | -------------------- | ------------------------- |
| MAIN   | `agent:9router:main` | Đọc và cập nhật MEMORY.md |
| Normal | —                    | Chỉ ghi nhật ký hàng ngày |

---

_Giao thức này kết hợp AGENTS.md + BOOTSTRAP.md. Không cần đọc BOOTSTRAP.md riêng biệt._
