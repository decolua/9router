# 8Router

8Router là local-first AI router cung cấp một OpenAI-compatible endpoint ổn định tại `http://localhost:20128/v1` cho coding tools.

README này ưu tiên cách cài và dùng nhanh. Nếu bạn chỉ muốn chạy 8Router, hãy bắt đầu từ phần Quick start.

- [🇻🇳 Tiếng Việt](./i18n/README.vi.md)
- [🇨🇳 中文](./i18n/README.zh-CN.md)
- [🇯🇵 日本語](./i18n/README.ja-JP.md)

## Quick start

### Install from npm

```bash
npm install -g 8router
8router
```

### Run from source

```bash
git clone https://github.com/baines95/8router.git
cd 8router
npm install
npm run build
npm link
8router
```

### Default URLs

- Dashboard: `http://localhost:20128/dashboard`
- API base: `http://localhost:20128/v1`

App state mặc định được lưu ở `~/.8router`, nên cấu hình và dữ liệu provider vẫn còn sau khi nâng cấp.

## Connect your tool

### Claude Code

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-8router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-8router-api-key"
```

### Other OpenAI-compatible tools

Dùng các giá trị sau:

- Base URL: `http://localhost:20128/v1`
- API key: `your-8router-api-key`
- Model: model id trực tiếp hoặc tên combo

Nếu tool của bạn có vấn đề với `localhost` qua IPv6, thử `127.0.0.1`.

## Typical routing setup

Một cấu hình thường dùng:

1. model subscription tốt nhất
2. model API giá rẻ làm fallback
3. provider miễn phí làm lớp cuối

Ví dụ:

```text
1. cc/claude-opus-4-6
2. glm/glm-4.7
3. if/kimi-k2-thinking
```

Cách này giữ chất lượng ở lớp đầu, đẩy overflow sang lớp rẻ hơn, và vẫn còn đường lui khi các lớp trên gặp giới hạn.

## About this fork

Repo này là một fork của upstream `8router`.

Bản hiện tại được phát hành dưới version `0.4.6-mini.1` và bám theo capability của upstream `0.4.6` theo hướng chọn lọc, không nhằm đạt full parity.

So với upstream, fork này ưu tiên phạm vi gọn hơn, codebase TypeScript-first hơn, và bề mặt dashboard hiện tại dễ kiểm soát hơn.

Về ngôn ngữ giao diện, fork này đi theo dashboard hiện tại dựa trên `shadcn/ui`, thiên về hierarchy rõ, sạch và dễ scan hơn. Đổi lại, nó không cố giữ full UI parity với toàn bộ giao diện upstream.

Các thay đổi runtime/provider chính của release này được tóm tắt trong [CHANGELOG.md](./CHANGELOG.md).

## Dashboard basics

Thiết lập cơ bản thường là:

1. khởi động 8Router
2. mở dashboard tại `http://localhost:20128/dashboard`
3. thêm provider
4. tạo combo fallback nếu cần
5. lấy API key hoặc endpoint access token
6. trỏ tool của bạn vào `/v1`

## Environment variables

Các biến quan trọng nhất:

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | `8router-default-secret-change-me` | Ký dashboard auth cookie |
| `INITIAL_PASSWORD` | `123456` | Mật khẩu dashboard ban đầu |
| `DATA_DIR` | `~/.8router` | Lưu database chính |
| `BASE_URL` | `http://localhost:20128` | Base URL nội bộ phía server |
| `CLOUD_URL` | `https://8router.com` | Base URL cloud sync phía server |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | Secret để sinh API key |
| `REQUIRE_API_KEY` | `false` | Bắt buộc Bearer API key trên `/v1/*` |
| `ENABLE_REQUEST_LOGS` | `false` | Bật request logs dưới `logs/` |

Trong production, nên ưu tiên cấu hình đúng `BASE_URL` và `CLOUD_URL`.

## Docker and production

### Local development

```bash
npm install
npm run dev
```

### Production build

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t 8router .

docker run -d \
  --name 8router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 8router-data:/app/data \
  -v 8router-usage:/root/.8router \
  8router
```

## Troubleshooting

### Dashboard opens on the wrong port

```bash
PORT=20128
NEXT_PUBLIC_BASE_URL=http://localhost:20128
```

### First login fails

Kiểm tra `INITIAL_PASSWORD`. Nếu chưa đặt và chưa có password hash đã lưu, mật khẩu fallback là `123456`.

### Provider stops working

Kết nối lại provider trong dashboard và kiểm tra session/token đang lưu.

### Requests fail after quota or rate limit

Tạo hoặc chỉnh combo để provider rẻ hơn hoặc miễn phí có thể takeover tự động.

### No request logs

```bash
ENABLE_REQUEST_LOGS=true
```

## Repo notes

- `src/`: dashboard, API routes và runtime chính
- `src/lib/open-sse/`: routing, translation và provider execution
- `src/app/`: dashboard UI và API routes của Next.js
- `tests/`: Vitest suite cho các hành vi runtime chính
- `cloud/`: Cloudflare Worker runtime

## Account selection modes

8Router hỗ trợ hai mode chọn tài khoản chính:

- **Use-until-exhausted**: dùng account hiện tại cho đến khi account đó hết quota hoặc tạm unavailable. Nếu đã fallback sang account khác và account đó vẫn healthy, router không nhảy ngược về primary quá sớm.
- **Round-robin**: mỗi request mới chuyển sang account usable kế tiếp; account đang cooldown hoặc unavailable sẽ bị bỏ qua.

### Quota cooldown behavior

- Khi account gặp rate limit hoặc quota exhaustion, router sẽ tạm thời bỏ qua account đó cho đến khi cooldown hoặc reset hợp lệ kết thúc.
- Trạng thái cooldown áp dụng cho các request tiếp theo và không reset chỉ vì bắt đầu chat mới.

### Compared with previous behavior

- Hành vi cốt lõi của hai mode không đổi, nhưng semantics hiện rõ ràng hơn.
- `Use-until-exhausted` không còn quay lại primary quá sớm khi fallback hiện tại vẫn khỏe.
- `Round-robin` nay là hard round-robin quota-aware thay vì còn giữ sticky behavior.
- Log chọn account, skip reason, fallback reason, và cooldown context đã dễ đọc hơn.

## License

MIT. Xem [LICENSE](./LICENSE).
