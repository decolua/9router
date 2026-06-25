# Custom Features Merge Checklist

Tài liệu này ghi lại các chức năng được bổ sung riêng trong fork `diepxuan/9router`, không mặc định có trong upstream `decolua/9router` tại thời điểm ghi nhận.

Mục tiêu:
- Dùng làm danh sách đối chiếu sau mỗi lần merge/rebase với upstream.
- Tránh mất tính năng custom khi resolve conflict.
- Có checklist kiểm tra nhanh trước khi push/PR.
- Có manifest và script tự động để kiểm tra các patch fork còn hoạt động.

Công cụ kiểm tra tự động:
- Manifest máy đọc được: `docs/custom-features.manifest.json`
- Script kiểm tra: `scripts/diepxuan/check-custom-features.mjs`
- Lệnh chuẩn sau mỗi lần merge/rebase upstream:

```bash
node scripts/diepxuan/check-custom-features.mjs
npm run build
```

Nếu script báo `FAIL`, không push/PR cho tới khi đã phân tích và sửa nguyên nhân. Nếu cần cập nhật feature mới hoặc đổi vị trí file custom, cập nhật cả tài liệu này và `docs/custom-features.manifest.json`.

Repository:
- Fork: `diepxuan/9router`
- Upstream: `decolua/9router`
- Branch fork chính: `main`
- Branch upstream thường đối chiếu: `master`

Quy tắc merge/rebase:
- Không push trực tiếp lên upstream `decolua/9router`.
- Khi kiểm tra PR bằng GitHub CLI, luôn dùng repo rõ ràng: `-R diepxuan/9router`.
- Sau khi merge/rebase upstream, chạy checklist trong tài liệu này trước khi push.

---

## 1. Alibaba Cloud Coding Plan provider (`alicode`, `alicode-intl`)

### Mục đích

Bổ sung provider Alibaba Cloud Coding Plan / DashScope Coding để 9Router route request tới endpoint OpenAI-compatible của Alibaba.

Provider IDs:
- `alicode`
- `alicode-intl`

### File cần tồn tại/được giữ

- `src/shared/constants/providers.js` — base hook `extendApiKeyProviders(...)`
- `src/shared/constants/config.js` — base hook `extendProviderEndpoints(...)`
- `src/diepxuan/shared/constants/providers.js` — định nghĩa provider AliCode của fork
- `src/diepxuan/shared/constants/config.js` — định nghĩa endpoint AliCode của fork
- `src/app/api/providers/validate/route.js`
- `src/app/api/providers/[id]/test/testUtils.js`
- `src/app/api/providers/[id]/models/route.js`
- `open-sse/services/usage.js` — base hook `getDiepXuanUsageForProvider(...)`
- `open-sse/diepxuan/services/usage.js` — AliCode usage implementation
- `open-sse/diepxuan/services/usageHooks.js` — Open SSE usage hook registry
- `public/providers/alicode.png`
- `public/providers/alicode-intl.png`

### Điểm đối chiếu code

Trong `src/shared/constants/providers.js` phải chỉ còn hook mỏng:

```js
extendApiKeyProviders(BASE_APIKEY_PROVIDERS)
```

Trong `src/shared/constants/config.js` phải chỉ còn hook mỏng:

```js
extendProviderEndpoints(BASE_PROVIDER_ENDPOINTS)
```

Trong `src/diepxuan/shared/constants/providers.js` phải có provider:

```js
DIEPXUAN_APIKEY_PROVIDERS
alicode
"alicode-intl"
```

Trong `src/diepxuan/shared/constants/config.js` phải có endpoint chat completions:

```js
alicode: "https://coding.dashscope.aliyuncs.com/v1/chat/completions"
"alicode-intl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
```

Trong `open-sse/services/usage.js` base không được gọi trực tiếp `getAlicodeUsage(...)`; phải gọi hook:

```js
getDiepXuanUsageForProvider(connection, proxyOptions)
```

Trong `open-sse/diepxuan/services/usageHooks.js` phải route `alicode` / `alicode-intl` sang `getAlicodeUsage(...)`.

Trong provider validate/test phải xử lý `alicode` và `alicode-intl` như OpenAI-compatible provider.

### Checklist sau merge upstream

```bash
grep -R "extendApiKeyProviders\|extendProviderEndpoints" -n src/shared/constants | head -40
grep -R "alicode" -n src/diepxuan/shared/constants src/app/api/providers open-sse/services open-sse/diepxuan public/providers | head -80
node --check src/shared/constants/providers.js
node --check src/shared/constants/config.js
node --check src/diepxuan/shared/constants/providers.js
node --check src/diepxuan/shared/constants/config.js
node --check src/app/api/providers/validate/route.js
node --check src/app/api/providers/[id]/test/testUtils.js
node --check src/app/api/providers/[id]/models/route.js
node --check open-sse/services/usage.js
node --check open-sse/diepxuan/services/usage.js
node --check open-sse/diepxuan/services/usageHooks.js
```

### Smoke test khuyến nghị

Nếu có API key thật:

1. Mở dashboard provider.
2. Thêm connection `alicode` hoặc `alicode-intl`.
3. Chạy validate/test model.
4. Gửi request chat completion qua `/api/v1/chat/completions`.
5. Kiểm tra response không lỗi auth/endpoint/model.

---

## 2. Manual quota counter cho provider không có quota API

### Mục đích

Một số provider không có quota API chuẩn. Fork bổ sung cơ chế đếm local từ usage database để hiển thị quota gần đúng, hiện dùng cho AliCode.

Provider đang dùng manual quota:
- `alicode`
- `alicode-intl`

### File cần tồn tại/được giữ

- `src/diepxuan/lib/db/repos/manualQuotaRepo.js` — implementation local counter
- `src/diepxuan/usage/index.js` — server-side usage override hook
- `src/diepxuan/usage/providers.js` — client-safe usage provider eligibility hook
- `src/app/api/usage/[connectionId]/route.js` — base route hook `getUsageOverride(...)`
- `src/app/api/providers/client/route.js` — base route hook `isDiepXuanUsageEligible(...)`
- `src/diepxuan/app/dashboard/usage/components/ProviderLimits/index.js` — dashboard hook `extendUsageSupportedProviders(...)`
- `src/diepxuan/app/dashboard/usage/components/ProviderLimits/utils.js`
- `src/diepxuan/app/dashboard/usage/components/ProviderLimits/ProviderLimitCard.js`

### Logic quan trọng

`manualQuotaRepo.js` phải export:

```js
ALICODE_PLANS
detectAlicodePlan()
getAlicodeManualQuota()
hasManualQuota()
getManualQuota()
```

Registry manual quota phải có:

```js
const MANUAL_QUOTA_HANDLERS = {
  alicode: getAlicodeManualQuota,
  "alicode-intl": getAlicodeManualQuota,
};
```

`src/diepxuan/usage/index.js` và `src/diepxuan/usage/providers.js` phải là registry/hook trung tâm cho usage custom:

```js
extendUsageSupportedProviders()
extendUsageApiKeyProviders()
isDiepXuanUsageEligible()
getUsageOverride()
handleUsageOverrideResponse()
```

`src/app/api/usage/[connectionId]/route.js` phải ưu tiên hook custom trước OAuth/API quota flow, nhưng base route chỉ giữ hook Response mỏng:

```js
const customUsageResponse = await handleUsageOverrideResponse(connection, connectionId);
if (customUsageResponse) return customUsageResponse;
```

`src/app/api/providers/client/route.js` không merge trực tiếp `DIEPXUAN_USAGE_*`; phải gọi hook:

```js
isDiepXuanUsageEligible(connection, USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS)
```

### Plan quota hiện tại

Lite:
- 5h requests: 1200
- Weekly requests: 9000
- Monthly requests: 18000

Pro:
- 5h requests: 6000
- Weekly requests: 45000
- Monthly requests: 90000

Detect plan:
- Nếu `connection.providerSpecificData.manualQuotaPlan` là `lite` hoặc `pro` thì dùng giá trị đã lưu.
- Nếu chưa set, auto-detect theo tổng request 30 ngày.
- `>= 18000` request thì coi là Pro, thấp hơn coi là Lite.

### Window reset

- 5h: fixed blocks theo UTC: `00-05`, `05-10`, `10-15`, `15-20`, `20-24`.
- Weekly: reset Chủ nhật 23:00 UTC+7 (`16:00 UTC`).
- Monthly: reset ngày 4 hằng tháng 23:00 UTC+7 (`16:00 UTC`).

### Lưu ý về độ chính xác

Manual quota là local counter:
- Đếm request đi qua 9Router.
- Có thể lệch với quota thật của AliCode nếu provider tính theo API call thực tế, model, retry, hoặc request không đi qua 9Router.
- Số liệu dùng để tham khảo vận hành, không thay thế billing/quota chính thức của provider.

### Rủi ro cần kiểm tra sau merge

`countRequestsInRange()` đang đọc `usageDaily` trước, rồi dùng `usageHistory` cho partial day. Nếu schema upstream đổi hoặc logic aggregate usage thay đổi, quota có thể lệch.

Sau merge upstream cần kiểm tra:

```bash
grep -R "manualQuota" -n src/diepxuan src/app | head -80
grep -R "getUsageOverride\|handleUsageOverrideResponse\|extendUsageSupportedProviders\|isDiepXuanUsageEligible" -n src/diepxuan/usage src/app/api/usage src/app/api/providers/client src/diepxuan/app/dashboard/usage/components/ProviderLimits
node --check src/diepxuan/lib/db/repos/manualQuotaRepo.js
node --check src/diepxuan/usage/index.js
node --check src/diepxuan/usage/providers.js
node --check src/app/api/usage/[connectionId]/route.js
node --check src/app/api/providers/client/route.js
```

### Smoke test khuyến nghị

1. Tạo/đảm bảo có connection `alicode`.
2. Gửi vài request qua 9Router bằng connection đó.
3. Mở usage dashboard.
4. Gọi API usage:

```bash
curl -sS http://localhost:20128/api/usage/<connectionId> | jq .
```

Kết quả mong đợi:
- JSON có `plan`.
- JSON có `quotas` gồm 3 dòng: 5h, weekly, monthly.
- `raw.source` là `manual-counter`.

---

## 3. Ẩn reset countdown cho AliCode 5h và weekly windows

### Mục đích

Dashboard usage không hiển thị countdown reset cho 5h và weekly quota của AliCode để tránh gây hiểu nhầm. Monthly vẫn hiển thị reset.

### File cần kiểm tra

- `src/lib/db/repos/manualQuotaRepo.js`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/ProviderLimitCard.js`

### Logic cần giữ

Trong quota object cho 5h/weekly:

```js
resetAt: null,
resetCountdown: null,
hideReset: true,
```

Monthly vẫn có `resetAt` và `resetCountdown`.

### Checklist sau merge upstream

```bash
grep -R "hideReset\|resetCountdown" -n src/lib/db/repos src/app/\(dashboard\)/dashboard/usage/components/ProviderLimits
node --check src/lib/db/repos/manualQuotaRepo.js
```

### Smoke test khuyến nghị

1. Mở `/dashboard/usage`.
2. Chọn AliCode account.
3. Xác nhận 5h và weekly không hiển thị countdown reset.
4. Xác nhận monthly vẫn hiển thị reset nếu UI có vùng hiển thị.

---

## 4. Fallback web search / web fetch sang combo đầu tiên

### Mục đích

Nếu request search/fetch không truyền provider/model hoặc truyền provider không hợp lệ, 9Router fallback sang combo đầu tiên cùng loại thay vì fail ngay.

Files:
- `src/sse/handlers/search.js`
- `src/sse/handlers/fetch.js`
- `src/diepxuan/sse/webComboFallback.js`

### Logic cần giữ

Search:
- Nhận `provider` hoặc `model`.
- Nếu `providerInput` là combo name thì chạy combo đó.
- Nếu không có provider/model, fallback sang combo đầu tiên có `kind === "webSearch"`.
- Nếu provider unknown, fallback sang combo đầu tiên có `kind === "webSearch"`.

Fetch:
- Logic tương tự cho web fetch combo.

Base handler chỉ nên giữ hook mỏng sang extension layer:

```js
handleDiepXuanWebComboFallback()
```

Logic chi tiết nằm trong `src/diepxuan/sse/webComboFallback.js`:

```js
getFallbackWebCombo()
getFirstWebCombo()
firstCombo
handleComboChat()
```

### Checklist sau merge upstream

```bash
grep -n "handleDiepXuanWebComboFallback\|No provider/model specified\|Unknown provider" src/sse/handlers/search.js src/sse/handlers/fetch.js
grep -n "firstCombo\|getFallbackWebCombo\|getFirstWebCombo" src/diepxuan/sse/webComboFallback.js
node --check src/sse/handlers/search.js
node --check src/sse/handlers/fetch.js
node --check src/diepxuan/sse/webComboFallback.js
```

### Smoke test khuyến nghị

Cần có ít nhất một combo webSearch/webFetch đã cấu hình.

Search không truyền provider/model:

```bash
curl -sS http://localhost:20128/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"query":"test search"}'
```

Search provider unknown:

```bash
curl -sS http://localhost:20128/api/v1/search \
  -H 'content-type: application/json' \
  -d '{"model":"unknown-provider","query":"test search"}'
```

Kết quả mong đợi:
- Nếu có combo phù hợp: request được route qua combo.
- Nếu không có combo: trả lỗi rõ ràng, không crash.

---

## 5. Combo fail tracker qua DiepXuan hook

### Mục đích

Combo fallback có thể bỏ qua model đã lỗi liên tiếp để giảm latency và tránh lặp lại provider/model đang hỏng. Base `open-sse/services/combo.js` chỉ giữ hook mỏng; state và logic custom nằm trong `open-sse/diepxuan/**`.

### File cần tồn tại/được giữ

- `open-sse/services/combo.js` — base chỉ gọi hook cấp cao `beforeComboModelAttempt(...)` / `afterComboModelAttempt(...)`
- `open-sse/diepxuan/comboHooks.js` — hook registry mỏng, giữ compatibility helpers `shouldSkipComboModel(...)` / `recordComboModelOutcome(...)`
- `open-sse/diepxuan/comboFailTracker.js` — fail counter implementation

### Điểm đối chiếu code

Base `open-sse/services/combo.js` chỉ nên thấy hook cấp cao:

```js
beforeComboModelAttempt({ modelStr, comboName, log })
afterComboModelAttempt({ modelStr, comboName, ok })
```

Logic chi tiết trong `open-sse/diepxuan/comboHooks.js` vẫn giữ:

```js
shouldSkipComboModel(modelStr, comboName)
recordComboModelOutcome(modelStr, comboName, success)
```

`open-sse/diepxuan/comboFailTracker.js` phải giữ threshold `MAX_FAILS` và reset window `RESET_AFTER_MS`.

### Checklist sau merge upstream

```bash
grep -R "beforeComboModelAttempt\|afterComboModelAttempt" -n open-sse/services/combo.js open-sse/diepxuan/comboHooks.js
grep -R "shouldSkipComboModel\|recordComboModelOutcome" -n open-sse/diepxuan
node --check open-sse/services/combo.js
node --check open-sse/diepxuan/comboHooks.js
node --check open-sse/diepxuan/comboFailTracker.js
```

---

## 6. Dynamic baseUrl trong combo curl snippet

### Mục đích

Trang combo hiển thị curl snippet dùng base URL động theo host hiện tại thay vì hard-code, giúp copy command đúng môi trường.

Files:
- `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js`
- `next.config.mjs`

### Checklist sau merge upstream

```bash
grep -n "baseUrl\|window.location\|headers" src/app/\(dashboard\)/dashboard/media-providers/combo/\[id\]/page.js | head -80
node --check src/app/\(dashboard\)/dashboard/media-providers/combo/\[id\]/page.js
node --check next.config.mjs
```

### Smoke test khuyến nghị

1. Chạy app local.
2. Mở combo detail page.
3. Kiểm tra curl snippet dùng đúng origin hiện tại.
4. Copy curl chạy thử request với API key hợp lệ nếu cần.

---

## 6. CLI global install / bundled dashboard package

### Mục đích

Fork giữ thêm output build và dependencies cần thiết để CLI/global install có thể chạy dashboard package từ source/package.

Files/thư mục liên quan:
- `cli/package.json`
- `cli/cli.js`
- `cli/hooks/postinstall.js`
- `cli/src/cli/**`
- `cli/app/package.json`
- `cli/app/server.js`
- `cli/app/.next/**`
- `cli/app/node_modules/**`
- `.npmignore`
- `next.config.mjs`

### Lưu ý quan trọng

`cli/app/.next` và `cli/app/node_modules` là generated/dependency artifacts nhưng hiện được track để phục vụ CLI packaging.

Điều này có trade-off:
- Ưu điểm: package CLI có đủ artifact để chạy sau global install.
- Nhược điểm: repo nặng, rebase dễ conflict, diff lớn, dễ bị upstream merge làm lệch artifact.

Khi merge upstream, không xóa các artifact này nếu chưa có phương án packaging thay thế.

### Checklist sau merge upstream

```bash
test -f cli/package.json && echo "cli/package.json OK"
test -f cli/cli.js && echo "cli/cli.js OK"
test -f cli/hooks/postinstall.js && echo "postinstall OK"
test -d cli/app/.next && echo "cli/app/.next OK"
test -d cli/app/node_modules && echo "cli/app/node_modules OK"
node --check cli/cli.js
node --check cli/hooks/postinstall.js
node --check cli/src/cli/api/client.js
node --check cli/src/cli/menus/providers.js
node --check cli/src/cli/menus/settings.js
node --check cli/src/cli/terminalUI.js
```

### Smoke test khuyến nghị

Nếu cần kiểm tra package CLI:

```bash
cd cli
npm pack --dry-run
node cli.js --help
```

Nếu có flow global install nội bộ, test trong môi trường sạch trước khi release.

---

## 7. MITM / Antigravity custom flow

### Mục đích

Fork có các endpoint/UI hỗ trợ Antigravity MITM và alias/config qua dashboard CLI tools.

Files cần chú ý:
- `src/app/api/cli-tools/antigravity-mitm/route.js`
- `src/app/api/cli-tools/antigravity-mitm/alias/route.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/MitmServerCard.js`
- `src/mitm/manager.js`
- `src/mitm/handlers/base.js`
- `cli/app/src/mitm/server.js`

### Checklist sau merge upstream

```bash
grep -R "antigravity-mitm\|MitmServerCard\|MITM" -n src cli/app/src | head -120
node --check src/app/api/cli-tools/antigravity-mitm/route.js
node --check src/app/api/cli-tools/antigravity-mitm/alias/route.js
node --check src/mitm/manager.js
node --check src/mitm/handlers/base.js
```

### Smoke test khuyến nghị

1. Mở `/dashboard/cli-tools`.
2. Kiểm tra card MITM hiển thị đúng.
3. Start/stop MITM nếu môi trường cho phép.
4. Kiểm tra log không có exception.

---

## 8. Build/deploy pipeline custom

### Mục đích

Fork có workflow build/deploy riêng để build CLI package, đổi package identity sang scope nội bộ và publish lên GitHub Packages của fork.

Workflow chính:
- File: `.github/workflows/build-and-deploy.yml`
- Trigger: push lên `main` và `workflow_dispatch`
- Quyền GitHub Actions cần giữ:
  - `contents: write`
  - `packages: write`
- Registry publish: `https://npm.pkg.github.com`
- Package publish: `@diepxuan/9router`
- Auth publish: `${{ secrets.GITHUB_TOKEN }}` qua `NODE_AUTH_TOKEN`

Các bước custom trong workflow cần giữ:
1. Checkout với `fetch-depth: 0` và `ref: ${{ github.head_ref || github.ref_name }}`.
2. Setup Node.js với `registry-url: "https://npm.pkg.github.com"`.
3. Trong thư mục `cli`, patch package trước build:
   - `npm pkg set name="@diepxuan/9router"`
   - `npm pkg set publishConfig.registry="https://npm.pkg.github.com/"`
   - `npm pkg delete scripts.prepublishOnly || true`
4. Chạy `npm run build` trong `cli`.
5. Bump version không tạo git tag:
   - `npm version patch --no-git-tag-version`
   - `npm version prerelease --preid=patch.$TIMESTAMP --no-git-tag-version`
6. Publish bằng `npm publish`.

Files:
- `.github/workflows/build-and-deploy.yml`
- `Dockerfile`
- `captain-definition`
- `scripts/sync.sh`
- `.npmignore`
- `next.config.mjs`

`scripts/sync.sh` hiện sync dữ liệu runtime từ host `9router` về `/var/lib/9router/`:

```bash
rsync -avP --delete 9router:~/.9router/ /var/lib/9router/
```

### Checklist sau merge upstream

```bash
node scripts/diepxuan/check-custom-features.mjs
test -f .github/workflows/build-and-deploy.yml && echo "workflow OK"
grep -n "@diepxuan/9router\|npm.pkg.github.com\|npm publish\|prepublishOnly\|NODE_AUTH_TOKEN" .github/workflows/build-and-deploy.yml
test -f Dockerfile && echo "Dockerfile OK"
test -f captain-definition && echo "captain-definition OK"
test -f scripts/sync.sh && echo "sync.sh OK"
grep -n "rsync -avP --delete 9router:~/.9router/ /var/lib/9router/" scripts/sync.sh
npm run build
```

### Dấu hiệu workflow bị merge hỏng

- Package name không còn là `@diepxuan/9router` trước khi publish.
- Registry không còn là `https://npm.pkg.github.com/`.
- Workflow không xóa `scripts.prepublishOnly`, làm publish bị chặn bởi script upstream.
- Version bump tạo git tag hoặc sửa git history ngoài ý muốn.
- `npm publish` chạy ở root thay vì trong `cli`.
- Thiếu `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
- Workflow trigger/push nhầm upstream hoặc branch không phải fork `main`.

### Lưu ý

- Không tự ý push/trigger deploy production nếu Sếp chưa duyệt.
- Workflow này chạy khi push lên `main`; mọi PR cần review kỹ trước merge vì merge có thể kích hoạt publish package.

### Domain separation rule

Fork-only code should live under `src/diepxuan/**` and `open-sse/diepxuan/**` whenever practical. Base files should only contain small hooks/bridges and must fail safely so upstream-compatible behavior remains available if a fork module is disabled or broken.

- Sau merge upstream, kiểm tra workflow không tạo PR/push nhầm upstream.

---

## 9. Workspace/project governance files

### Mục đích

Fork có các file vận hành agent/workspace riêng, không thuộc upstream mặc định.

Files:
- `AGENTS.md`
- `AGENT_WORKSPACE.md`
- `BOOTSTRAP.md`
- `SOUL.md`
- `IDENTITY.md`
- `TOOLS.md`
- `USER.md`
- `HEARTBEAT.md`
- `docs/UPDATE-*.md`

### Checklist sau merge upstream

```bash
test -f AGENTS.md && echo "AGENTS.md OK"
test -f SOUL.md && echo "SOUL.md OK"
test -f IDENTITY.md && echo "IDENTITY.md OK"
test -d docs && echo "docs OK"
```

### Lưu ý

Các file này phục vụ workspace/agent nội bộ. Không dùng để đánh giá upstream feature parity.

---

## 10. Checklist tổng sau mỗi lần merge/rebase upstream

Chạy từ root repo:

```bash
# 1. Kiểm tra trạng thái git
git status --short --branch
git log --oneline --decorate --max-count=10

# 2. Chạy bộ kiểm tra custom feature tự động
node scripts/diepxuan/check-custom-features.mjs

# 3. Kiểm tra nhanh custom keywords còn tồn tại
grep -R "alicode\|alicode-intl\|manualQuota\|getUsageOverride\|isDiepXuanUsageEligible" -n src open-sse cli docs .github scripts | head -120
grep -R "firstCombo\|No provider/model specified\|Unknown provider" -n src/sse/handlers/search.js src/sse/handlers/fetch.js

# 4. Syntax check file custom chính
node --check src/diepxuan/lib/db/repos/manualQuotaRepo.js
node --check src/app/api/usage/[connectionId]/route.js
node --check src/sse/handlers/search.js
node --check src/sse/handlers/fetch.js
node --check scripts/diepxuan/check-custom-features.mjs

# 5. Build production
npm run build

# 6. Kiểm tra working tree không có artifact ngoài ý muốn
git status --short --branch
```

Kết quả tối thiểu phải đạt:
- `node scripts/diepxuan/check-custom-features.mjs` pass, không có `FAIL`.
- `node --check` pass hết.
- `npm run build` pass.
- Các keyword custom còn tồn tại.
- Không có conflict marker. Script tự kiểm tra conflict marker theo đầu dòng `<<<<<<<`, `=======`, `>>>>>>>` để tránh false positive với comment separator hoặc command grep trong tài liệu.

---

## 11. Checklist smoke test runtime

Chỉ chạy khi cần xác nhận sâu hơn build/static validation.

```bash
npm run build
npm run start
```

Sau đó kiểm tra:

```bash
curl -sS http://localhost:20128/api/health
curl -sS http://localhost:20128/api/v1/models | jq .
```

Port chuẩn local của workspace là `20128`. Nếu runtime override port, thay `20128` bằng port thực tế.

Smoke test theo feature:
- AliCode provider: thêm connection, validate key, gọi chat completion.
- Manual quota: gọi `/api/usage/<connectionId>` cho AliCode connection.
- Search/fetch fallback: gọi `/api/v1/search` và `/api/v1/web/fetch` khi có combo phù hợp.
- Combo curl snippet: mở combo detail page, kiểm tra origin trong command.
- CLI package: `cd cli && npm pack --dry-run`.

---

## 12. Các dấu hiệu merge hỏng cần xử lý ngay

- `src/shared/constants/providers.js` mất hook `extendApiKeyProviders(...)` hoặc `src/shared/constants/config.js` mất hook `extendProviderEndpoints(...)`.
- `/api/usage/[connectionId]` không còn gọi `getUsageOverride()` trước OAuth/API usage flow.
- `manualQuotaRepo.js` mất registry `alicode` / `alicode-intl`.
- `search.js` / `fetch.js` mất fallback `firstCombo`.
- `npm run build` fail tại route usage/search/fetch/provider.
- Có conflict marker trong `src`, `open-sse`, `cli`, `docs`.
- `cli/app/.next` hoặc `cli/app/node_modules` bị xóa ngoài ý muốn khi vẫn còn cần CLI packaging.
- Workflow GitHub Actions trỏ nhầm hoặc push nhầm upstream.

---

## 12. Runtime feature flag cho DiepXuan extension layer

### Mục đích

Toàn bộ hook DiepXuan (Alibaba manual quota, open-sse AliCode usage, combo fail tracker, web fallback, ...) phải đi qua 2 flag runtime để dễ dàng tắt/bật khi debug, smoke test hoặc rebase upstream.

Files:
- `src/diepxuan/shared/config/flags.js`
- `src/diepxuan/usage/index.js`
- `src/diepxuan/usage/providers.js`
- `src/diepxuan/sse/webComboFallback.js`
- `open-sse/diepxuan/comboHooks.js`
- `open-sse/diepxuan/services/usageHooks.js`

### Flag

- `DIEPXUAN_ENABLED` (mặc định `true`)
  - `false`: tất cả hook DiepXuan trả về giá trị “no-op” (`null`/`false`), giữ nguyên hành vi upstream.
- `DIEPXUAN_SAFE_MODE` (mặc định `false`)
  - `true`: dành cho các hook ghi/đo lường, tắt ghi DB và override usage; chỉ giữ phần đọc an toàn.
  - Hiện dùng cho `isDiepXuanUsageHookSafe()` nếu sau này mở rộng.

### Helper quan trọng

```js
isDiepXuanEnabled()
isDiepXuanSafeMode()
```

### Checklist sau merge upstream

```bash
grep -n "isDiepXuanEnabled\|DIEPXUAN_ENABLED" src/diepxuan/shared/config/flags.js src/diepxuan/usage src/diepxuan/sse open-sse/diepxuan
node --check src/diepxuan/shared/config/flags.js
node --check src/diepxuan/usage/index.js
node --check src/diepxuan/usage/providers.js
node --check src/diepxuan/sse/webComboFallback.js
node --check open-sse/diepxuan/comboHooks.js
node --check open-sse/diepxuan/services/usageHooks.js
```

### Smoke test

1. Bật mặc định (`DIEPXUAN_ENABLED=true`):
   - request search/fetch không provider → fallback combo.
   - request usage cho AliCode → trả manual quota.
2. Tắt bằng `DIEPXUAN_ENABLED=false`:
   - request search/fetch → trả lỗi thiếu provider/model như upstream.
   - request usage cho AliCode → fallback upstream API.

---

## 13. Ghi chú lần kiểm tra gần nhất

Lần kiểm tra gần nhất trong workspace:
- `npm run build`: pass.
- `node --check` các file custom chính: pass.
- Unit test bằng `node --test` không chạy được vì test suite dùng `vitest` nhưng dependency `vitest` chưa có trong package hiện tại.
- Local branch tại thời điểm kiểm tra từng có trạng thái `main...origin/main [behind 1]` do automation tạo thêm commit build trên origin.

Khi dùng tài liệu này trong lần sau, luôn kiểm tra lại trạng thái git hiện tại thay vì dựa vào ghi chú cũ.
