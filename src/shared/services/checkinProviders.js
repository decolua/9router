/**
 * 9router 每日签到 —— 各 provider 的**纯协议实现层**。
 *
 * ## 这个模块是什么
 *
 * 「自动签到」在 9router 上是**新增能力**（上游 v0.5.99 全仓无任何 checkin 实现，
 * 见 `docs/checkin-feature.md` 的调研结论）。本文件只做一件事：给定 provider 名 +
 * 该 provider 的一条连接凭据，发上游请求并返回一个**归一化的结果**。
 * 它**不碰数据库、不碰调度、不发任何 UI**，因此可以直接用 `node` 单文件跑测试
 * （这正是它能被逐 provider 取证的原因）。
 *
 * ## ⚠️ 实现判据（判错的代价是「静默漏签」）
 *
 * 1. **幂等判据一律在响应体，绝不在 HTTP 状态码。**
 *    codebuddy 重复领取返回 **HTTP 400** + `{code:10001}`；只看状态码会把
 *    「今天已签」误报成**失败**（进而被重试、甚至被当成凭据问题）。
 *    已实测：7 个真实账号全部走到这条分支。
 *
 * 2. **不要用 `response.json()`。**
 *    凭据失效时腾讯网关回的是 **HTML 错误页**，`json()` 抛
 *    `Unexpected token '<'` —— 用户看不出真正原因是「需要重新登录」。
 *    故一律 `text()` + 手动 `JSON.parse`，失败时带上 HTTP 状态码与片段。
 *
 * 3. **「没东西可领」≠「已经领过」。**
 *    Qoder 的判据必须是「存在 `actionType==='CLAIM_BENEFIT'` 且
 *    `claimStatus==='CLAIMED'` 的条目」，**不能**写成「没有可领项即为已领」——
 *    后者会在「活动还没刷新」「请求头不完整服务端不下发」时误报已领，
 *    而这个方向的错误是**不可逆的**（用户当天真的漏领）。
 *    实测：`qoder-cn` 出现 `CLAIM_BENEFIT/CLAIMED` 形态，`qoder` 只有
 *    `VIEW_DETAILS` 两种形态，判据据此成立。
 *
 * 4. **`active` 恒为 `true`（拿到响应即 true）。**
 *    Qoder 在「今天已领」时会把 `campaigns` 清空并回 `showCampaign:false`。
 *    若按「列表非空」判 active，调用方会先命中「活动未开启」分支，
 *    把「今天已领」误报成「活动未开启」。
 *
 * 5. **逐账号串行，绝不并发。** 见 `checkinScheduler.js`。
 *
 * ## 关键行为差异（不是笔误）
 *
 * | provider | 幂等判据 | 幂等时的 HTTP |
 * |---|---|---|
 * | codebuddy-cn / intl | `code === 10001` / `1001` | **400** |
 * | qoder / qoder-cn | `replayed === true` | 200 |
 * | minimax | `claim_result === 2` | 200 |
 *
 * ## 时区
 *
 * codebuddy / qoder 的每日额度按 **UTC+8** 结算（服务端口径，与客户端时区无关）。
 * minimax **例外**：它按**客户端上报的 IANA 时区**结算，`timezone_id` 是必填
 * 查询参数，**不得套用 UTC+8**。
 */

/** 控制面请求超时（签到是写操作，给足时间但不无限等）。 */
const REQUEST_TIMEOUT_MS = 30_000;

/** UTC+8 偏移（毫秒）。与 Qoder 计费口径一致。 */
export const UTC8_OFFSET_MS = 8 * 3_600_000;

/**
 * 取「UTC+8 的当天日期」（`YYYY-MM-DD`）。
 *
 * ⚠️ 必须用**算术平移**而不是运行环境时区：日界归服务端（各渠道的每日额度按 UTC+8
 * 结算）。取运行环境时区会在容器时区不同时得到错的「今天」—— 偏东会提前把当天记为
 * 已跑（真的漏签），偏西会一天跑两次。
 */
export function utc8DateString(nowMs = Date.now()) {
  return new Date(nowMs + UTC8_OFFSET_MS).toISOString().slice(0, 10);
}

/** 取当前 IANA 时区名（MiniMax 用；客户端就是这么取的）。 */
export function resolveIanaTimezone(resolve) {
  try {
    const zone = (resolve || (() => Intl.DateTimeFormat().resolvedOptions().timeZone))();
    return typeof zone === "string" && zone.trim().length > 0 ? zone.trim() : "UTC";
  } catch {
    return "UTC";
  }
}

// ── 小工具（容忍上游改型） ───────────────────────────────────────────────────

function asRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined;
}

/** 读数字，兼容字符串形态（上游用字符串规避浮点）。非法 ⇒ undefined，**不编造 0**。 */
function looseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t === "") return undefined; // ⚠️ Number('') === 0，会把空串误读成 0
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function looseBool(v) {
  return v === true;
}

function looseString(v) {
  return typeof v === "string" ? v : "";
}

/**
 * 发一次请求并解析 JSON 文本体。
 *
 * 刻意**不用** `response.json()`：凭据失效时网关回 HTML，`json()` 的报错
 * (`Unexpected token '<'`) 对用户毫无意义。这里先 `text()` 再解析，
 * 非 JSON 时带 HTTP 状态码，让「401/403 → 凭据问题」这条线索浮出来。
 */
async function requestJson(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    return { ok: false, status: 0, message: `Network request failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, status: response.status, message: `Failed to read response: ${error instanceof Error ? error.message : String(error)}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const snippet = text.trim().slice(0, 120).replace(/\s+/g, " ");
    const hint = response.status === 401 || response.status === 403
      ? `Credential expired (HTTP ${response.status}). Reconnect this account.`
      : `Upstream returned a non-JSON response (HTTP ${response.status}): ${snippet}`;
    return { ok: false, status: response.status, message: hint };
  }

  const record = asRecord(parsed);
  if (record === undefined) {
    return { ok: false, status: response.status, message: "Response is not a JSON object" };
  }
  return { ok: true, status: response.status, body: record };
}

/**
 * HTTP 层面的**凭据失效**判定。
 *
 * ⚠️ 为什么必须单独判：`requestJson` 只看「能不能解析成 JSON 对象」，因此
 * `401 {"error":"invalid access token"}` 这种响应会被判成 `ok:true`，再由各
 * provider 的解析器默认成「今天没签」—— 于是**凭据失效被静默显示为「未签到」**，
 * 用户看到的是「签到没生效」而不是「该重新登录了」。实测 minimax 账号
 * （已失效 `mmoat_` 凭据）精确命中这个形状。
 *
 * ⚠️ 为什么不会误伤 codebuddy 的幂等分支：那里重复领取是 **HTTP 400**
 * （`code:10001`），不是 401/403。故把 401/403 当硬失败是安全的。
 */
function credentialFailure(status) {
  return status === 401 || status === 403;
}

// ── 归一化结果 ──────────────────────────────────────────────────────────────

/** 归一化的签到结果。`kind` 的四种取值即「已领 / 本次领到 / 无资格 / 失败」。 */
export function claimed(credit, extra = {}) {
  return { kind: "claimed", credit: typeof credit === "number" && Number.isFinite(credit) ? credit : 0, ...extra };
}
export function alreadyClaimed(message = "Already checked in today") {
  return { kind: "already-claimed", message };
}
export function inactive(message) {
  return { kind: "inactive", message };
}
export function failed(code, message) {
  return { kind: "failed", code, message };
}

// ── CodeBuddy（中国版 + 国际版，协议同型） ─────────────────────────────────────

/**
 * CodeBuddy 的签到端点。
 *
 * 中国版 `copilot.tencent.com`（**已用 7 个真实账号实测**）；
 * 国际版 `www.codebuddy.ai` —— 与 CN 同型（其 registry 的 `transport.usage.url`
 * 就是同一条 `/v2/billing/meter/get-user-resource` 路径，只是换了域名）。
 * ⚠️ 国际版**未经真实账号实测**（开发时可用的账号里没有该渠道），归为「结构同型」。
 */
const CODEBUDDY_CHECKIN_STATUS_PATH = "/v2/billing/meter/checkin-activity-status";
const CODEBUDDY_DAILY_CHECKIN_PATH = "/v2/billing/meter/daily-checkin";

/** 业务码：重复领取（注意有两个值，两个站点各用一个）。 */
const CB_CODE_ALREADY_CLAIMED = 10001;
const CB_CODE_ALREADY_CLAIMED_ALT = 1001;
/** 业务码：无领取资格 / 活动结束。 */
const CB_CODE_NO_QUALIFICATION = 1002;
const CB_CODE_ACTIVITY_ENDED = 1003;

function codebuddyHeaders(data) {
  const psd = asRecord(data.providerSpecificData) || {};
  const headers = {
    Authorization: `Bearer ${data.accessToken || ""}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    // X-Domain 与请求的 baseURL 必须一致，否则前后矛盾（服务端按域名判区域）。
    "X-Domain": looseString(psd.domain) || "copilot.tencent.com",
    "X-Product": "SaaS",
    "X-Product-Code": "codebuddy",
    "User-Agent": "CodeBuddyIDE/1.106.1",
  };
  const userId = looseString(psd.userId);
  if (userId) headers["X-User-Id"] = userId;
  const enterpriseId = looseString(psd.enterpriseId);
  if (enterpriseId) {
    headers["X-Enterprise-Id"] = enterpriseId;
    headers["X-Tenant-Id"] = enterpriseId;
  }
  return headers;
}

async function codebuddyStatus(host, data) {
  const res = await requestJson(`${host}${CODEBUDDY_CHECKIN_STATUS_PATH}`, {
    method: "POST",
    headers: codebuddyHeaders(data),
    body: "{}",
  });
  if (!res.ok) return { ok: false, message: res.message };
  const { body } = res;
  if (credentialFailure(res.status)) {
    return { ok: false, message: `Credential expired (HTTP ${res.status}). Reconnect this account.` };
  }
  // ⚠️ 上游 msg 是中文，只作 detail（见 codebuddyClaim 的同类说明）。
  if (looseNumber(body.code) !== 0) {
    const upstream = looseString(body.msg);
    return { ok: false, message: "Status query failed", ...(upstream ? { detail: upstream } : {}) };
  }
  const d = asRecord(body.data);
  if (d === undefined) return { ok: false, message: "Status response is missing the data field" };
  return {
    ok: true,
    active: looseBool(d.active),
    todayCheckedIn: looseBool(d.today_checked_in),
    streakDays: looseNumber(d.streak_days) ?? 0,
    dailyCredit: looseNumber(d.daily_credit) ?? 0,
    todayCredit: looseNumber(d.today_credit) ?? 0,
    totalCredits: looseNumber(d.total_credits) ?? 0,
    endTime: looseString(d.end_time),
  };
}

async function codebuddyClaim(host, data) {
  // ⚠️ 判据是响应体的 code，不是 HTTP 状态码（重复领取 = HTTP 400 + code 10001）。
  const res = await requestJson(`${host}${CODEBUDDY_DAILY_CHECKIN_PATH}`, {
    method: "POST",
    headers: codebuddyHeaders(data),
    body: "{}",
  });
  if (!res.ok) return failed(-1, res.message);

  const { body } = res;
  if (credentialFailure(res.status)) {
    return failed(-1, `Credential expired (HTTP ${res.status}). Reconnect this account.`);
  }
  const code = looseNumber(body.code) ?? -1;
  // ⚠️ 上游的 `msg` 是**中文**（如「今天已签到，请明天再来」）。它不能直接当
  // 展示文案：i18n 只翻英文原文，中文会原样留在英文界面里。故把它放进
  // `detail`（进日志、便于对照上游），`message` 用英文。
  const upstream = looseString(body.msg);
  const detail = upstream ? { detail: upstream } : {};

  if (code === CB_CODE_ALREADY_CLAIMED || code === CB_CODE_ALREADY_CLAIMED_ALT) {
    return { ...alreadyClaimed("Already checked in today"), ...detail };
  }
  if (code === CB_CODE_NO_QUALIFICATION || code === CB_CODE_ACTIVITY_ENDED) {
    return { ...inactive("Not eligible to claim right now"), ...detail };
  }
  if (code !== 0) return { ...failed(code, "Claim failed"), ...detail };

  const d = asRecord(body.data);
  if (d === undefined) return failed(code, "Claim response is missing the data field");
  return claimed(looseNumber(d.credit) ?? 0, {
    streakDays: looseNumber(d.streak_days) ?? 0,
    ...(looseString(d.message) ? { delayedMessage: looseString(d.message) } : {}),
  });
}

// ── Qoder（国际版 + 中国版，协议同型） ────────────────────────────────────────

const QODER_CAMPAIGNS_PATH = "/sash/api/v1/me/campaigns";

/**
 * Qoder `/sash/` 端点的公共请求头。
 *
 * ⚠️ 两个 machine 头**都需要**才可能拿到可领活动（消融实测：缺任一条，
 * 服务端只回 `VIEW_DETAILS`，**不下发** `CLAIM_BENEFIT`）。9router 的连接里
 * `machineId` 是登录时持久化的 UUID，正好可作 token/type 的来源。
 * 拿不到时**不发空头**——漏发是安全降级，发空串可能被判非法设备。
 */
function qoderHeaders(data) {
  const psd = asRecord(data.providerSpecificData) || {};
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${data.accessToken || ""}`,
    "User-Agent": "Qoder",
    // '10' = 桌面 app 身份；用 '5'（CLI）时服务端恒不下发可领活动。
    "Cosy-ClientType": "10",
  };
  const machineId = looseString(psd.machineId);
  if (machineId) {
    headers["Cosy-MachineToken"] = machineId;
    headers["Cosy-MachineType"] = "5";
  }
  return headers;
}

function parseQoderCampaigns(body) {
  const campaigns = Array.isArray(body.campaigns) ? body.campaigns.filter((c) => asRecord(c) !== undefined) : [];
  return campaigns.map((c) => ({
    campaignId: looseString(c.campaignId),
    campaignKey: looseString(c.campaignKey),
    actionType: looseString(c.actionType),
    claimStatus: looseString(c.claimStatus),
    amount: looseNumber(asRecord(c.benefit)?.amount),
  }));
}

function qoderClaimable(campaigns) {
  return campaigns.filter((c) => c.actionType === "CLAIM_BENEFIT" && c.claimStatus === "CLAIMABLE" && c.campaignId);
}

/**
 * 「今天已领」的判据：存在**领分类**活动且其状态为 `CLAIMED`。
 *
 * ⚠️ 不能写成「没有可领项即为已领」（见模块头第 3 条）。
 * ⚠️ 也不能据此跳过 claim —— 服务端对重复领取是幂等的（回 `replayed:true`），
 *    误判成「未领」最多多一次无害请求；误判成「已领」则当天真的漏领。
 *    故状态只用于**呈现**，claim 仍照发（由 `replayed` 兜底）。
 */
function qoderTodayCheckedIn(campaigns) {
  return campaigns.some((c) => c.actionType === "CLAIM_BENEFIT" && c.claimStatus === "CLAIMED");
}

async function qoderCampaigns(host, data) {
  const res = await requestJson(`${host}${QODER_CAMPAIGNS_PATH}`, {
    method: "GET",
    headers: qoderHeaders(data),
  });
  if (!res.ok) return { ok: false, message: res.message };
  if (credentialFailure(res.status)) {
    return { ok: false, message: `Credential expired (HTTP ${res.status}). Reconnect this account.` };
  }
  return { ok: true, campaigns: parseQoderCampaigns(res.body) };
}

async function qoderClaimOne(host, data, campaignId) {
  const res = await requestJson(`${host}${QODER_CAMPAIGNS_PATH}/${encodeURIComponent(campaignId)}/claim`, {
    method: "POST",
    headers: { ...qoderHeaders(data), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return failed(-1, res.message);
  if (credentialFailure(res.status)) {
    return failed(-1, `Credential expired (HTTP ${res.status}). Reconnect this account.`);
  }

  // ⚠️ 幂等判据是 `replayed`：重复领取同样 200，但 replayed=true 且不含 benefit。
  if (looseBool(res.body.replayed)) return alreadyClaimed("Already claimed today");
  const d = asRecord(res.body.data) || res.body;
  const amount = looseNumber(asRecord(d.benefit)?.amount);
  return claimed(amount ?? 0);
}

// ── MiniMax ────────────────────────────────────────────────────────────────

const MINIMAX_SIGNIN_STATUS_PATH = "/minimax-cloud/api/v1/signin/status";
const MINIMAX_SIGNIN_CLAIM_PATH = "/minimax-cloud/api/v1/signin/claim";

/** 单日状态（asar `SigninDayStatus`）。 */
const MINIMAX_DAY = { Upcoming: 1, Claimable: 2, Claimed: 3, Disabled: 4 };
/** 领取结果（asar `SigninClaimResult`）。 */
const MINIMAX_CLAIM_RESULT = { Claimed: 1, AlreadyClaimed: 2 };

function minimaxHeaders(data) {
  // MiniMax 的业务端点**只需 Bearer**（不需要 machine 头或签名）。
  // apikey 型连接的 `apiKey` 本身就是 OAuth access token（`mmoat_` 前缀）。
  return {
    Authorization: `Bearer ${data.accessToken || data.apiKey || ""}`,
    Accept: "application/json",
  };
}

/** 拆信封：有 `data` 对象就用它，否则用顶层（`credit/details` 是平铺的）。 */
function unwrapEnvelope(payload) {
  const nested = asRecord(payload.data);
  return nested === undefined ? payload : nested;
}

/**
 * 业务码在 `base_resp.status_code`，且 `invalid timezone_id` 也是 **HTTP 200**
 * —— 只看 HTTP 状态码会把它当成成功。
 */
function minimaxBusinessError(body) {
  const base = asRecord(body.base_resp);
  if (base === undefined) return undefined;
  const code = looseNumber(base.status_code);
  if (code === undefined || code === 0) return undefined;
  // ⚠️ `status_msg` 可能是中文，只作 detail（见 codebuddyClaim 的同类说明）。
  const upstream = looseString(base.status_msg);
  return { code, message: `Upstream error ${code}`, ...(upstream ? { detail: upstream } : {}) };
}

function withTimezone(base, path, timezoneId) {
  const url = new URL(`${base}${path}`);
  url.searchParams.set("timezone_id", timezoneId);
  return url.toString();
}

async function minimaxStatus(host, data, timezoneId) {
  const res = await requestJson(withTimezone(host, MINIMAX_SIGNIN_STATUS_PATH, timezoneId), {
    method: "GET",
    headers: minimaxHeaders(data),
  });
  if (!res.ok) return { ok: false, message: res.message };
  if (credentialFailure(res.status)) {
    return { ok: false, message: `Credential expired (HTTP ${res.status}). Reconnect this account.` };
  }
  const biz = minimaxBusinessError(res.body);
  if (biz) return { ok: false, message: biz.message, ...(biz.detail ? { detail: biz.detail } : {}) };

  const panel = asRecord(unwrapEnvelope(res.body).panel);
  const days = Array.isArray(panel?.days) ? panel.days : [];
  const today = days.find((d) => looseBool(asRecord(d)?.isToday)) || days[0];
  return {
    ok: true,
    todayCheckedIn: looseNumber(asRecord(today)?.status) === MINIMAX_DAY.Claimed,
    streakDays: looseNumber(asRecord(today)?.streakDays) ?? 0,
  };
}

async function minimaxClaim(host, data, timezoneId) {
  const res = await requestJson(withTimezone(host, MINIMAX_SIGNIN_CLAIM_PATH, timezoneId), {
    method: "POST",
    headers: { ...minimaxHeaders(data), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return failed(-1, res.message);
  if (credentialFailure(res.status)) {
    return failed(-1, `Credential expired (HTTP ${res.status}). Reconnect this account.`);
  }

  const biz = minimaxBusinessError(res.body);
  // ⚠️ 必须把 `detail`（上游原文）一起带到 outcome 上：丢了它，`biz` 里保留的
  // 上游说明就到不了日志，排查时只剩「Upstream error 1004」这种无上下文的码。
  if (biz) {
    return { ...failed(biz.code, biz.message), ...(biz.detail ? { detail: biz.detail } : {}) };
  }

  const payload = unwrapEnvelope(res.body);
  const claimResult = looseNumber(payload.claim_result);

  // ⚠️ 幂等：重复领取返回 2（AlreadyClaimed）。
  if (claimResult === MINIMAX_CLAIM_RESULT.AlreadyClaimed) return alreadyClaimed("Already checked in today");
  if (claimResult !== MINIMAX_CLAIM_RESULT.Claimed) {
    return failed(-1, "Check-in response is missing a valid claim_result");
  }
  // ⚠️ credit 取 points（总数，已含 bonus_points）。
  return claimed(looseNumber(payload.points) ?? 0);
}

// ── provider 表 ────────────────────────────────────────────────────────────

/**
 * 有签到实现的 provider。
 *
 * `run` 的契约：**永不抛错**，失败也返回 `failed` outcome
 * （批量签到时单账号失败不得中断其余账号）。
 */
const IMPLEMENTATIONS = {
  "codebuddy-cn": {
    label: "CodeBuddy CN",
    host: "https://copilot.tencent.com",
    status: (data) => codebuddyStatus("https://copilot.tencent.com", data),
    claim: (data) => codebuddyClaim("https://copilot.tencent.com", data),
    unit: "credit",
    verified: true,
  },
  "codebuddy-intl": {
    label: "CodeBuddy",
    host: "https://www.codebuddy.ai",
    status: (data) => codebuddyStatus("https://www.codebuddy.ai", data),
    claim: (data) => codebuddyClaim("https://www.codebuddy.ai", data),
    unit: "credit",
    verified: false,
    // ⚠️ The wording must stay environment-independent. `verified` asserts that
    // WE have not validated this implementation against a live account — it must
    // never claim that some particular host has no account for this provider,
    // because that stops being true on another deployment and the UI then shows
    // "1 account" next to "no account available".
    note: "Protocol matches CN (same paths, different host), but this implementation has not been verified against a real account.",
  },
  qoder: {
    label: "Qoder",
    host: "https://openapi.qoder.sh",
    status: async (data) => {
      const r = await qoderCampaigns("https://openapi.qoder.sh", data);
      if (!r.ok) return { ok: false, message: r.message };
      return {
        ok: true,
        // ⚠️ active 恒 true（拿到响应即 true），见模块头第 4 条。
        todayCheckedIn: qoderTodayCheckedIn(r.campaigns),
        claimable: qoderClaimable(r.campaigns).length,
      };
    },
    claim: async (data) => {
      const r = await qoderCampaigns("https://openapi.qoder.sh", data);
      if (!r.ok) return failed(-1, r.message);
      return claimQoderCampaignList("https://openapi.qoder.sh", data, r.campaigns);
    },
    unit: "credit",
    verified: true,
  },
  "qoder-cn": {
    label: "Qoder CN",
    host: "https://openapi.qoder.com.cn",
    status: async (data) => {
      const r = await qoderCampaigns("https://openapi.qoder.com.cn", data);
      if (!r.ok) return { ok: false, message: r.message };
      return {
        ok: true,
        todayCheckedIn: qoderTodayCheckedIn(r.campaigns),
        claimable: qoderClaimable(r.campaigns).length,
      };
    },
    claim: async (data) => {
      const r = await qoderCampaigns("https://openapi.qoder.com.cn", data);
      if (!r.ok) return failed(-1, r.message);
      return claimQoderCampaignList("https://openapi.qoder.com.cn", data, r.campaigns);
    },
    unit: "credit",
    verified: true,
  },
  minimax: {
    label: "MiniMax",
    host: "https://agent.minimax.cn",
    status: (data, ctx) => minimaxStatus("https://agent.minimax.cn", data, ctx.timezoneId),
    claim: (data, ctx) => minimaxClaim("https://agent.minimax.cn", data, ctx.timezoneId),
    unit: "credit",
    verified: false,
    // 同样只陈述「未经真实领取验证」，不描述某台机器上有没有账号（换台机器就不对了）。
    note: "Endpoints and envelope shape follow the source, but a live claim has not been verified (the credential used during development was expired).",
  },
};

/**
 * 逐条 claim Qoder 的活动；**第一条成功即停**（一个账号一天只有一份日签）。
 *
 * 全部都是 `replayed`（此前已领）时返回 already-claimed；
 * 一条可领的都没有时返回 `inactive`（**不是** already-claimed —— 那会让当天
 * 真的漏领，而这个方向不可逆）。
 */
async function claimQoderCampaignList(host, data, campaigns) {
  const claimable = qoderClaimable(campaigns);
  if (claimable.length === 0) {
    return qoderTodayCheckedIn(campaigns)
      ? alreadyClaimed("Already claimed today")
      : inactive("No claimable activity right now");
  }
  let last = inactive("No claimable activity right now");
  for (const c of claimable) {
    const outcome = await qoderClaimOne(host, data, c.campaignId);
    if (outcome.kind === "claimed") return outcome;
    last = outcome;
    if (outcome.kind === "failed") return outcome;
  }
  return last;
}

/** 明确**不支持**签到的 provider 及原因（判定时不发任何上游请求）。 */
const UNSUPPORTED = {
  cline: "Cline does not support daily check-in (no check-in endpoint upstream)",
  workbuddy: "WorkBuddy does not support daily check-in (no check-in endpoint upstream)",
  raccoon: "Raccoon Work does not support daily check-in (credits are granted server-side)",
};

/** 该 provider 是否有签到实现。 */
export function isCheckinSupported(provider) {
  return Object.prototype.hasOwnProperty.call(IMPLEMENTATIONS, provider);
}

/** 该 provider 的展示名（无实现时回退 provider id）。 */
export function checkinLabel(provider) {
  return IMPLEMENTATIONS[provider]?.label || provider;
}

/**
 * 所有有实现的 provider（供 UI / 调试枚举）。
 *
 * ⚠️ `note` 是**直接渲染到仪表盘**的文本，因此必须是**英文**：运行时 i18n 走
 * 「英文原文 → 译文」查表（src/i18n/runtime.js），中文原文永远不会被翻译，
 * 会原样留在英文界面里（实测第一版就是这样）。理由本身仍用中文写在注册表的
 * 源码注释里，那里是给维护者看的，不进 UI。
 */
export function listCheckinProviders() {
  return Object.keys(IMPLEMENTATIONS).map((id) => ({
    id,
    label: IMPLEMENTATIONS[id].label,
    verified: IMPLEMENTATIONS[id].verified === true,
    ...(IMPLEMENTATIONS[id].note ? { note: IMPLEMENTATIONS[id].note } : {}),
  }));
}

/** 不支持签到的原因（支持则返回 undefined）。 */
export function unsupportedReason(provider) {
  return UNSUPPORTED[provider];
}

/**
 * 签到状态（只读，**不发写请求**）。
 *
 * @returns `{ ok: true, todayCheckedIn, ... }` 或 `{ ok: false, message }`。
 *   失败与「余额为 0」严格区分 —— 网络失败不等于「今天没签」。
 */
export async function checkinStatus(provider, data, ctx = {}) {
  const impl = IMPLEMENTATIONS[provider];
  if (impl === undefined) {
    const reason = unsupportedReason(provider);
    return { ok: false, message: reason || `${provider} has no check-in implementation` };
  }
  const context = { timezoneId: ctx.timezoneId || resolveIanaTimezone() };
  try {
    return await impl.status(data, context);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 执行一次签到领取（**写操作**；每账号每天只应调用一次）。
 *
 * **永不抛错** —— 失败也返回 `failed` outcome。
 */
export async function claimCheckin(provider, data, ctx = {}) {
  const impl = IMPLEMENTATIONS[provider];
  if (impl === undefined) {
    const reason = unsupportedReason(provider);
    return failed(-1, reason || `${provider} has no check-in implementation`);
  }
  const context = { timezoneId: ctx.timezoneId || resolveIanaTimezone() };
  try {
    return await impl.claim(data, context);
  } catch (error) {
    return failed(-1, error instanceof Error ? error.message : String(error));
  }
}

/**
 * 把 outcome 整理成一句人话（UI / 日志共用）。
 *
 * ⚠️ 这是展示文案的**唯一收口**，因此在这里再兜一道：若 `message` 含中日韩字符，
 * 说明有上游原文漏进了展示路径（i18n 只翻英文原文，中文会原样留在英文界面里），
 * 此时回落到英文默认文案。各 provider 已把上游原文放进 `detail`，这一层是防御性的
 * —— 新增 provider 时忘了这条规则也不会把中文漏到界面上（有回归用例守着）。
 */
const CJK_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

function englishOr(message, fallback) {
  return typeof message === "string" && message.length > 0 && !CJK_RE.test(message)
    ? message
    : fallback;
}

export function describeOutcome(outcome) {
  switch (outcome?.kind) {
    case "claimed":
      return `Checked in +${outcome.credit}`;
    case "already-claimed":
      return englishOr(outcome.message, "Already checked in today");
    case "inactive":
      return englishOr(outcome.message, "No claimable activity");
    case "failed":
      return englishOr(outcome.message, "Check-in failed");
    default:
      return "Unknown outcome";
  }
}
