> **QUY TẮC CHANGELOG: TUYỆT ĐỐI KHÔNG dùng `CHANGELOG.md`.**
> Fork `diepxuan/9router` chỉ dùng file này làm changelog duy nhất.
> Mọi thay đổi (provider, feature, fix, update) đều ghi vào đây, tại section tương ứng.
> Mục đích: giúp mọi aiagent/session (kể cả aiagent hoặc session mới khởi tạo) hiểu ngay fork này custom những gì, thay đổi những gì, không cần đọc CHANGELOG gốc.

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
grep -R "alicode\|alicode-intl\|manualQuota\|getUsageOverride\|isDiepXuanUsageEligible" -n src open-sse docs .github scripts | head -120
grep -R "EnhancedConsoleLog\|ProviderLimits\|QuotaProgressBar\|QuotaTable" -n src/app src/diepxuan/app | head -120
grep -R "resetComboFailTracker\|combo fallback immediately tries next model" -n src open-sse tests | head -120
grep -R "DonateModal\|volunteer_activism\|Donate" -n src/shared/components/Header.js src/shared/components/DonateModal.js || true
grep -R "firstCombo\|No provider/model specified\|Unknown provider" -n src/sse/handlers/search.js src/sse/handlers/fetch.js

# 4. Syntax check file custom chính
node --check src/diepxuan/lib/db/repos/manualQuotaRepo.js
node --check src/app/api/usage/[connectionId]/route.js
node --check src/sse/handlers/search.js
node --check src/sse/handlers/fetch.js
node --check src/app/(dashboard)/dashboard/console-log/page.js
node --check src/diepxuan/app/api/console-logs-structured/route.js
node --check src/app/(dashboard)/dashboard/quota/page.js
node --check tests/unit/combo-immediate-fallback-node.test.mjs
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
- Header không còn `DonateModal`, `volunteer_activism`, `Donate`.
- Không có conflict marker. Script tự kiểm tra conflict marker theo đầu dòng `<<<<<<<`, `=======`, `>>>>>>>` để tránh false positive với comment separator hoặc command grep trong tài liệu.

Quy tắc docs khi rebase:
- Không chỉnh sửa lan man các file docs upstream/fork khác.
- Chỉ dùng `docs/CUSTOM-FEATURES-MERGE-CHECKLIST.md` làm tài liệu kiểm tra fork docs/custom feature sau rebase.
- Nếu cần thêm guardrail cho custom feature, cập nhật `docs/custom-features.manifest.json`, `scripts/diepxuan/check-custom-features.mjs` và chính checklist này; không chạm các docs khác trừ khi Sếp yêu cầu riêng.

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
- Enhanced quota dashboard: mở `/dashboard/quota`, kiểm tra ProviderLimits custom render đủ quota windows.
- Enhanced console log: mở `/dashboard/console-log`, kiểm tra `EnhancedConsoleLog` và structured log API hoạt động.
- Search/fetch fallback: gọi `/api/v1/search` và `/api/v1/web/fetch` khi có combo phù hợp.
- Combo fallback tracker: đổi settings liên quan combo và kiểm tra `resetComboFailTracker()` còn được gọi.
- Combo curl snippet: mở combo detail page, kiểm tra origin trong command.
- Fork branding header: kiểm tra Header giống upstream nhất có thể nhưng không còn Donate UI/modal.
- CLI package: hiện xem là phần master fork, không coi là custom feature mới; chỉ kiểm tra khi thay đổi CLI/package.

---

## 12. Các dấu hiệu merge hỏng cần xử lý ngay

`docs/custom-features.manifest.json` có nhóm `invariants` để checker fail nhanh khi rebase làm mất hook nền trong base files. Các invariant này phải được giữ đồng bộ với contract hook mỏng hiện tại.

- `src/shared/constants/providers.js` mất hook `extendApiKeyProviders(...)` hoặc `src/shared/constants/config.js` mất hook `extendProviderEndpoints(...)`.
- `/api/usage/[connectionId]` không còn gọi `handleUsageOverrideResponse()` trước OAuth/API usage flow.
- `manualQuotaRepo.js` mất registry `alicode` / `alicode-intl`.
- `/dashboard/quota` không còn import `@/diepxuan/app/dashboard/usage/components/ProviderLimits`.
- `ProviderLimits` custom thiếu `QuotaProgressBar`, `QuotaTable`, `ProviderLimitCard`, hoặc `extendUsageSupportedProviders(...)`.
- `/dashboard/console-log` không còn import/render `EnhancedConsoleLog`.
- `src/diepxuan/app/api/console-logs-structured/route.js` hoặc `EnhancedConsoleLog.jsx` bị mất.
- `settings/route.js` mất `resetComboFailTracker()` khi settings đổi.
- `tests/unit/combo-immediate-fallback-node.test.mjs` bị mất hoặc không còn gọi `handleComboChat`.
- `search.js` / `fetch.js` mất hook `handleDiepXuanWebComboFallback()` trước fallback lỗi thiếu/không rõ provider.
- `src/shared/components/DonateModal.js` xuất hiện trở lại, hoặc `Header.js` có lại `DonateModal`, `volunteer_activism`, `Donate`.
- `npm run build` fail tại route usage/search/fetch/provider/quota/console-log.
- Có conflict marker trong `src`, `open-sse`, `cli`, `docs`.
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

---

## 14. Auto Context Length Info (2026-06-28)

### Mục đích
Tự động thu thập và cập nhật `context_length` (max tokens) cho mọi model, để:
- `/v1/models` endpoint trả về `context_length` chính xác cho Codex/OpenAI clients
- Combo fallback không thử model nhỏ trước model lớn một cách mù quáng
- Hook cho proactive truncation (tương lai) sử dụng context info

### Nguồn dữ liệu (theo thứ tự ưu tiên)
1. **Provider `/v1/models` API** — 1 call / 24h, cache vào SQLite
2. **Parse 400 error** — Học từ lỗi `maximum context length is X tokens`
3. **MODEL_INFO static** — Fallback cuối cùng

### Files cần giữ (fork layer)

```
open-sse/diepxuan/contextLength/
  cache.js          -- SQLite cache, priority: error > api > static
  modelsApi.js      -- Fetch NVIDIA /v1/models, parse max_model_len
  errorParser.js    -- Parse 400 "max context" error
  index.js          -- Public API: getContextLength, getContextLengthBatch
```

### Injection points (base files)

| Base file | Thay đổi |
|-----------|----------|
| `src/app/api/v1/models/route.js` | Register NVIDIA resolver + add `context_length` field |
| `open-sse/services/accountFallback.js` | `checkFallbackError(status, error, backoff, modelId)` — cache 400 |
| `open-sse/services/combo.js` | Pass `modelStr` to `checkFallbackError` |

### Checklist khi rebase upstream

```bash
# Files còn nguyên
test -f open-sse/diepxuan/contextLength/index.js
test -f open-sse/diepxuan/contextLength/cache.js
test -f open-sse/diepxuan/contextLength/modelsApi.js
test -f open-sse/diepxuan/contextLength/errorParser.js

# Pattern còn nguyên trong base files
grep -q "resolveProviderModelsWithContext" src/app/api/v1/models/route.js
grep -q "updateContextLengthFromError" open-sse/services/accountFallback.js
grep -q "diepxuan: capture 400" open-sse/services/accountFallback.js

# Smoke test
curl -s http://localhost:20128/api/v1/models | grep -q "context_length"
```

### Smoke test

1. Khởi động server, gọi `GET /v1/models` → tìm `nvidia/minimaxai/minimax-m2.7` → có `context_length`.
2. Trigger request vượt context (gửi 400K tokens) → nhận 400 → kiểm tra cache:
   ```bash
   sqlite3 /var/lib/9router/db/data.sqlite "SELECT model_id, context_length, source FROM model_context_info;"
   ```
3. Tắt `DIEPXUAN_ENABLED=false` → vẫn hoạt động (fallback MODEL_INFO).

---

## 15. CLI tools dynamic current-origin endpoint

### Mục đích

Dashboard CLI tools trong fork ưu tiên endpoint theo origin hiện tại của browser thay vì hard-code `localhost` hoặc ép `localhost` sang `127.0.0.1`. Điều này phục vụ môi trường nội bộ dùng hostname/domain như `9router.diepxuan.corp`, reverse proxy, tunnel hoặc VM IP động.

Base UI chỉ giữ bridge mỏng; policy nằm trong fork layer:

Files fork layer:
- `src/diepxuan/app/dashboard/cli-tools/baseUrl.js`

Base files có bridge:
- `src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/DeepSeekTuiToolCard.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/JcodeToolCard.js`
- `src/app/(dashboard)/dashboard/cli-tools/components/OpenClawToolCard.js`

### Logic cần giữ

Trong `src/diepxuan/app/dashboard/cli-tools/baseUrl.js` phải có:

```js
getCurrentBrowserOrigin()
getCliToolBaseUrl()
getToolDetailBaseUrl()
```

Base files chỉ nên import helper:

```js
@/diepxuan/app/dashboard/cli-tools/baseUrl
```

Không đưa lại literal fallback cứng vào component nếu không có lý do rõ ràng:
- `http://localhost:20128`
- `http://127.0.0.1:20128`
- `url.replace("://localhost", "://127.0.0.1")`

### Checklist sau merge upstream

```bash
grep -R "getCliToolBaseUrl\|getCurrentBrowserOrigin\|getToolDetailBaseUrl" -n src/diepxuan/app/dashboard/cli-tools src/app/\(dashboard\)/dashboard/cli-tools | head -80
grep -R "127.0.0.1:20128\|localhost:20128\|://127.0.0.1" -n src/app/\(dashboard\)/dashboard/cli-tools || true
node --check src/diepxuan/app/dashboard/cli-tools/baseUrl.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/BaseUrlSelect.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/DefaultToolCard.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/DeepSeekTuiToolCard.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/HermesToolCard.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/JcodeToolCard.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/OpenClawToolCard.js
```

### Smoke test khuyến nghị

1. Mở dashboard bằng hostname thực tế, ví dụ `http://9router.diepxuan.corp:20128` hoặc reverse proxy tương ứng.
2. Mở `/dashboard/cli-tools` và một tool detail page.
3. Kiểm tra Base URL mặc định trong snippet/settings là origin hiện tại, không bị đổi sang `127.0.0.1`.
4. Apply settings cho Hermes/JCode/OpenClaw/DeepSeek TUI nếu tool có sẵn, kiểm tra file config ghi đúng origin.

---

## 16. Codex subagent config description

### Mục đích

Fork thêm `description` cho `[agents.subagent]` khi tạo config Codex CLI, để subagent có mô tả rõ ràng trong config sinh ra từ dashboard/API.

Files fork layer:
- `src/diepxuan/app/dashboard/cli-tools/codex.js`

Base files có bridge:
- `src/app/(dashboard)/dashboard/cli-tools/components/CodexToolCard.js`
- `src/app/api/cli-tools/codex-settings/route.js`

### Logic cần giữ

Trong fork layer phải có:

```js
CODEX_SUBAGENT_DESCRIPTION
extendCodexSubagentConfig()
```

Base files chỉ import helper/value từ:

```js
@/diepxuan/app/dashboard/cli-tools/codex
```

### Checklist sau merge upstream

```bash
grep -R "CODEX_SUBAGENT_DESCRIPTION\|extendCodexSubagentConfig" -n src/diepxuan/app/dashboard/cli-tools src/app/\(dashboard\)/dashboard/cli-tools/components/CodexToolCard.js src/app/api/cli-tools/codex-settings/route.js
node --check src/diepxuan/app/dashboard/cli-tools/codex.js
node --check src/app/\(dashboard\)/dashboard/cli-tools/components/CodexToolCard.js
node --check src/app/api/cli-tools/codex-settings/route.js
```

### Smoke test khuyến nghị

1. Mở Codex tool card.
2. Copy manual config hoặc apply settings.
3. Kiểm tra `[agents.subagent]` có cả `description` và `model`.

---

## 17. Root `dev.sh` nội bộ DiepXuan

### Mục đích

`dev.sh` ở root repo là script vận hành môi trường dev nội bộ của anh, giữ nguyên ở root để tiện dùng. Đây là custom fork, không tách sang `scripts/diepxuan`.

Script quản lý:
- detect VM IP động qua `ip route` hoặc `hostname -I`.
- hosts entry cho `9router.diepxuan.corp` với marker `# 9router-dev managed`.
- systemd service `9router-dev`.
- stop/start service production `9router` khi start/stop dev để tránh tranh port.

### File cần giữ

- `dev.sh`

### Checklist sau merge upstream

```bash
test -x dev.sh && echo "dev.sh executable OK"
grep -n "9router.diepxuan.corp\|9router-dev\|HOSTS_MARKER\|get_vm_ip\|stop_prod_service\|start_prod_service" dev.sh
bash -n dev.sh
```

### Lưu ý vận hành

- Không tự ý chuyển `dev.sh` sang thư mục khác.
- Không tự ý chạy `./dev.sh start|stop|restart` trong session agent nếu anh chưa yêu cầu, vì script cần root và chạm `/etc/hosts`/systemd.
- Khi rebase upstream, nếu `dev.sh` conflict thì ưu tiên giữ behavior nội bộ ở trên.
