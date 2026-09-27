# Claude Code CLI(`-p`) 프롬프트 캐시 — 작업 계획서

작성일: 2026-09-24. 선행 문서: [설계/현황 분석](./2026-09-24-claude-cli-prompt-cache-design.md). 이 문서는 **구현 에이전트용**이다. 배경 설명은 설계 문서에 있고, 여기에는 순서·파일·검증만 적는다.

## 구현 상태 (2026-09-24)

| Phase | 상태 | 결과물 |
|---|---|---|
| 0 | 완료 | `usagePayload` 에 `prompt_tokens_details.cached_tokens` / `cache_creation_tokens`. 요청 종료 로그 `cache_read=… cache_create=… input=…`, Request Details `shape.cache` |
| 0.5 | 완료 | `scripts/fork/lib/fake-anthropic.mjs`, `scripts/fork/lib/diff-prompt-prefix.mjs`, `upstreamOverride()`(`config/claudeCli.js`, loopback HTTP 만 허용) |
| 1 | 완료 | Next 안 릴레이 + 가짜 업스트림: hang 없음. live 1회: hang 없음, 캐시 이득도 없음. 판정 → Phase 2 (아래 측정 기록) |
| 2.0-a / 2.0-b | 통과 | `scripts/fork/check-claude-cli-resume-cache.mjs --offline` / `--live` |
| 2.1–2.4 | 완료 (도구 턴 제외, 아래) | `open-sse/executors/claudeCliSessions.js`, 실행기 배선, `tests/unit/claude-cli-sessions.test.js`, `tests/unit/claude-cli-session-executor.test.js`, `scripts/fork/check-claude-cli-cache-offline.mjs [--live]` |
| 2.5 / 3-A | 완료 | registry notice, `.env.example`, `FORK-CHANGELOG.md`, `AGENT-HANDOFF.md`, 릴레이 주석에 superseded |
| 4 | **하지 않음** | 기본값 전환은 사용자 승인 + 24시간 opt-in 운영 후 |

계획과 다르게 간 곳 (이유 포함):

- **`sessionCacheEnabled` 위치.** `config/claudeCli.js` 가 아니라 `claudeCliSessions.js` 에 뒀다. 세션 관련 env 3개(`CLI_CLAUDE_SESSION_CACHE/_TTL_MS/_MAX`)를 한 모듈에서 읽는다.
- **remember 시점.** 계획은 "child close 시". 실측에서 클라이언트가 답을 받자마자 다음 턴을 보내 close 전에 도착 → 전부 미스. **result 이벤트 시점**에 기억하고, 재개하는 요청은 이전 child 종료(`ready` 프로미스)를 최대 3초 기다린 뒤 세션 파일 존재를 다시 확인한다.
- **`take`(소비) 의미.** 조회 시 키를 소비한다. 같은 턴을 재생성하는 클라이언트가 이미 앞으로 간 세션을 resume 하지 않게.
- **resume 실패 판별 문자열.** 2.0-b(7b) 실측: `exit=1`, `result.subtype=error_during_execution`, `is_error=true`, `errors=["No conversation found with session ID: <id>"]`, stderr 동일. 모델 호출 없음.
- **동시 resume(2.0-b 7c) 는 실험하지 않았다.** 레지스트리가 in-flight 세션을 절대 두 번 내주지 않으므로(`take` + `inFlight`) 같은 프로세스 안에서는 발생하지 않는다. 다른 프로세스와 설정 디렉터리를 공유하는 경우는 여전히 미검증.
- **2.0-b 7a(tool_result + `--mcp-config`)는 오프라인만.** `check-claude-cli-cache-offline.mjs session-tools` 가 실제 CLI + 가짜 업스트림으로 도구 호출 → tool 결과 턴의 resume 과 프리픽스 재현을 확인한다(인자를 클라이언트가 재직렬화해도 히트). live 도구 턴은 미측정.
- **2.0-b 7d(`CLAUDE_CONFIG_DIR` 계정)는 오프라인으로 확인.** `check-claude-cli-resume-cache.mjs --offline` 의 config-dir arm: 세션이 `<configDir>/projects/` 에 쓰이고 resume 된다.
- **resume fallback 범위 확장.** "No conversation found" 뿐 아니라, resume 한 child 가 결과 없이·클라이언트에 아무것도 보내기 전에 끝나면 전부 fresh 재실행(손상된 transcript, 바뀐 오류 문구 대비).
- **orphan sweep 시점.** 프로세스 시작 시가 아니라 계정 설정 디렉터리별 첫 세션 요청 시, 그 뒤로는 매 분 sweep 마다. 플래그를 끈 뒤 남은 파일은 다시 켤 때까지 남는다. 이전 프로세스의 `<tmp>/9router-claude-*/sessions/*` cwd 디렉터리는 지우지 않는다(비어 있음, OS tmp 정리에 맡김).
- **쿼터 카드 표시 경로.** `open-sse/services/usage/` 가 아니라 `src/shared/services/claudeCliUsage.js` 의 카드 메시지 문장. 같은 카드에 나온다.
- **`transformedBody.session`** 은 요청 시작 시 값이다. fallback 이 일어나면 로그·`shape.session` 은 `fallback` 인데 이 필드는 `resumed` 로 남는다.
- **플래그와 무관한 변화.** `usage.prompt_tokens_details` 는 세션 캐시 on/off 와 관계없이 항상 실린다. Claude 포맷 클라이언트는 이제 `input_tokens` 가 캐시분만큼 줄고 `cache_read_input_tokens` 를 받는다(번역기가 원래 하던 계산). 비용 기록도 캐시 단가로 내려간다.
- **Phase 1 의 H1-H5 개별 실험은 하지 않았다.** 이분법(1-0)과 live 1회로 "hang 이 이 호스트에서 재현되지 않음 + 릴레이로는 캐시가 안 붙음"이 확정되어 릴레이를 고칠 이유가 사라졌다.

### 리뷰 반영 (독립 리뷰어 2명: 계획 준수 검증, 정확성 리뷰)

- orphan sweep 이 이름에 `9router-claude-` 가 **들어간** 모든 프로젝트 디렉터리를 대상으로 삼아, 운영자 자신의 `~/code/9router-claude-*` 대화 기록을 지울 수 있었다 → 정확한 인코딩 형태(`9router-claude-XXXXXX-sessions-<uuid>`)와 UUID 파일명만. 세션 파일 위치는 스캔하지 않고 cwd 에서 계산.
- `retryFresh` 가 `close` 리스너 안에서 동기 예외를 던지면 서버가 죽을 수 있었다 → try/catch 후 정리 경로로.
- 재시도 spawn 중 클라이언트가 떠나면 요청 디렉터리와 abort 리스너가 남았다 → 항상 `attach` 하여 한 경로로 정리.
- `take()` 후 cwd 생성 실패 시 세션이 in-flight 에 영구히 남았다 → discard.
- 빈 턴(오류 문구로 전달)·idle timeout 후 도착한 결과가 기억됐다 → 클라이언트가 실제로 답(텍스트 또는 도구 호출)을 받은 턴만.
- 이전 child 종료 대기 3초 → exit grace ×2 + 1초. 그래도 안 끝났으면 resume 하지 않고 fresh(한 transcript 에 두 writer 방지).
- `shape.cache`/`shape.session` 을 child 종료가 아니라 result 시점에 기록(요청 기록이 먼저 만들어지므로).

### 히스토리 접힘 수정 (2026-09-25, 세션 캐시 on 일 때)

가짜 업스트림으로 CLI 의 resume 동작을 열 가지 조합으로 측정한 결과(요약은 `claudeCliReplay.js` 의 `transcriptSeed` 주석):

- 우리가 직접 쓴 transcript 파일(`parentUuid/uuid/type/message/sessionId/cwd/timestamp` 만 있는 레코드)을 `--resume` 하면 CLI 가 히스토리를 **올바른 순서**로 올린다. 디렉터리는 `<config>/projects/` 아래 어디든 됨. 완결된 tool 라운드(tool_use + tool_result)가 히스토리 안에 있어도 정상, thinking 블록·이미지도 정상.
- 질의가 tool 결과인 경우는 **어떤 조합으로도 불가**: CLI 가 미해결 tool_use 를 자기 규칙으로 닫고("[Tool call interrupted]" 또는 permission denied), 클라이언트의 같은 id 결과는 중복으로 버린다. transcript 에 쌍을 넣어도, stdin 에 쌍을 넣어도, 결과만 넣어도 모델에는 "(no content)" 가 간다.

구현 (`planClaudeCliSession` 의 `fresh()`): 세션 캐시가 켜져 있고 레지스트리 미스일 때, 재생 프레임의 마지막 user 턴을 뺀 전부를 transcript 로 써 두고(`transcriptRecords`) `--resume <새 uuid>` + stdin 은 마지막 턴 하나. 로그 `session=seeded`. 질의가 tool 결과면 오늘 방식(`--session-id` + 전체 stdin) 그대로. seeded transcript 를 CLI 가 거부하면(`No conversation found`) 같은 요청 안에서 오늘 방식으로 1회 재실행.

측정: 오프라인 `check-claude-cli-cache-offline.mjs seeded` — 턴 3 에서 모델이 본 순서 `u, a, u, a, u` (plain 은 `a, a, u(질문 3개 합침)`). live 1회 — 이 서버가 답한 적 없는 히스토리(Paris/Tokyo) 뒤에 "And of Korea?" → 답 "Seoul." 만. 접힌 경로에서는 이전 질문까지 다시 답했었다.

**남는 한계:** 세션 캐시가 **꺼진** 기본 경로는 여전히 접힌다. 이 수정을 기본 경로에도 적용하려면 transcript 를 쓰고 지우는 정리 코드(= 세션 레지스트리)가 필요하므로, 사실상 세션 캐시를 기본값으로 켜는 것(Phase 4)과 같은 결정이다. 도구 결과 질의는 여전히 접힌 재생이다.

### 재검토 반영 (2026-09-24, 푸시 후 전수 재확인)

- **같은 키 덮어쓰기 누수.** 같은 대화를 두 요청이 동시에 돌리면 둘 다 같은 continuation 키로 `remember` 한다. 뒤의 것이 앞의 것을 Map 에서 덮어쓰면 앞 세션의 transcript 는 어떤 항목도 가리키지 않아 TTL 로도 지워지지 않았다 → 덮어쓸 때 이전 항목의 파일을 삭제.
- **orphan sweep 이 디렉터리당 1회만.** 첫 요청 때 TTL 보다 어린 파일은 건너뛰는데, 그 뒤로는 다시 보지 않아 이전 프로세스가 남긴 파일이 영구히 남았다 → 세션이 쓰인 설정 디렉터리를 기억해 매 분 `sweep()` 때마다 다시 본다.
- 테스트 추가: 덮어쓰기 시 파일 삭제, 재-sweep, 재시도 spawn 중 클라이언트 이탈 시 게이트 슬롯 0 복귀, RTK 순서 고정(키는 실행기가 받은 본문의 순수 함수).
- **자기 비활성화 안전장치.** 세션 파일 위치(`<config>/projects/<cwd 인코딩>/<uuid>.jsonl`)는 macOS·CLI 2.1.281 에서만 실측했다. Windows 나 다른 CLI 버전이 다른 곳에 쓰면 매 턴 미스 + 매 턴 transcript 1개 누수가 조용히 계속된다. 이제 `new` 세션이 정상 완료했는데 그 자리에 transcript 가 없으면 프로세스 전체에서 세션 캐시를 끄고 로그에 예상 경로와 남은 세션 id 를 적는다(누수는 transcript 1개로 끝). 실제 CLI 가 이 장치를 잘못 밟지 않는 것은 오프라인 세션 체크(turn 2 가 `resumed`)로 확인.
- **도구 호출 턴은 이어가지 않는다 (가장 중요한 한계).** live 도구 턴 측정에서 캐시는 100% 히트했지만 **답이 틀렸다**: "permission error 가 났다"고 답했다. 원인(가짜 업스트림으로 transcript 와 업스트림 본문 캡처): `--permission-mode dontAsk` 에서 CLI 는 모델의 tool_use 에 대해 스스로 `tool_result(is_error, "Permission to use … denied")` 를 transcript 에 기록한다. resume 시 클라이언트가 보낸 같은 `tool_use_id` 의 진짜 결과는 **중복으로 버려지고**, 모델에는 user 턴 "(no content)" 가 간다. 수정: tool_use 로 끝난 턴은 `resultOk=false` 로 세션을 버리고, tool 결과 쿼리는 `take` 하지 않는다. 그 요청은 오늘의 전체 재생(`--session-id` 새 세션)으로 돌아가며, 이 경로는 결과를 올바르게 짝지어 준다(live 재측정: "sunny … 21°C"). **결과적으로 이 기능의 수혜자는 텍스트 답 → 다음 질문으로 이어지는 채팅형 다중 턴이다. 도구 루프(에이전트)는 도구 라운드마다 전체 재생이라 오늘과 같다.** 설계 문서 5.1 의 "에이전트 루프가 수혜자" 는 틀렸다.
- **끝에서 끝까지 확인한 세 경로** (`check-claude-cli-cache-offline.mjs session-record | session-concurrent | session-abort`, 실제 CLI + 가짜 업스트림): (1) 쿼터 카드 메시지에 `Prompt cache: N% of … prompt tokens` 문장이 실리고 Request Details 행에 `session: resumed|new` 와 `cache` 분해가 기록된다(child 종료 전에 써야 하는 타이밍 포함). (2) 같은 대화로 동시에 온 요청 둘 다 200, 하나는 resume 하나는 fresh, 이후 턴 정상, 남는 transcript 는 살아 있는 continuation 수만큼. (3) resume 중 클라이언트가 떠나면 다음 턴은 fresh 로 정상 응답, 세션 누수 없음.
- **CLI 가 `-p` 모드에서 `projects/` 밖에 쓰는 것이 있는지 확인.** 테스트 프롬프트로 `~/.claude/history.jsonl` 검색 0건, `~/.claude/sessions/` 는 대화형 세션 잠금 파일만. 정리 대상은 `projects/` 아래 transcript 만이 맞다.

## 시작 전 체크리스트

- [ ] `open-sse/AGENTS.md` 를 읽는다. `open-sse/` 아래를 고칠 때의 규약이다.
- [ ] `git status --short --branch` 가 clean 이고 `master` 인지 확인. 작업은 브랜치 `feat/claude-cli-session-cache` 에서.
- [ ] 루트 `npm install`, `cd tests && npm install`. 기준선: `cd tests && npx vitest run unit/claude-cli-*.test.js unit/concurrency-gate.test.js` 가 통과해야 한다(현재 통과 상태).
- [ ] live 검증에는 **실제 구독 계정과 사용량**이 든다. 사용자에게 어느 연결(connection)로 측정할지 확인받은 뒤에만 실행. 자동으로 반복 실행하는 루프 금지.
- [ ] CLI 버전 기록: `~/.local/bin/claude --version` (문서 기준 2.1.281). 다르면 결과에 함께 적는다.

## 불변 조건 (위반 시 작업 중단)

설계 문서 4절과 동일. 요약:

1. `claude -p` 유지. 서버가 API 를 직접 치지 않음. `ANTHROPIC_API_KEY` 도입 금지. OAuth 토큰 재사용 금지.
2. 격리 플래그(`--tools ""`, `--setting-sources ""`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--disable-slash-commands`, `--max-turns 1`)와 `CLAUDE_CLI_CHILD_ENV` 유지.
3. 캐시 경로 실패는 같은 요청 안에서 오늘의 전체 재생 경로로 조용히 fallback. 4xx 로 표면화되어 계정 30초 잠금을 부르지 않게 한다.
4. 새 동작은 env 플래그 opt-in. 기본값 변경은 Phase 4 에서만.
5. `CLI_CLAUDE_CACHE_RELAY` 기본값은 `0` 그대로 둔다.

---

## Phase 0 — 측정 가능하게 만들기 (30분, 코드 변경 1곳)

목표: 클라이언트 응답에서 캐시 히트가 보이게 한다. 이후 모든 측정의 전제.

1. `open-sse/executors/claude-cli.js` `usagePayload` (412행 부근): OpenAI 호환 형태로 `prompt_tokens_details: { cached_tokens: cache_read_input_tokens }` 를 추가한다. 기존 `prompt_tokens` 합산 방식은 유지(호환성). `cache_creation_input_tokens` 는 9Router 확장 필드로 함께 실어도 된다(예: `prompt_tokens_details.cache_creation_tokens`). 값이 없을 때는 필드를 생략.
2. `tests/unit/claude-cli-executor.test.js` 에 usage 매핑 케이스 1개 추가: `result` 이벤트에 cache 필드가 있을 때 `cached_tokens` 가 나오는지, 없을 때 필드가 없는지.
3. 이 변환이 `openaiToClaudeResponse` 등 다른 포맷으로 나갈 때 깨지지 않는지 확인: `cd tests && npx vitest run unit/claude-cli-executor.test.js unit/forced-sse-client-format.test.js`.
4. 로그: 실행기의 요청 종료 로그(`"CLAUDE-CLI"` 채널)에 `cache_read=<n> cache_create=<n> input=<n>` 한 줄 추가. 대시보드 Request Details 의 `shape` 객체에도 같은 값을 넣는다(`planClaudeCliInvocation` 의 `shape` 는 요청 시점 값이므로, 응답 usage 는 스트림 종료 시 기록되는 위치에 붙인다 — 어디에 기록되는지는 `chatCore.js` 에서 `shape` 가 소비되는 곳을 따라가서 결정).

**완료 기준:** 단위 테스트 통과. `/v1/chat/completions` 를 `claude-cli` 모델로 한 번 호출했을 때 응답 `usage.prompt_tokens_details.cached_tokens` 가 숫자로 온다(0 이어도 됨).

---

## Phase 0.5 — 오프라인 캡처 하네스 (1시간, 이후 모든 단계의 도구)

목표: **실계정·쿼터 없이** 자식 CLI 가 보내는 요청 본문을 캡처하고, 릴레이를 Next 안에서 재현한다. Anthropic 에는 아무것도 가지 않는다.

원리: `startAdmission({ upstream })` 은 이미 loopback HTTP 업스트림을 받는다(`claudeCliAdmission.js:150-157`, 테스트용). 실행기가 이 인자를 노출하지 않아 이전 진단은 매번 실계정을 태웠다.

1. `scripts/fork/lib/fake-anthropic.mjs`(신규): loopback HTTP 서버. `POST /v1/messages` 를 받으면 (a) 본문을 요청 순서대로 디스크에 저장(경로는 stdout 으로), (b) `stream: true` 면 canned SSE(`message_start` → 짧은 `text` 델타 → `message_delta(stop_reason: end_turn, usage)` → `message_stop`)를, 아니면 canned JSON 을 돌려준다. **헤더는 저장·출력하지 않는다** — `authorization` 에 실제 OAuth 토큰이 실려 온다. `HEAD /api/hello` 는 200.
2. `config/claudeCli.js` 에 `CLI_CLAUDE_UPSTREAM_OVERRIDE`(테스트 전용, 기본 없음) 추가. 값이 있으면 (a) 릴레이 off 여도 자식 env 에 `ANTHROPIC_BASE_URL` 로 주입, (b) 릴레이 on 이면 `startAdmission({ upstream })` 에 전달. `startAdmission` 의 기존 검증(HTTPS 또는 loopback HTTP 만)이 그대로 안전장치. 프로덕션 Dockerfile/`.env.example` 에는 적지 않는다.
3. 캡처 본문 비교 도구: 두 JSON 본문의 `messages[*].content[*]` 를 블록 단위로 나열해 첫 불일치 위치와 `cache_control` 위치를 출력하는 작은 스크립트(`scripts/fork/lib/diff-prompt-prefix.mjs`).

**주의:** `ANTHROPIC_BASE_URL` 이 설정된 자식은 gateway 모드다(설계 문서 H5). 기본 컨텍스트 창 등이 달라질 수 있으므로 이 하네스가 보여주는 바이트는 "gateway 모드에서의 형태"다. 브레이크포인트·덧붙임 정책이 모드에 따라 다를 가능성은 낮지만 0 은 아니다. 그래서 Phase 2.0 의 live 측정은 생략하지 않는다 — 이 하네스는 live 전 필터다.

**완료 기준:** `CLI_CLAUDE_UPSTREAM_OVERRIDE=http://127.0.0.1:<port>` 로 9Router 를 띄우고 요청 1회 → 클라이언트가 canned 답을 받고, 디스크에 본문 1개.

---

## Phase 1 — 릴레이 이분법과 빠른 배제 (시간 상한 2시간, 결과에 따라 분기)

목표: 설계 문서 3.3절 가설을 **추정에서 측정으로** 바꾼다. 가설 5개는 아직 하나도 실행해 보지 않은 것들이다. 순서를 지킨다.

0. **이분법 먼저(쿼터 0).** Phase 0.5 하네스로 `CLI_CLAUDE_CACHE_RELAY=1` + `CLI_CLAUDE_UPSTREAM_OVERRIDE=<가짜 업스트림>` 상태의 Next 서버에 재생 요청을 보낸다.
   - **멈춘다** → 릴레이↔자식 CLI 구간 문제. Anthropic 과 무관. H4(keep-alive)·H5(gateway 모드)·릴레이의 `pipe`/헤더 처리로 범위 축소. 아래 4번으로 직행.
   - **안 멈춘다** → 릴레이→`api.anthropic.com` 구간 문제. H1(프록시)·H3(TLS/DNS). 아래 1-3번으로.
   이 한 번의 실행이 이전 작업자가 못 한 분리다.
1. **stats 를 본다.** `CLI_CLAUDE_CACHE_RELAY=1` 로 서버(Node, `npm run start` 경로)를 띄우고, 재생되는 대화(2턴 이상, 마지막이 user)를 1회 보낸다. 로그에서 `cache relay {...}` 한 줄을 읽는다.
   - `admitted ≥ 1, forwarded = 0, failure = <메시지>` → 릴레이→업스트림 구간 문제. H1/H3. 2번으로.
   - `admitted ≥ 1, forwarded = 1, status = 200` 인데 자식이 30초 뒤 끊김 → 릴레이→자식 구간 문제. H4/H5. 4번으로.
   - `admitted = 0` → 자식이 릴레이에 도달하지 않음. 자식 env 의 `ANTHROPIC_BASE_URL` 과 프록시 env 확인(H1-a). 3번으로.
2. **서버 프로세스의 프록시 env 로그.** 릴레이 시작 직후 `HTTP_PROXY/HTTPS_PROXY/NO_PROXY/ALL_PROXY`(대소문자 모두) 의 **존재 여부만** 로그(값은 찍지 않음). `.env`, 셸, K8s 배포 매니페스트(이 레포 밖에 있음 — `AGENT-HANDOFF.md` 의 배포 절 참고)를 함께 확인.
3. **자식 env 보정 실험.** 릴레이 on 일 때 자식 env 에 `NO_PROXY`/`no_proxy` 에 `127.0.0.1,localhost` 를 병합(`buildChildEnv` 또는 spawn 지점 `claude-cli.js:1009-1013`). 다시 1번.
4. **404 응답 keep-alive 제거 실험.** `claudeCliAdmission.js` 의 refuse 경로에 `connection: close` 헤더를 붙이고, `server.keepAliveTimeout = 0` 도 시도. 다시 1번.
5. **런타임 확인.** 이전 실패가 Bun(`dev:bun`/`start:bun`)에서 났는지 사용자에게 확인하거나 로그에 `process.versions.bun` 유무를 찍는다. Bun 이었다면 Node 로 동일 스위트 재실행.

**분기:**
- 릴레이가 살아나면(재생 요청 5회 연속 정상, stats `pinned ≥ 1`, 2턴부터 `cached_tokens` 가 직전 턴 입력의 80% 이상) → **Phase 3-B** 로. 그래도 Phase 2.0 실험은 실행해 A 와 비교한다.
- 2시간 안에 원인이 안 나오면 → 상태를 `config/claudeCli.js:93-110` 주석에 **stats 값과 함께** 추가 기록하고 **Phase 2** 로. 릴레이는 그대로 off.

---

## Phase 2 — Option A: 세션 재사용

### 2.0-a 오프라인 프리픽스 재현 확인 (30분, 쿼터 0)

Phase 0.5 하네스로 먼저 걸러낸다. `claude` 를 직접 spawn 하고 `ANTHROPIC_BASE_URL` 을 가짜 업스트림으로:

1. 턴 1: `--session-id <uuid>`, user 프레임 1개. 가짜 업스트림이 canned 답을 주므로 CLI 는 세션에 assistant 턴을 기록한다.
2. 턴 2: 같은 cwd, `--resume <uuid>`, 새 user 프레임 1개.
3. `diff-prompt-prefix.mjs` 로 두 본문 비교. **합격:** 턴 2 본문에서 턴 1 의 마지막 user 턴(CLI 덧붙임 블록 포함)이 바이트 동일하게 재현되고, 턴 1 의 `cache_control` 위치가 턴 2 에서는 그 뒤에 있다. **불합격:** 덧붙임 블록이 재생성되어 텍스트가 다르거나(예: 시각이 바뀜) 사라짐 → Option A 의 전제가 깨진 것. 여기서 멈추고 Phase 3-B.
4. 같은 절차를 오늘 방식(전체 재생)으로도 캡처해 "왜 미스인지"가 본문에서 그대로 보이는지 확인한다. 설계 문서 2절의 설명이 이 두 캡처로 재현되어야 한다.

이 단계가 통과해야 아래 live 실험에 계정을 쓴다.

### 2.0-b 게이트 실험 — live (1시간, 9Router 를 거치지 않음)

**시간 제약:** ephemeral 프롬프트 캐시 TTL 은 5분이다. 턴 사이 간격을 5분 안으로 두고 연속 실행한다. 간격이 벌어지면 어떤 방식이든 미스가 정상이다.

`scripts/fork/check-claude-cli-resume-cache.mjs` 를 새로 만든다. 다른 `check-*.mjs` 와 같은 형식(한 줄 pass/fail 출력, 종료 코드). 9Router 서버 없이 `claude` 바이너리를 직접 spawn 한다. 기존 실행기의 인자 구성을 그대로 재현하기 위해 `buildClaudeCliArgs` 와 `framesToStdin` 을 import 해서 쓴다.

절차:

1. 고정된 시스템 프롬프트(약 20k 토큰, 캐시 하한 1024 토큰을 크게 넘도록)를 임시 파일에 쓴다. 고정된 cwd 디렉터리 하나를 만든다.
2. **턴 1:** 오늘 인자에서 `--no-session-persistence` 만 빼고 `--session-id <uuid>` 를 넣어 spawn. stdin 에 user 프레임 1개. `result` 이벤트의 `usage` 전체와 `session_id` 를 기록.
3. **턴 2:** 같은 cwd, 같은 `--system-prompt-file`, `--resume <uuid>`, stdin 에 **새 user 프레임 1개만**. `usage` 기록.
4. **턴 3:** 턴 2 반복(다른 질문).
5. **대조군:** 같은 3턴을 오늘 방식(전체 재생, `--no-session-persistence`)으로 실행해 `usage` 기록.
6. 판정: 턴 2·3 의 `cache_read_input_tokens ≥ 0.8 × (직전 턴 input + cache_creation + cache_read)`. 대조군은 system 프리픽스 크기 수준이어야 한다(그렇지 않으면 실험 설계가 잘못됨).
7. 추가 케이스(모두 통과해야 A 채택): (a) 턴 2 의 마지막 프레임이 `tool_result` 인 경우(`--mcp-config` 동반), (b) resume 대상 세션이 없는 uuid 로 `--resume` 했을 때 CLI 의 종료 코드·stderr·`result` 형태(fallback 감지에 사용), (c) 같은 세션을 두 프로세스가 동시에 resume 했을 때 무엇이 깨지는지(잠금 필요성 확인), (d) `CLAUDE_CONFIG_DIR` 를 지정한 계정으로 같은 실험(세션 파일이 그 디렉터리 아래 `projects/` 에 생기는지).
8. 실행 후 생성된 세션 jsonl 경로를 출력하고 삭제한다.

결과는 이 문서 끝의 "측정 기록" 절에 CLI 버전과 함께 적는다.

**게이트:** 6번 판정 실패 → A 폐기, Phase 3-B 로. 통과 → 2.1 이하 진행.

### 2.1 세션 레지스트리 모듈 (신규, `open-sse/executors/claudeCliSessions.js`)

한 파일. 프로세스당 하나(`globalThis` 에 걸어 Next 모듈 리로드에서 살아남게 — `spawnGate` 가 하는 방식 `claude-cli.js:796` 과 동일).

- `splitQueryFrame(messages)` → `{ history, query }`. **`messages[:-1]` 이 아니다.** 마지막 질의 프레임은 (a) 마지막 user 메시지 1개, 또는 (b) 끝에 연속된 `tool`/`function` 메시지 **묶음 전체**(병렬 tool call 의 결과 N개 — 재생기 `buildReplayFrames` 가 이들을 user 프레임 하나로 합치는 것과 같은 경계, `claudeCliReplay.js:165-180`). 이 경계를 틀리면 병렬 도구를 쓰는 턴이 전부 미스다.
- `sessionKey({ accountKey, model, system, manifest, messages })` → 문자열. 정규화 규칙:
  - 메시지마다 `role`, 텍스트(`content` 문자열 또는 text 파트 연결, 끝 공백 제거), `tool_calls[*]` 의 `id/name/arguments`, tool 메시지의 `tool_call_id/content` 만 사용.
  - **`arguments` 는 JSON 으로 파싱해 키 정렬 후 재직렬화.** 클라이언트 SDK 는 스트리밍으로 받은 조각을 자기 방식으로 재직렬화해 돌려보낸다(공백·키 순서가 달라짐). 문자열 그대로 비교하면 도구를 쓰는 턴마다 미스. 파싱 실패 시 원문 사용.
  - tool 메시지 `content` 가 배열이면 text 파트만 연결해 문자열로.
  - 제외: `reasoning_content`, `reasoning`, `name`, `refusal`, `annotations`, 이미지 바이너리(sha256 으로 대체). 클라이언트가 되돌려 보내지 않거나 형태가 바뀌는 필드들.
  - `manifest` 는 `toMcpManifest(tools)` 결과를 이름순 정렬해 직렬화.
  - `accountKey` 는 `rateLimitAccountKey(psd)`(`claudeCliRateLimits.js:37`) 재사용. 새 키 함수 만들지 말 것.
  - 키 계산은 RTK 훅(`open-sse/rtk/`)이 tool_result 를 압축한 **뒤의** 본문으로 한다. 실행기가 받는 본문이 그 단계이므로 자연히 그렇게 되지만, 훅 순서를 바꾸는 변경이 들어오면 키가 어긋난다는 것을 테스트 이름에 남긴다.
  - sha256 hex.
- `lookup(keyOfHistory)` → `{ sessionId, cwd } | null`. `keyOfHistory` 는 `splitQueryFrame` 의 `history` 로 계산. in-flight 면 `null`(기다리지 않음).
- `remember(keyOfFullExchange, { sessionId, cwd, accountKey })`. 응답이 정상 종료(`finish_reason` 이 `stop|tool_calls|length`)했을 때만 호출. 오류·조기 종료 시에는 세션을 버린다(파일 삭제).
- `acquire(sessionId)` / `release(sessionId)`: in-flight 표시.
- `sweep(now)`: TTL(기본 **15분**, `CLI_CLAUDE_SESSION_TTL_MS`) 지난 항목 제거 + 파일 삭제. 캐시 TTL 이 5분이라 15분 뒤 세션은 히트 가능성이 없고, 디스크에 대화가 남는 시간은 짧을수록 좋다. 타이머는 `unref`.
- `sessionFiles(sessionId, configDir)`: 삭제 대상 경로 계산. `<configDir || ~/.claude>/projects/*/<sessionId>.jsonl` 글롭. cwd 디렉터리도 함께 삭제.
- `sweepOrphans(configDirs)`: 프로세스 시작 시 1회. 세션 cwd 는 항상 `resolveSpawnCwd()`(접두 `9router-claude-`) 아래이므로, 인코딩된 프로젝트 디렉터리 이름에도 그 접두가 들어간다. 각 계정 configDir 과 `~/.claude` 의 `projects/*9router-claude*/` 만 훑어 이전 프로세스가 남긴 jsonl 을 지운다. 다른 프로젝트 디렉터리는 건드리지 않는다.
- 상한: 항목 수 최대 500(`CLI_CLAUDE_SESSION_MAX`). 초과 시 가장 오래된 것부터 정리.

### 2.2 실행기 변경 (`open-sse/executors/claude-cli.js`)

- 플래그: `config/claudeCli.js` 에 `sessionCacheEnabled(env)` 추가. `CLI_CLAUDE_SESSION_CACHE` 가 `1` 일 때만 on. `cacheRelayEnabled` 옆에 두고, 둘이 동시에 on 이면 세션 캐시를 우선하고 릴레이는 시작하지 않는다(로그 한 줄).
- `buildClaudeCliArgs`: 옵션 `{ sessionId, resumeId }` 추가. `resumeId` 가 있으면 `--resume <id>`, 없고 `sessionId` 가 있으면 `--session-id <id>`. 둘 중 하나라도 있으면 `--no-session-persistence` 를 넣지 않는다. 둘 다 없으면 오늘과 동일(테스트 스냅샷 유지).
- `planClaudeCliInvocation`: 재생 가능(`replayed === true`)한 요청에서만 세션 캐시를 시도한다. 평탄화 경로는 대상 아님.
  - `lookup` 히트 → `stdin` 은 마지막 프레임 1개(`framesToStdin([frames.at(-1)])`), `resumeId` 설정, `shape.session = "resumed"`.
  - 미스 → 오늘의 전체 프레임, `sessionId = crypto.randomUUID()`, `shape.session = "new"`.
- cwd: 세션 캐시 on 이면 `resolveSpawnCwd()/sessions/<sessionId>` 를 만들어 cwd 로 쓴다. 요청별 파일(`writeRequestFiles`)은 지금처럼 요청별 임시 디렉터리에 두고 절대 경로로 넘긴다. 두 디렉터리의 수명은 다르다: 요청 디렉터리는 요청 끝에, 세션 디렉터리는 레지스트리 TTL 에.
- fallback: `--resume` 으로 spawn 한 자식이 `result` 없이 종료했거나, `result` 가 `is_error: true` 이고 `errors`/stderr 에 세션을 못 찾았다는 취지가 있으면(2.0-7b 에서 확인한 문자열로 판별) — **아직 클라이언트에 아무 것도 보내지 않은 시점에 한해** 같은 요청을 fresh(전체 재생, 새 `--session-id`)로 1회 재실행한다. 이미 델타를 내보낸 뒤면 오늘처럼 오류 프레임으로 끝낸다. 게이트 슬롯은 재실행 동안 계속 보유(재획득 금지, 데드락 위험).
- 종료 처리(`child.on("close")` 부근 1200행대): 정상 종료 시 `remember(...)`. 그 키는 "이번에 보낸 messages + 이번에 돌려준 assistant 메시지" 다. 돌려준 메시지는 `ctx` 에 누적된 텍스트/tool_calls 로 재구성한다(정규화 규칙과 같은 필드만 쓰므로 가능). 비정상 종료 시 세션 파일 삭제.
- 로그: 요청당 `session=new|resumed|fallback id=<8자>` 를 기존 `claude -p →` 로그 줄에 덧붙인다.
- **히트율 관측(회귀 감지).** 캐시는 조용히 죽는다: CLI Update 버튼이 브레이크포인트 정책을 바꾸거나, 클라이언트가 시스템 프롬프트에 매 턴 시각을 넣기 시작하면 히트율이 0 이 되고 아무 오류도 없다. `recordRateLimitEvent` 가 계정별 창을 누적하는 자리(`claudeCliRateLimits.js`)에 나란히 계정별 `cacheReadTokens / promptTokens` 누적을 두고, 쿼터 카드의 routed usage 에 "cache hit %" 한 줄로 노출한다(`open-sse/services/usage/` 의 `usageRouted` 경로를 따라간다). 또 `resumed` 인데 `cache_read_input_tokens` 가 직전 입력의 20% 미만이면 `CLAUDE-CLI` 로그에 `cache-miss-on-resume` 한 줄 — 이 줄이 모이면 정책 변화를 의심할 근거가 된다.
- 시스템 프롬프트가 같은 세션 안에서 바뀌면(키 미스의 가장 흔한 원인) 로그에 `system-changed` 표기. 클라이언트 쪽 원인을 운영자가 구분할 수 있게.

### 2.3 계정 결합과 fallback 상호작용

- `src/sse/handlers/chat.js` 의 계정 fallback 이 다른 연결을 고르면 `accountKey` 가 달라져 자연히 미스. 추가 코드 없음.
- resume fallback(2.2)은 실행기 내부에서 끝난다. `chatCore.js` 의 재시도/계정 잠금 로직에 도달하지 않도록, 실행기가 반환하는 `response` 는 fresh 재실행의 결과여야 한다.

### 2.4 테스트

단위(`tests/unit/`):
- `claude-cli-sessions.test.js`(신규): 키 정규화(같은 대화·다른 `reasoning_content` → 같은 키, tool_call id 하나 다르면 다른 키, `arguments` 공백·키 순서만 다르면 같은 키), `splitQueryFrame` 이 병렬 tool 결과 3개를 한 프레임으로 떼는지, lookup/remember 연속 동작(턴 N 의 remember 키 = 턴 N+1 의 lookup 키 — user 후속과 tool 결과 후속 둘 다), in-flight 시 null, TTL sweep 과 startup sweep 이 `9router-claude` 접두 디렉터리만 지우는지(fs 는 주입).
- `claude-cli-executor.test.js`: `buildClaudeCliArgs` 에 `sessionId`/`resumeId` 가 있을 때 `--no-session-persistence` 가 빠지고 해당 플래그가 들어가는지, 둘 다 없을 때 오늘과 byte-동일한지. 가짜 CLI(기존 테스트가 쓰는 canned stream-json 방식)로 resume 실패 → fresh 재실행 1회, 델타 송출 후에는 재실행 없음.
- `claude-cli-replay.test.js`: 변경 없음이어야 함(회귀 확인).

서버 구동형(`scripts/fork/`):
- `check-claude-cli-empty-response.mjs` 는 그대로 통과해야 한다(플래그 off 기본).
- `check-claude-cli-resume-cache.mjs`(2.0) 에 "9Router 경유" 모드 추가: `CLI_CLAUDE_SESSION_CACHE=1` 서버에 3턴을 보내고 `usage.prompt_tokens_details.cached_tokens` 로 같은 판정. `fork-manifest.mjs` 에 등록.

live(`tests/real/claude-cli.real.test.js`): 캐시 히트 케이스 1개 추가(자격 증명 없으면 skip 하는 기존 관례 따름).

### 2.5 문서

- `open-sse/providers/registry/claude-cli.js` 의 `notice.text` 에 세션 캐시 플래그와 "대화가 호스트 세션 파일에 TTL 동안 기록된다"는 문장 추가.
- `config/claudeCli.js:93-110` 릴레이 주석에 "세션 캐시(`CLI_CLAUDE_SESSION_CACHE`)가 대체 경로" 한 줄.
- `FORK-CHANGELOG.md` Unreleased 에 항목. `.env.example` 에 두 플래그.
- `AGENT-HANDOFF.md`(컨테이너): 세션 파일이 `CLAUDE_CONFIG_DIR` 볼륨 아래 쌓이므로 볼륨 용량과 TTL 언급. 레지스트리는 프로세스 메모리라 **단일 프로세스 전제** — K8s 의 `Recreate` 롤아웃(이미 그렇게 고정됨)이 이 전제를 지킨다는 문장 추가.
- 운영자용 한계 명시(설계 문서 6.1절 참조): 5분 TTL, 매 턴 바뀌는 시스템 프롬프트, CLI 버전 변경.

---

## Phase 3 — 분기 마무리

### 3-A (세션 캐시 채택)

- 릴레이 코드는 삭제하지 않는다(이번 커밋). `cacheRelayEnabled` 주석에 superseded 표기만. 삭제는 세션 캐시가 기본값이 된 뒤 별도 커밋.
- 커밋 메시지는 Conventional Commits: `feat(claude-cli): reuse Claude Code sessions so the prompt cache survives across turns`. 본문에 2.0 측정치(턴별 cache_read, CLI 버전, 계정 종류)를 적는다.

### 3-B (릴레이 채택, A 게이트 실패 시)

- Phase 1 에서 찾은 원인과 수정(프록시 env 병합, 프록시 인식 업스트림 hop, keep-alive close 등)을 `claudeCliAdmission.js` / `claude-cli.js` 에 반영.
- `[1m]` 모델 매핑을 gateway 모드 기본값과 맞춘다(`CLAUDE_CLI_UPSTREAM_MODELS`, 설계 문서 H5).
- `claude-cli-admission-relay.test.js` 에 프록시 env 하에서 loopback 이 직접 연결되는지, 404 가 `connection: close` 인지 케이스 추가.
- live 28/28 재확인 후에만 `CLI_CLAUDE_CACHE_RELAY` 기본값을 논의. 이 커밋에서는 바꾸지 않는다.
- 커밋: `fix(claude-cli): make the cache relay hold up inside the Next server` + 원인 서술.

---

## Phase 4 — 기본값 전환 (별도 커밋, 사용자 승인 후)

조건이 모두 참일 때만:
- 서버 구동형 점검 전부 통과(`scripts/fork/verify-fork.mjs` 포함).
- live 3턴 측정에서 2·3턴 캐시 히트 80% 이상, 5회 반복 안정.
- 24시간 이상 opt-in 운영에서 계정 잠금 로그(`locked ... for 30s`) 증가 없음.

그때 `sessionCacheEnabled`(또는 `cacheRelayEnabled`) 기본값을 `1` 로 올리고 `.env.example`, registry notice, `FORK-CHANGELOG.md` 갱신.

---

## 하지 말 것

- 헤더 추가·변경(`anthropic-beta`, `user-agent` 등). 릴레이 경로에서도 hop-by-hop 제거 이상은 손대지 않는다.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` 을 자식에 넘기는 것. allowlist 에 `ANTHROPIC_*` 추가 금지(릴레이의 `ANTHROPIC_BASE_URL` 은 spawn 시점 명시 주입이며 allowlist 와 별개).
- `CLI_CLAUDE_UPSTREAM_OVERRIDE` 를 Dockerfile, `.env.example`, K8s 매니페스트, 대시보드 설정에 넣는 것. 테스트 하네스의 셸에서만 쓴다. 가짜 업스트림은 `authorization` 헤더를 저장·출력하지 않는다.
- `--max-turns` 를 1 이외로. `max_turns` 요청 필드는 계속 무시.
- 실제 계정으로의 자동 반복 호출(cron, 루프). 측정은 사용자가 지정한 연결로, 명시된 횟수만.
- 세션 파일을 TTL 없이 남기는 것. `--no-session-persistence` 를 빼는 순간 정리 코드가 같은 커밋에 있어야 한다.
- `tests/package.json` 의 `test` 스크립트 수정(업스트림 워크어라운드). `npx vitest run` 을 쓴다.
- 릴레이 코드 삭제(이번 작업 범위 밖).

## 측정 기록 (구현 에이전트가 채움)

모두 2026-09-24, CLI 2.1.281, macOS 호스트 기본 로그인(claude.ai, 키체인), 모델 `claude-cli-haiku`(haiku 4.5), 프록시 없음.

**2.0-b — CLI 직접 호출(9Router 미경유), 시스템 프롬프트 약 14.4k 토큰:**

| 방식 | 턴1 input/create/read | 턴2 | 턴3 | 판정 |
|---|---|---|---|---|
| 대조군(전체 재생) | 10 / 14796 / 0 | 10 / 430 / 14428 | 10 / 469 / 14428 | read 가 system 크기에서 멈춤 — 히스토리 매 턴 재처리 |
| A: `--session-id` + `--resume` | 10 / 368 / 14428 | 10 / 283 / 14796 | 10 / 176 / 15079 | 턴마다 직전 prompt 전체(100%) read |
| A: 첫 턴이 이미 히스토리 포함 | 10 / 394 / 14428 | 10 / 377 / 14822 | — | 100% |

**2.4 — 9Router 경유(`check-claude-cli-cache-offline.mjs --live`), 턴마다 긴 질문 문단:**

| 방식 | 턴2 cached / 직전 prompt | 턴3 | 판정 |
|---|---|---|---|
| plain (둘 다 off) | 6424 / 8120 (79%, system 만) | 6424 / 9484 (68%) | 미스 |
| relay on | 6424 / 8123 | 6473 / 9483 | 미스. hang 없음 |
| session on | 8138 / 8148 (100%) | 9577 / 9587 (100%) | **히트** |

Phase 1 stats (live):

```
cache relay {"forwarded":1,"pinned":0,"refused":1,"admitted":1,"failure":null,"status":200,"requestId":"req_011CfNCjTenA9Zc4avCLPPWn"}
cache relay {"forwarded":1,"pinned":1,"refused":1,"admitted":1,"failure":null,"status":200,"requestId":"req_011CfNCjeQSMdTzEpJco8N2N"}
```

**오프라인(가짜 업스트림) 본문 비교:** 대조군은 턴2 본문의 `messages[0]` 가 **assistant** 다. `shouldQuery:false` 로 보낸 과거 user 턴이 사라지고, 그 텍스트가 새 user 턴 안에 CLI 리마인더 뒤로 합쳐져 들어간다(아래 설계 문서 2.2절). resume 경로는 직전 요청 블록 전부 + 직전 브레이크포인트가 그대로 재현된다.
