# Claude Code CLI(`-p`) 프로바이더 프롬프트 캐시 — 현황 분석과 설계

작성일: 2026-09-24. 대상 코드: `open-sse/executors/claude-cli.js` 및 형제 모듈, CLI 2.1.281 기준.
짝 문서: [작업 계획서](./2026-09-24-claude-cli-prompt-cache-plan.md) — 구현 순서, 파일별 변경, 검증 기준.

## 0. 결론 먼저

- `claude-cli` 프로바이더는 매 요청마다 대화 전체를 다시 처리한다. 프롬프트 캐시가 사실상 안 먹는다. 원인은 CLI가 `cache_control` 브레이크포인트를 "자기가 덧붙인 per-request 컨텍스트" 뒤에 찍고, 다음 요청에서 9Router가 그 컨텍스트 없이 히스토리를 재전송하기 때문이다. (2절)
- 이전 작업자는 이를 고치려고 **loopback 캐시 릴레이**(`claudeCliAdmission.js`)를 만들었다. 릴레이는 단위 테스트는 통과하지만, Next 서버 안에서 실제 계정으로 돌리면 응답이 돌아오지 않아 `CLI_CLAUDE_CACHE_RELAY=0`(기본 off)으로 봉인된 채 중단됐다. 원인은 미확정. (3절)
- 제1 원칙은 **계정 Ban 회피**다. 즉 `claude -p`를 유지하고, 인증은 CLI에게 전부 맡기고, 업스트림 트래픽은 "진짜 Claude Code 세션"과 구별되지 않아야 한다. (4절)
- 권고: **Option A — 세션 재사용(`--session-id` / `--resume`)** 을 1순위로 검증·구현한다. 릴레이 없이 CLI 자체가 캐시 프리픽스를 유지하게 하는 방식이라 트래픽이 가장 자연스럽고 코드도 줄어든다. 릴레이 수정(Option B)은 A의 측정 게이트가 실패할 때의 대안으로 남긴다. 두 옵션 모두 **측정이 게이트**이며, 측정은 먼저 **가짜 업스트림(쿼터 0)** 으로, 그 다음 live 로 한다. (5절, 6절)
- 이 문서는 추론 위주다. 무엇을 실행해 보지 않았는지 6.2절에 적었다. 어느 옵션도 못 고치는 한계(5분 TTL, 매 턴 바뀌는 시스템 프롬프트, CLI 버전 변경)는 6.1절.

## 1. 배경

### 1.1 왜 `claude -p` 인가

`claude` 프로바이더(OAuth 토큰을 서버가 직접 재사용)는 Ban 위험이 있다. `claude-cli` 프로바이더는 호스트에 설치된 실제 `claude` 바이너리를 print 모드로 spawn 한다. 트래픽 형태(클라이언트, 헤더, 인증 경로)가 일반 Claude Code 세션과 같아지는 것이 이 프로바이더의 존재 이유다. 설계 원형은 NousResearch의 Hermes 플러그인(`hermes-plugin-claude-subscription-directsdk`).

### 1.2 현재 호출 형태 (`buildClaudeCliArgs`, `claude-cli.js:317-357`)

```
claude -p --output-format stream-json --verbose --include-partial-messages
       --max-turns 1 --tools "" --setting-sources "" --strict-mcp-config
       --permission-mode dontAsk --disable-slash-commands
       --no-session-persistence
       [--input-format stream-json] --model <alias>
       [--system-prompt-file <tmp>/system.md] [--settings <tmp>/settings.json] [--mcp-config <tmp>/mcp.json]
```

- 히스토리는 `--input-format stream-json` 으로 **턴 단위 재생(replay)** 된다 (`claudeCliReplay.js`). 과거 user 프레임은 `shouldQuery:false`, 마지막 user/tool_result 프레임만 질의한다. 재생 불가(마지막이 assistant인 prefill 등)면 텍스트 한 덩어리로 평탄화한다.
- 자식 env는 allowlist(`config/claudeCli.js:44`)만 전달. `ANTHROPIC_*`는 기본 제외. `CLAUDE_CLI_CHILD_ENV`(`:20`)로 재시도·자동 compact·토큰 리마인더 등을 끈다. 이 중 `CLAUDE_CODE_TOTAL_TOKENS_REMINDER=off` 는 이미 "캐시 프리픽스를 깨는 리마인더" 때문에 넣은 값이다.
- 계정 선택: 연결(connection)별 `CLAUDE_CONFIG_DIR` 또는 `CLAUDE_CODE_OAUTH_TOKEN` (`buildChildEnv`, `:365`).
- 동시 spawn 상한 4 (`CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY`), 큐 120초, idle 180초.
- cwd는 **요청별 임시 디렉터리**(`requestFiles.dir`) 또는 프로세스당 하나인 `resolveSpawnCwd()`. 세션 재사용을 하려면 이 점이 바뀌어야 한다(5.1절).

### 1.3 코드 지도

| 파일 | 역할 | 캐시 관련 지점 |
|---|---|---|
| `open-sse/executors/claude-cli.js` | 실행기 본체. 인자 구성, spawn, stream-json → OpenAI 변환 | `--no-session-persistence` (336), `queried` 계산 (299-303), 릴레이 시작 (956-963), 자식 env에 `ANTHROPIC_BASE_URL` 주입 (1012), 릴레이 stats 로그 (1206-1207), `usagePayload` (412) |
| `open-sse/executors/claudeCliAdmission.js` | loopback 캐시 릴레이. `pinMessageBreakpoint` + `startAdmission` | 전체 |
| `open-sse/executors/claudeCliReplay.js` | 히스토리를 stream-json 프레임으로 | `buildReplayFrames` (151), `framesToStdin` (221) |
| `open-sse/config/claudeCli.js` | 상수, env allowlist, `cacheRelayEnabled` (111) | 릴레이가 off인 이유가 주석에 기록됨 (93-110) |
| `open-sse/executors/claudeCliRequestSupport.js` | 요청 필드 지원/무시/거절 | `max_turns` 무시 — "릴레이가 정확히 한 번의 모델 호출만 admit 하려면" |
| `tests/unit/claude-cli-admission.test.js`, `claude-cli-admission-relay.test.js` | 릴레이 규칙/소켓 테스트 | 모두 통과 상태 |
| `scripts/fork/check-claude-cli-empty-response.mjs` | 서버 구동형 점검. 5c 케이스가 릴레이 URL 주입을 확인 | 하네스에서만 `CLI_CLAUDE_CACHE_RELAY=1` |
| `tests/real/claude-cli.real.test.js` | 실제 계정 대상 | 캐시 측정 케이스 없음 |

## 2. 캐시가 안 되는 이유 (측정된 메커니즘)

이전 작업자의 측정 (CLI 2.1.281, `claudeCliAdmission.js` 헤더 주석):

- 동일 요청 3회 → `cache_read_input_tokens: 40516`. 캐시 자체는 동작한다.
- 마지막 질문 한 단어만 바꾸면 → 캐시 읽기 0, 40k 전부 재처리.

원인 연쇄:

1. Anthropic 프롬프트 캐시는 `cache_control` 브레이크포인트 위치의 프리픽스를 캐시한다. 조회는 브레이크포인트 위치와 그 앞 최대 20블록 경계에서만 이루어진다.
2. CLI는 자기가 답하는 턴(마지막 user 턴)에 per-request 컨텍스트(오늘 날짜, 계정 리마인더 등 `<system-reminder>` 류 텍스트 블록)를 **덧붙이고**, 메시지 레벨 `cache_control` 을 하나만, 그 턴 위나 뒤에 찍는다.
3. 그래서 캐시된 프리픽스 = `[system] + [히스토리] + [마지막 user 턴 + CLI 덧붙임]`.
4. 다음 요청에서 9Router는 클라이언트가 보낸 히스토리를 재생한다. 거기엔 CLI 덧붙임이 없다. 이전 user 턴 뒤에서 프리픽스가 갈라지고, "덧붙임 없는 이전 user 턴까지"라는 프리픽스는 **캐시된 적이 없으므로** 히트가 없다. system 프리픽스만 살아남는다.
5. 93k 토큰짜리 대화에서 이 차이는 수 초 vs 12-16초. 클라이언트(에이전트)가 포기하는 구간이다.

즉 문제는 "캐시가 꺼져 있다"가 아니라 "브레이크포인트가 다음 요청에 재현되지 않는 블록 위에 찍힌다"다.

### 2.2 실측으로 확정된 진짜 원인 (2026-09-24 추가)

가짜 업스트림으로 CLI 가 보내는 본문을 캡처해 보니(계획서 측정 기록), 원인은 위 3-4번보다 앞에 있다. `--input-format stream-json` 재생에서 `shouldQuery:false` 로 보낸 과거 user 프레임은 **히스토리 자리에 들어가지 않는다.** CLI 는 그것을 큐에 넣었다가 다음 질의 프레임에 합친다. 그래서 턴2 본문은:

```
messages[0] assistant  "턴1 답"
messages[1] user       [CLI 리마인더 ×4] "턴1 질문" "턴2 질문"   ← cache_control
```

즉 대화 순서 자체가 바뀐다(assistant 가 먼저 말하고, 모든 과거 질문이 새 턴 하나에 몰림). 프리픽스는 첫 메시지에서 갈라지므로 system 이후는 절대 히트하지 않는다. 브레이크포인트를 옮기는 릴레이로는 복구할 수 없다(실측: 릴레이 on 도 미스). 부수 효과로 모델이 과거 질문까지 한 번에 다시 답하는 현상이 live 에서 보였다("marker 3 은 …, marker 5 는 …").

`--resume` 경로는 세션 파일에서 대화를 올바른 순서로 복원하므로 이 문제가 없다. 2026-09-25 추가: 세션 캐시가 켜져 있으면 **미스인 첫 턴도** 클라이언트 히스토리를 transcript 로 심어 `--resume` 하므로 순서가 맞다(계획서 "히스토리 접힘 수정"). 접힌 재생이 남는 곳은 (1) 세션 캐시가 꺼진 기본 경로, (2) 질의가 tool 결과인 요청 — 둘 다 이유는 계획서에.

### 2.1 세션 파일이 힌트

Claude Code 세션 jsonl(`~/.claude/projects/<cwd 인코딩>/<session>.jsonl`)에는 `type:"attachment"` 레코드가 user 메시지와 별도로 저장된다. 즉 CLI는 자기가 덧붙인 컨텍스트를 세션에 기록하고, `--resume` 시 그것까지 포함해 대화를 복원한다. 대화형 세션에서 캐시 히트가 나는 이유가 이것이다. Option A의 근거.

## 3. 중단된 작업: 캐시 릴레이 (`claudeCliAdmission.js`)

### 3.1 무엇을 하나

1. 요청마다 `127.0.0.1:<임시포트>/admit/<랜덤32바이트>` 에 `new http.Server` 를 띄운다 (`startAdmission`, `:150`).
2. 자식 env에 `ANTHROPIC_BASE_URL=<그 URL>` 을 넣어 CLI가 API 대신 릴레이로 보내게 한다 (`claude-cli.js:1012`).
3. `POST <prefix>/v1/messages` 만 받는다. 그 외(`HEAD /api/hello` 탐침 포함)는 404.
4. 본문을 파싱해 `pinMessageBreakpoint(payload, queried)` 로 **메시지 레벨 `cache_control` 을 뒤로 옮긴다**: 마지막 assistant 메시지까지 + 새 user 턴 중 9Router가 실제로 보낸 선두 블록(`queried` 와 일치하는 블록)까지가 "다음에도 그대로 재현되는 구간"이고, 그 구간의 마지막 캐시 가능 블록(`thinking` 제외)에 마커를 놓는다. 절대 뒤로(더 늦게) 옮기지 않고, 형태가 예상과 다르면 원본 그대로 통과.
5. 헤더는 hop-by-hop 과 `x-9r-*` 만 제거하고 그대로 전달. `accept-encoding: identity` 강제. 응답은 `upstreamRes.pipe(res)` 로 스트리밍. 자격 증명은 저장·로그하지 않음.
6. Hermes 원본(`admission.py`)과의 의도된 차이 하나: Hermes는 POST를 **정확히 1회만 admit**하고 나머지는 400으로 거절한다. 9Router는 **카운트만** 한다. 실제 계정에서 일부 요청이 두 번째 모델 호출을 만들었고, 거절하면 9Router가 업스트림 4xx로 읽어 계정을 30초 잠그는 연쇄가 생겼기 때문(20/28 → 28/28).

### 3.2 무엇이 안 되나

`config/claudeCli.js:93-110` 주석 그대로:

- 실제 구독 계정 live 스위트: 릴레이 off 28/28, on 4/28.
- 증상: "자식의 요청이 릴레이에 **도달**하지만 응답이 돌아오지 않고, CLI가 30초 뒤 연결을 끊는다."
- 그 실패가 계정을 30초 잠가 뒤 요청까지 연쇄 실패.
- **Next 서버 밖에서는 재현되지 않는다.** 같은 릴레이가 같은 요청을 같은 API로 보내면 200.

기록되지 않은 것: 실패 시 `admission.stats()` 값(`admitted / forwarded / status / failure / requestId`). 이 한 줄(`claude-cli.js:1207` 로그)이 있으면 "릴레이 → 업스트림" 구간과 "릴레이 → 자식" 구간 중 어디서 끊기는지 갈린다.

쓰지 않은 도구: `startAdmission` 은 이미 loopback HTTP 업스트림을 인자로 받는다(테스트용). 실행기가 이를 노출하지 않아, 이전 진단은 매번 실계정을 태웠고 실패마다 계정이 30초 잠겼다. 자식 CLI 를 **가짜 업스트림**(로컬, canned SSE 응답)에 붙이면 쿼터 0 으로 Next 안에서 hang 을 재현할 수 있고, 재현되면 Anthropic 구간은 배제된다. 계획서 Phase 0.5 / Phase 1-0.

### 3.3 아직 검증 안 된 가설 (우선순위 순)

| # | 가설 | 왜 Next 안에서만? | 2분 확인법 |
|---|---|---|---|
| H1 | **프록시 env 누출.** Next는 `.env` 를 `process.env` 로 로드한다. `HTTP(S)_PROXY` 가 있으면 (a) 자식이 allowlist로 그 값을 받아 loopback 요청을 프록시로 보냄(`NO_PROXY` 에 127.0.0.1 없음), (b) 릴레이의 raw `https.request` 는 프록시를 전혀 안 타서 egress 가 막힌 망에서 hang. 두 경우 모두 "도달은 하지만 응답 없음 + 30초". 독립 스크립트는 `.env` 를 안 읽는다. | `.env` 로딩 차이 | 서버 프로세스에서 `process.env.HTTPS_PROXY` 유무 로그. 자식 env에 `NO_PROXY=127.0.0.1,localhost` 병합 후 재시도 |
| H2 | **런타임이 Bun.** `dev:bun` / `start:bun` 으로 띄운 경우 Bun의 `node:http` 호환 계층에서 `pipe`/`unref` 동작이 다르다. 독립 재현은 Node로 돌렸을 가능성. | 프로세스 런타임 차이 | `process.versions.bun` 로그. Node(`node custom-server.js`)로 같은 스위트 재실행 |
| H3 | **릴레이 → 업스트림 연결 실패**(TLS/DNS/방화벽)를 stats 로 못 봤을 뿐. | H1과 동일 뿌리일 수 있음 | stats 로그의 `forwarded===0 && failure` 확인 |
| H4 | **`HEAD /api/hello` 404 처리 뒤 keep-alive 소켓 재사용** 문제(5초 `keepAliveTimeout` 경과 후 끊긴 소켓에 POST). 단독 테스트는 HEAD 를 안 보낸다. | 자식이 실제 CLI일 때만 | 릴레이에 `server.keepAliveTimeout = 0` 또는 404 응답에 `connection: close` 부여 후 재시도 |
| H5 | **gateway 모드 부작용.** `ANTHROPIC_BASE_URL` 이 설정되면 CLI는 "gateway 기본값"을 적용한다(Hermes README). 컨텍스트 창이 200K로 잡히는 등 요청 형태가 바뀌고, 어떤 조합에서 CLI가 응답을 기다리다 포기할 수 있다. | 자식이 실제 CLI일 때만 | `--verbose` stderr 와 `stream_event` 의 `message_start` 모델/헤더 비교. `[1m]` 모델로 재시도 |

H1은 9Router가 명시적으로 지원하는 환경(`.env.example` 40-45행, K8s 배포)이라 가장 먼저 배제해야 한다.

### 3.4 릴레이 방식의 Ban-안전성 평가

- 인증 경로: 여전히 CLI가 소유. 헤더·토큰 무수정. **양호.**
- 하지만 (1) 요청 본문을 **변조**한다 — Claude Code가 스스로는 만들지 않는 `cache_control` 배치. (2) `ANTHROPIC_BASE_URL` 로 CLI를 **gateway 모드**에 넣는다 — CLI 측 동작(컨텍스트 창 기본값, 텔레메트리 경로)이 일반 세션과 달라진다. 서버가 볼 때 "약간 이상한 Claude Code" 다. Option A보다 한 단계 덜 자연스럽다.
- Hermes 는 같은 방식을 실계정에서 운영·공개 중이라 치명적이진 않다. 그러나 대안이 있으면 대안이 낫다.

## 4. 불변 조건 (어느 옵션이든 지켜야 함)

1. `claude -p` 유지. 서버가 `api.anthropic.com` 을 직접 호출하거나 OAuth 토큰을 재사용하지 않는다. `ANTHROPIC_API_KEY` 도입 금지.
2. 인증은 CLI 소유. `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_OAUTH_TOKEN` 외 자격 증명 경로 추가 금지. 헤더 스푸핑 금지.
3. 격리 플래그 유지: `--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--disable-slash-commands`, `--max-turns 1`. 이것들은 토큰 절감(37,835 → 545)과 호스트 보호 둘 다다.
4. `CLAUDE_CLI_CHILD_ENV` 유지(재시도 0, compact 끔, 리마인더 끔). 이것들이 꺼지면 캐시 프리픽스가 요청마다 바뀐다.
5. **Fail-open.** 캐시 경로가 어떤 이유로든 실패하면 오늘의 "전체 재생" 경로로 같은 요청 안에서 조용히 내려간다. 캐시 실패가 4xx로 표면화되어 계정 30초 잠금(`src/sse/services/auth.js:290`)을 부르는 일은 없어야 한다.
6. 새 동작은 **env 플래그 opt-in 으로 시작**하고, live 스위트 28/28 + 캐시 측정 통과 후에만 기본값으로 올린다.
7. 자식 env allowlist 원칙 유지. 서버 시크릿(JWT_SECRET 등) 미전달.

## 5. 옵션 비교

### 5.1 Option A — 세션 재사용 (권고, 1순위 검증)

**아이디어.** `--no-session-persistence` 를 빼고, 대화의 첫 요청은 `--session-id <uuid>` 로 세션을 만들고, 이어지는 요청은 `--resume <uuid>` 에 **새 턴 하나만** stdin 으로 넣는다. 히스토리 복원은 CLI가 자기 세션 파일(덧붙임 포함)로 한다. 그러면 업스트림 요청의 프리픽스가 이전 요청과 바이트 단위로 재현되고, CLI가 찍은 브레이크포인트가 그대로 히트한다. 대화형 Claude Code 가 캐시를 유지하는 것과 같은 경로다.

**왜 Ban-안전성이 가장 높나.** 릴레이 없음. `ANTHROPIC_BASE_URL` 없음. 본문 변조 없음. CLI 자신이 만드는 요청을 CLI 자신이 보낸다. 서버가 보는 것은 "print 모드로 이어 쓰는 세션" 뿐이며 이는 Agent SDK 의 표준 사용법이다.

**필요한 것.**

| 항목 | 내용 |
|---|---|
| 대화 식별 | 클라이언트는 OpenAI 방식으로 매번 전체 히스토리를 보낸다. "이 요청은 이전 요청의 연속인가"를 9Router가 판별해야 한다. 응답을 보낸 뒤 `key = hash(account, model, system, tools manifest, 보낸 messages + 우리가 돌려준 assistant 메시지)` → `sessionId` 를 저장하고, 다음 요청에서 **마지막 질의 프레임을 뗀 히스토리**로 조회한다. 질의 프레임은 마지막 user 메시지 1개 **또는 끝에 연속된 tool 결과 묶음 전체**(병렬 tool call). `messages[:-1]` 로 자르면 병렬 도구 턴이 전부 미스. 정규화는 role + 텍스트 + tool_call(id, name, **JSON 정규화한** arguments) + tool_result(tool_use_id, content)만. SDK 가 `arguments` 를 재직렬화해 돌려보내므로 문자열 비교는 안 된다. `reasoning_content` 등 클라이언트가 되돌려 보내지 않을 수 있는 필드는 제외. |
| 미스 시 | 오늘과 동일한 전체 재생. 단, 이때도 `--session-id` 를 붙여 세션을 만들어 두면 다음 턴부터 히트. |
| cwd 고정 | 세션은 `<config dir>/projects/<cwd 인코딩>/` 아래에 cwd 별로 저장된다. resume 은 **같은 cwd** 여야 한다. 지금은 요청별 임시 디렉터리를 cwd 로 쓰므로, 세션당 하나의 안정된 디렉터리(`resolveSpawnCwd()/sessions/<sessionId>`)로 바꿔야 한다. 요청별 파일(system.md, settings.json, mcp.json)은 계속 요청별 임시 디렉터리에 두고 경로만 넘긴다. |
| 계정 결합 | 세션은 그것을 만든 계정(`CLAUDE_CONFIG_DIR`/토큰)에 묶인다. 계정 fallback 으로 다른 연결이 잡히면 미스 처리. 키에 account 포함. |
| 동시성 | 같은 세션을 두 요청이 동시에 resume 하면 세션 파일이 깨질 수 있다. 세션별 in-flight 표시. 잠겨 있으면 기다리지 말고 미스 처리. |
| 수명 | 프롬프트 캐시 TTL 은 5분(ephemeral). 레지스트리 TTL 15분. 만료 시 메모리 항목 제거 + `projects/*/<sessionId>.jsonl` 삭제. 프로세스 시작 시 `resolveSpawnCwd()/sessions/` 와 각 configDir 의 `projects/*9router-claude*/` 잔재 정리(접두로 범위 한정). |
| resume 실패 | CLI 가 "No conversation found" 류로 즉시 종료하면 같은 요청 안에서 fresh 전체 재생으로 1회 재시도. 클라이언트에 오류를 내지 않고, 계정 잠금을 부르지 않는다. |
| 시스템 프롬프트/도구 | resume 시에도 같은 `--system-prompt-file` 과 `--mcp-config` 를 다시 준다. 내용이 달라지면 키가 달라져 미스. |
| 모델 변경 | 키에 model 포함. 캐시는 모델별이라 어차피 미스. |
| 관측 | 요청 로그에 `session=new|resumed|fallback`, `cache_read_input_tokens`. Request Details `shape` 에 세션 상태 추가. `usagePayload` 에 `prompt_tokens_details.cached_tokens` 를 노출해 클라이언트 쪽에서 캐시 히트를 볼 수 있게 한다(측정에 필수). |

**리스크와 미지수.**

- **가장 큰 미지수: `-p --resume` 이 정말 이전 턴의 덧붙임을 그대로 재전송해 캐시가 히트하는가.** 세션 파일에 attachment 가 저장되는 것은 확인했지만(2.1절, 그것도 대화형 세션 파일에서), 재전송 바이트 동일성은 측정해야 한다. 덧붙임에 시각이 들어가고 resume 시 재생성된다면 A 는 성립하지 않는다. 계획서 Phase 2.0-a(가짜 업스트림으로 본문 캡처, 쿼터 0)가 먼저, 2.0-b(live)가 그 다음이다. 실패하면 A 는 폐기.
- 디스크에 대화 내용이 남는다. `--no-session-persistence` 를 뺀다는 것은 클라이언트의 대화가 호스트 `<config dir>/projects/` 에 jsonl 로 기록된다는 뜻이다. TTL 삭제로 완화. 운영자에게 문서화 필요.
- 클라이언트가 히스토리를 편집(재생성, 메시지 삭제)하면 미스 → 전체 재생. 정상 fallback 이며 오늘과 동일.
- `--resume` 은 이전 assistant 턴의 thinking 블록(서명 포함)도 복원한다. 오히려 재생보다 충실하다. 부작용 아님.
- Hermes 는 이 방식을 택하지 않았다("no parked native session"). 이유는 Hermes 가 자체 compaction 을 소유하고 대화를 재구성하기 때문이며, 9Router 의 무상태 endpoint 시나리오와 다르다. 채택 안 한 사실 자체가 반증은 아니다.

### 5.2 Option B — 릴레이 수정

3.3절 가설 순서대로 짧게 배제한다. H1(프록시) 확인은 코드 변경 거의 없이 끝난다. 릴레이가 살아나면 다음 보완이 따라온다:

- 자식 env: 릴레이 on 일 때 `NO_PROXY` 에 `127.0.0.1,localhost` 병합.
- 릴레이 업스트림 hop: raw `https.request` 대신 9Router 의 다른 업스트림 호출과 같은 프록시 인식 경로(`open-sse/utils/proxyFetch.js` 의 undici `ProxyAgent`) 사용. 단, 헤더를 손대지 않는 원칙은 유지.
- 404 응답에 `connection: close` 를 붙여 keep-alive 재사용 경로 제거(H4).
- `[1m]` 모델 매핑을 gateway 모드 기본값과 맞춘다(H5).

Ban-안전성은 3.4절대로 A 보다 낮다. 그러나 이미 작성·테스트된 코드이므로 A 가 측정에서 떨어지면 바로 이어 쓸 수 있다.

### 5.3 Option C — 미스 폭 줄이기만

CLI 가 덧붙이는 컨텍스트를 줄여서 갈라지는 지점을 뒤로 밀어 보는 방법. `CLAUDE_CODE_TOTAL_TOKENS_REMINDER=off` 가 이미 그 예다. 그러나 날짜 리마인더처럼 끌 수 없는 것이 남고, 브레이크포인트 위치 문제(2절 3-4번)는 그대로다. `--exclude-dynamic-system-prompt-sections` 는 기본 시스템 프롬프트에만 적용되어 `--system-prompt` 를 쓰는 이 프로바이더엔 무효. **단독으로는 해결이 아니다.** A/B 의 보조 수단으로만.

### 5.4 판정

| 기준 | A 세션 재사용 | B 릴레이 | C 미스 축소 |
|---|---|---|---|
| Ban-안전성 | 최상 (CLI 가 만든 요청을 CLI 가 보냄) | 중 (본문 변조 + gateway 모드) | 최상 (변화 없음) |
| 캐시 효과 | 대화형 세션과 동급 (측정 필요) | 측정됨: 브레이크포인트 이동으로 히트 | 미미 |
| 남는 코드 | 레지스트리 1모듈 + 실행기 인자/cwd 변경. 릴레이는 불필요 | 릴레이 유지 + 프록시 경로 + 진단 | 없음 |
| 운영 부작용 | 세션 jsonl 디스크 기록(TTL 삭제) | 요청마다 loopback 서버 1개 | 없음 |
| 미확정 요소 | resume 시 프리픽스 재현성 | Next 안 hang 원인 | — |

**A 를 먼저 측정한다. 측정이 통과하면 A 를 구현하고 릴레이는 "superseded, off" 로 문서화한다. 측정이 실패하면 B 로 간다.** 두 갈래 모두 계획서에 있다.

## 6. 캐시 동작을 어떻게 확인하나

- CLI `result` 이벤트(및 `stream_event` 의 `message_start.usage` / `message_delta.usage`)에 `cache_read_input_tokens`, `cache_creation_input_tokens` 가 있다. `usagePayload`(`claude-cli.js:412`) 는 이를 `prompt_tokens` 에 합산해 버려 클라이언트 쪽에서는 히트 여부가 안 보인다. 첫 코드 변경은 `prompt_tokens_details.cached_tokens` 노출이어야 한다.
- 합격 기준 제안: 3턴 대화에서 2·3턴의 `cache_read_input_tokens` 가 직전 턴 `input + cache_creation + cache_read` 합의 80% 이상. 동일 조건에서 오늘 코드는 system 프리픽스 크기 수준(수백~수천)에 머문다.
- 릴레이 경로는 추가로 `admission.stats()` 로그(`pinned ≥ 1`, `forwarded ≥ 1`, `status 200`)를 본다.
- CLI 버전을 기록한다. 이 문서의 모든 측정은 2.1.281 기준이며, 브레이크포인트 정책은 CLI 버전에 따라 바뀔 수 있다.

### 6.1 어느 옵션도 못 고치는 것 (운영자에게 알릴 한계)

- **도구 호출 턴은 이어지지 않는다 (2026-09-24 실측으로 추가).** `--permission-mode dontAsk` 에서 CLI 는 모델의 tool_use 를 transcript 안에서 스스로 거절(`tool_result is_error "Permission … denied"`)로 닫는다. 그 세션을 resume 하면서 클라이언트의 진짜 tool 결과를 보내면 같은 `tool_use_id` 라 **버려진다** — 모델은 "(no content)" 를 받고 거절에 대해 답한다(live 에서 "permission error 가 났다"고 답함). 그래서 tool_use 로 끝난 턴의 세션은 폐기하고, tool 결과 요청은 오늘의 전체 재생으로 처리한다(올바르게 짝지어짐, live 재측정 "sunny, 21°C"). **수혜자는 텍스트 답 뒤에 다음 질문이 오는 채팅형 대화다. 도구 라운드가 대부분인 에이전트 루프는 오늘과 거의 같다.** 5.1 절의 "에이전트 루프가 수혜자" 는 이 사실을 몰랐을 때의 서술이다. 도구 턴까지 캐시하려면 CLI 가 도구를 스스로 닫지 않게 하는 다른 아키텍처(호스트가 도구를 실행하는 동안 child 를 살려 두는 방식 등)가 필요하고, 그것은 이 작업 범위 밖이다.

- **5분 TTL.** ephemeral 캐시는 마지막 사용 후 5분에 사라진다. 턴 사이가 5분을 넘는 클라이언트(사람이 타이핑하는 채팅 등)는 A/B 어느 쪽이든 히트가 없다. 이 작업의 수혜자는 **연속으로 도는 에이전트 루프**다. 측정도 연속 실행으로만 의미가 있다.
- **매 턴 바뀌는 시스템 프롬프트.** 시스템 프롬프트에 현재 시각·랜덤 값을 넣는 클라이언트는 프리픽스 첫 부분부터 갈라져 전부 미스. 클라이언트 문제이고 9Router 가 고칠 수 없다. 로그·히트율로 **보이게만** 한다.
- **CLI 버전 변경.** 대시보드의 Update 버튼이 CLI 를 올리면 덧붙임·브레이크포인트 정책이 바뀔 수 있고, 캐시는 오류 없이 조용히 0 이 된다. 히트율 관측이 없으면 아무도 모른다. Docker 이미지는 2.1.281 로 고정되어 있으나 데스크톱 호스트는 아니다.
- **단일 프로세스 전제.** 세션 레지스트리는 프로세스 메모리다. K8s 는 `Recreate` 롤아웃으로 단일 파드가 보장되지만(`AGENT-HANDOFF.md`), 여러 9Router 인스턴스를 같은 계정으로 돌리면 서로의 세션을 모른다(미스만 늘고 오동작은 없다).
- **디스크 기록.** A 는 대화를 TTL 동안 호스트 세션 파일에 남긴다. 컨테이너에서는 `CLAUDE_CONFIG_DIR` 볼륨(NFS RWX)이다. 이것이 운영 정책상 허용되는지 사용자 확인이 필요하다.

### 6.2 이 문서가 직접 검증하지 않은 것

> 2026-09-24 갱신: 아래 목록 중 resume 재현성, resume 실패 형태, gateway 모드 영향(가짜 업스트림 본문과 live 결과가 일치), 릴레이 hang(이 호스트에서 재현 안 됨)은 측정으로 닫혔다. 결과는 계획서 "측정 기록". 남은 미검증: H1(프록시)·H4·H5 개별 실험, 설정 디렉터리를 공유하는 두 프로세스의 동시 resume.

아래는 작성 당시 코드·주석·세션 파일 구조·Hermes 문서에서 **추론**한 것이었다.

- 3.3절 가설 H1~H5 전부. 하나도 실행하지 않았다. 계획서 Phase 1-0 의 이분법이 먼저다.
- `-p --resume` 의 프리픽스 바이트 재현성(5.1절). attachment 가 저장된다는 것만 대화형 세션 파일에서 확인.
- `--resume` 실패 시 CLI 의 종료 코드·메시지 형태(fallback 판별 근거). 계획서 2.0-b(7b).
- 같은 세션 동시 resume 시 실제 파손 여부. 계획서 2.0-b(7c).
- gateway 모드(`ANTHROPIC_BASE_URL` 설정)와 일반 모드에서 CLI 가 만드는 요청 본문이 같은지(H5 와 0.5 하네스 유효성의 전제).

## 7. 참고

- Hermes 플러그인: https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk — `admission.py`(릴레이 원형), README 의 "Single-request admission", "The local relay sets `ANTHROPIC_BASE_URL`… gateway defaults" 단락.
- Claude Code CLI 세션 관련 플래그(2.1.281 `--help`): `--session-id <uuid>`, `-r, --resume [id]`, `--fork-session`, `--no-session-persistence`(print 전용), `--replay-user-messages`.
- 9Router 측 기존 문서: `open-sse/AGENTS.md`(실행기 규약), `AGENT-HANDOFF.md`(컨테이너 배포), `FORK-CHANGELOG.md`.
