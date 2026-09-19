# AUDIT-REPORT — 9router-enhanced (auditoria autônoma)

Data base: HEAD em `docs/orchestration/STATE.md`. Metodologia: 9 auditores
read-only de contexto limpo (T0.3, T1.1–T1.8), cada achado com evidência
`path:linha` confirmada; correções com teste red→green; gates = baseline
vitest (`tests/__baseline__/verify-no-regression.mjs`), eslint, build.

Estado dos gates (pré-onda, colhido na rodada 3):
- build: ✓ exit 0 (compilado em 55s)
- eslint: em execução
- vitest full: 3 desvios vs known-fails (mimo-free.live ×2, usage-event-identity ×1) — causa raiz em T0.3

## Severidade
- **HIGH** = perda de dados, indisponibilidade, exposição de segredo, authz quebrada
- **MED** = degradação silenciosa, cota/usage errados, estado travado, UX quebrada em caso comum
- **LOW** = robustez menor, edge case raro

## Achados por área
(áreas: T1.1 routing core · T1.2 translator/registry · T1.3 auth/segurança · T1.4 persistência · T1.5 dashboard/API+catálogo · T1.6 CLI/packaging · T1.8 /v1 non-chat · T0.3 baseline)

### T1.4 — persistência SQLite (findings/T1.4.md)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| H-1 | HIGH | src/lib/db/migrate.js:17-18,222-281 | import legacy abortado (MigrationAborted) nunca retry: _meta já marca schemaVersion → 2º boot pula p/ sempre; app roda vazio com db.json presente (repro BOOT1/BOOT2) | CORRIGIR → F7 |
| H-2 | HIGH | src/lib/db/backup.js:44 | backupDbLite via ATTACH falha sob sql.js ("unable to open database", repro) → sem backup pré-schema no driver de último recurso, erro engolido | CORRIGIR (backup nativo do sql.js) → F7 |
| H-3 | HIGH | src/lib/db/driver.js:82-83 | initPromise congelado na 1ª rejeição transitória; closeAdapter não limpa → getAdapter() rejeita para sempre pós-reparo (repro D2) | CORRIGIR → F7 |
| M-1 | MED | src/lib/db/adapters/sqljsAdapter.js:24-38 | persist writeFileSync não-atômico + boot não valida gravabilidade → saves falham silenciosos (perda total de escrita) | CORRIGIR → F8 |
| M-2 | MED | sqljsAdapter.js:110-112 | SIGINT/SIGTERM handlers sem exit, divergente do design dos outros adapters | CORRIGIR → F8 |
| M-3 | MED | repos/usageRepo.js (usageHistory/usageDaily) | retenção inexistente → crescimento ilimitado | CORRIGIR conservative: env USAGE_RETENTION_DAYS default OFF (reversível; doc) → F8, decisão D8 |
| M-4 | MED | src/lib/db/index.js:90-93,112 | exportDb/importDb omitem disabledModels → restore do backup perde dados | CORRIGIR → F8 |
| L×4 | LOW | ver findings/T1.4.md | (triagem pendente de leitura integral na hora do gate) | F8/F6 backlog |

Limpezas confirmadas T1.4 (registradas como não-bugs): sem SQL injection; shims 100% cobertos; migrations idempotentes; rotação de backups ok.

### T1.8 — superfície /v1 non-chat (findings/T1.8.md)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| V1 | HIGH | open-sse/utils/ollamaTransform.js:72-83 | /v1/api/chat (Ollama): Response sem status + parser só aceita `data:` SSE → 401/400/5xx ou non-stream vira 200 NDJSON content vazio — falha 100% silenciosa | CORRIGIR → F9 |
| V2 | MED | src/app/api/v1/audio/voices/route.js:33-35 | self-fetch a /api/media-providers sem credencial → sempre 401 sob requireLogin (deny-by-default); models/info:31-33 anuncia URL quebrada; origin do Host (GET path-fixo) | CORRIGIR (padrão F1) → F10 |
| V3 | MED | src/app/api/v1/models/route.js:410-416,504-506 vs :539 | enabledModels da PRIMEIRA conexão ativa pula union multi-conta do catálogo → viola MODEL_SYNC_CATALOG.md:33-34; discovery ≠ routable | CORRIGIR → F11 |
| V4 | MED | handlers images/videos/tts/stt/search/web-fetch + embeddings gemini.js:51 | usage/quota ZERados nesses caminhos (sem saveRequestUsage); embeddings normaliza usage 0 fixo | CORRIGIR → F12 |
| V5 | MED | open-sse/services/tts.js/stt.js | sem checkAndRefreshToken nem clearAccountError no loop de fallback (paridade com chat) | CORRIGIR → F12 |
| V6 | LOW | /v1/responses/compact route | request.json() sem try → 500 | CORRIGIR → F10 |
| V7 | LOW | src/app/api/v1/models/info/route.js:13 | anuncia webFetch="/v1/fetch" (inexistente; real /v1/web/fetch) | CORRIGIR → F10 |
| V8 | LOW | 6 rotas sem requireApiKey in-handler (v1/route, models*, count_tokens, audio/voices) | mitigado pelo middleware p/ remoto; furo só loopback/CLI-token | ACEITO com nota (documentar que guard é no middleware) — backlog |
| — | GAP | gateway inteiro | rate-limit inexistente (só loginLimiter) | ACEITO como gap de design documentado (produto local; mudança de comportamento não-trivial) — backlog |
| V9-12 | LOW | ver findings/T1.8.md | demais baixos | triagem na hora do gate 2b |

Não-achados T1.8 confirmados (registrados como verificados-ok): SSRF guard do web/fetch (fetch.js:88), sufixos /search /fetch por capability (webRouting.js:54-74), videos/[id] sem traversal, unavailable/temporarily-absent respeitados, sem vazamento de keys/connectionId. Veredito 21 rotas: guard OK 15, ausente 6 (V8).

### T1.3 — auth/OAuth/segurança (findings/T1.3.md; 161 rotas auditadas, deny-by-default do guard CONFIRMADO p/ 100% de /api/*)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| T3-F1 | HIGH | open-sse/handlers/search/callers.js:78-93 + index.js:67; src/sse/handlers/search.js:133 | exfiltração: cliente manda provider_options.baseUrl e o servidor ANEXA a API key salva do dono do gateway → rouba serper/tavily/exa; guard é só camada-1 (sem DNS-resolve/fetchPublic) | CORRIGIR → F28 |
| T3-F2 | HIGH | src/lib/auth/saml.js:101,149-157,63-88 | SAML: validateInResponseTo:"never" quando cookie saml_state ausente = replay; destination derivada de X-Forwarded-Host spoofável | CORRIGIR → F29 |
| T3-F3 | HIGH | src/mitm/manager.js:98,154-161 + settings/route.js:20 | senha sudo MITM cifrada com fallback sha256(salt HARDCODED "9router-mitm-pwd") quando machineIdSync falha; ciphertext sai por GET /api/settings | CORRIGIR (sem fallback: recusar+erro) → F30 |
| T3-F4 | HIGH | src/app/api/cli-tools/*-settings route.js:126,158-166 vs dashboardGuard.js:72-88 | gravam env arbitrário em ~/.claude/settings.json sem LOCAL_ONLY | CORRIGIR → F21′ (LOCAL_ONLY cluster) |
| T3-F5 | MED | settings/route.js:79 | PATCH desliga requireLogin só com JWT (documentado como modo local); detecção pública removida pelo F1 | ACEITO c/ nota (design); endurecimento de aviso p/ backlog |
| T3-F6/7/8 | MED | custom-server.js:74-78,79-83; dashboardGuard.js:113-117; login/route.js:58-68; oidc.js:22-40 | primeiro hop XFF confiável em loopback → rotaciona loginLimiter + envenena IP; dev sem wrapper: Host:localhost forja local (123456 remoto!); XFH contamina redirect_uri OIDC | CORRIGIR → F21′ (dono único de dashboardGuard+custom-server) |
| T3-F9 | MED | dedup.js:22 + ausência de lock multiprocesso | dedup cacheia null de falha 10s; sem lock entre processos → RT rotativo queimado (repo+CLI no mesmo DATA_DIR) | null-cache → F26; lock multiprocesso → BACKLOG (design) |
| T3-F10 | MED | errorConfig.js:71 + chat.js:289-301 | API key morta: cooldown 2min ETERNO re-tentado, 503 mascarado p/ client | CORRIGIR (credencial→estado de erro até ação) → F25 (par c/ RH2) |
| +5 L +1 INFO, F-14/15 | LOW/TODO | pxpipe install/version-update NÃO afundados | verificação pendente → F32 (leitura dirigida) |
| — | OK | JWT_SECRET gerado 0600 sem default; OIDC PKCE+state+nonce+jose; mustChangePassword; sanitizeHeaders; catalog-sync URL fixa; connectionCatalog fetchPublic | (verificadas sãs — registradas) |

### T1.1 — routing core (findings/T1.1.md; 6/20 bugs reproduzidos via /tmp/t11/*.mjs)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| RH1 | HIGH | src/sse/handlers/chat.js:440-443 + open-sse/utils/circuitBreaker.js:174-180 | onDisconnect de stream NÃO grava outcome → probe HALF_OPEN abortado pelo cliente trava breaker em HALF_OPEN PARA SEMPRE (sem timer de saída) — mata conta+modelo até restart de processo | CORRIGIR → F24 |
| RH4 | HIGH | src/sse/handlers/chat.js (try/finally sem catch) | laço de contas sem catch → exceção vaza em vez de fallback | CORRIGIR → F24 |
| RH2 | HIGH | open-sse/services/accountFallback.js:23-50 | checkFallbackError retorna shouldFallback:true SEMPRE (repro: 400/404/200→true) → 400 do próprio request locka todas as contas de todos os membros do combo 30-120s (auth.js:282) = 503 mascarado self-inflicted | CORRIGIR → F25 |
| RH3 | HIGH | open-sse/handlers/chatCore.js:444-488 + executors/default.js:265 + tokenRefresh.js:257-273 | refresh reativo de 401 IGNORA withCredentialRefreshLock/dedupRefresh; invalid_grant(400)→null → refreshWithRetry re-tenta 3× com refresh_token JÁ ROTACIONADO (repro: 3 POSTs) → risco de revogar família de tokens | CORRIGIR → F26 |
| RM5 | MED | src/lib/db/repos/connectionsRepo.js:29 | refresh de 401 apaga TODAS as modelLock_* da conta (não só a do modelo) | CORRIGIR → F27 |
| RM7 | MED | chat.js trackPendingRequest | decremento duplo/não-pareado | CORRIGIR → F27 |
| RM8 | MED | translate path SSE | falta `data: [DONE]` no caminho translate | CORRIGIR → F27 |
| RM9 | MED | applyJsonSchemaFallback | muta body compartilhado → prompt duplica a cada retry | CORRIGIR → F27 |
| RM11 | MED | painel reset breaker | usa chave `provider:conn` vs real `provider:conn:model` → no-op silencioso devolvendo {ok:true}; é a ÚNICA recuperação hoje p/ RH1 | CORRIGIR junto c/ RH1 → F24 |
| demais M/L | MED/LOW | ver findings/T1.1.md | (11 medium, 5 low no total) | triagem residual no gate 2b |

Nota de cobertura: nenhum teste importa checkFallbackError; os 5 testes de markAccountUnavailable MOCKAM shouldFallback:false — valor que o código real nunca produz. F25/F26/F27 devem escrever testes que falhariam se os bugs voltassem (snippets de repro prontos em /tmp/t11/).

### T1.2 — translator engine + registry (findings/T1.2.md; evidência = execução do motor)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| A1 | HIGH | open-sse/translator/index.js:198-211 + responseRegistry | cliente gemini/gemini-cli/vertex recebe chunks OpenAI CRUS no streaming (sem rota openai→gemini; JSON path tem conversão → assimetria) | CORRIGIR (registrar rota de resposta, padrão antigravity) → F16 |
| A2 | HIGH | response/openai-to-claude.js:188-211 | `name` em chunk posterior ao `id` → tool_use com name:"" | CORRIGIR → F13 |
| A3 | HIGH | response/openai-to-claude.js:188,213-219 | upstream sem `id` (vLLM/compat) → tool_calls descartados, stop_reason tool_use sem bloco; irmãos usam fallbackToolCallId | CORRIGIR → F13 |
| A4 | HIGH | concerns/toolCall.js:169-187,205-216 + formats/claude.js:107-161 | tool_results paralelos parciais → tool_use órfão → Anthropic 400 (limitação admitida em comentário, só Kiro contornado) | CORRIGIR → F14 |
| M5 | MED | request/openai-to-claude.js:133-141 | system "You are Claude Code…" injetado em TODA req openai→claude (persona + cache 1h paywall) | INVESTIGAR+CONDICIONAR (pode ser hack intencional p/ OAuth claude; ver git history antes) → F15 |
| M6 | MED | response/openai-to-claude.js:225-257 | finish_reason duplicado → 2× message_stop (state.finishReasonSent existe mas não é consultado) | CORRIGIR → F13 |
| M7 | MED | concerns/thinking.js:11 + thinkingUnified.js:252-255 | effort minimal → budget 512 < piso 1024 que o próprio repo usa (formats/claude.js:439) | CORRIGIR (piso na entrada) → F15 |
| M8 | MED | open-sse/rtk/index.js:24-117 | compressão in-place + falha no meio → body mutilado reportado como "nada feito" (contrato fail-open violado) | CORRIGIR (snapshot/rollback ou clone de entrada) → F17 |
| M9 | MED | request/claude-to-openai.js:171-219 | pivot claude→openai descarta is_error/document/thinking/server_tool_use; tool_result só-imagem → base64 a texto | CORRIGIR (is_error obrigatório; demais ao menos WARNING) → F17 |
| M10 | MED | src/app/api/v1beta/models/[...path]/route.js:374-402 + sseToJsonHandler.js:249-266 | /v1beta reimplementa tradução gemini fora do translator: perde tools/inlineData; JSON path DESCARTA tool_calls recém-extraídos | CORRIGIR (delegar ao translator existente) → F18 |
| M11 | MED | open-sse/providers/index.js:39 | colisão PROVIDER_MODELS["mmf"] (alias mimo-free × id mmf), last-writer silencioso; hoje inofensivo (ambos hidden, listas iguais) mas sem sinal p/ edições futuras | CORRIGIR (warn on collision) → F19 |
| B1–B9 | LOW | ver findings | mutação do body do chamador (B1), import morto (B2), hardcoded strings (B3), registerAll obsoleto (B4), imports ocultos mortos (B5), prefixos tool assimétricos (B6), initState fantasma (B7), 4 providers sem catálogo (B8→ver F23/M3), log intermediário (B9) | BACKLOG seletivo: B8 vira tarefa no domínio status de modelos; B2/B3/B5/B7 = refactors não-ordenados; demais backlog |

### T1.6 — CLI/packaging (findings/T1.6.md)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| C1 | CRÍTICA | cli/scripts/build-cli.js:16-26,113-121,179-182 | tgz carrega HOME real de build: jwt-secret + machine-id + data.sqlite(+WAL) + backups sob .build-home/.9router — CONFIRMADO no blob git-tracked 9router-0.5.69.tgz (hash do jwt-secret ≠ segredo vivo desta máquina; verificação por hash, sem impresso) | CORRIGIR → F20 + untrack *.tgz + nota de rotação (D9) |
| H1 | HIGH | src/app/api/version/route.js:33-40 | compareVersions NaN-cego p/ "0.5.75-enhanced.1" (mesmo bug que 943b8f82 corrigiu só no CLI) → hasUpdate SEMPRE false → update notice do dashboard MORTO no fork | CORRIGIR → F21 |
| H2 | HIGH | scripts/cutover-guard.mjs:88 + build-cli.js:163-165 | guard valida versão do ROOT em vez da de cli/package.json; build reescreve package.json do root no pack | CORRIGIR → F20 |
| H3 | HIGH | cutover-guard.mjs:67-77 | resolveInstalledRoot depende de marker que ninguém escreve → fail-open na maioria das instalações; testes :46,:62 canhonizam o fail-open | CORRIGIR → F20 |
| M×7 | MED | cli/cli.js, appUpdater.js, dashboardGuard.js | restart SIGKILL vs drain prometido; matching "next-server"/"9router" mata processos de terceiros; /api/version/{update,shutdown} fora de LOCAL_ONLY_PATHS (LAN → `npm i -g` substitui fork!); sql-wasm.wasm ausente no bundle + NODE_PATH sombreando self-heal; killTray sem await; crash-recovery edita db.json extinto; "Hide to Tray" liga autostart sem pedir | F21 (authz version routes) + F23 (launcher cluster) + F20 (wasm) |
| L×5 | LOW | ver findings | .desktop sem quote; npmignore vs files; MAX_PORT_ATTEMPTS morto; --skip-update sobrecarregado; ruído do guard + 14MB blob no git | blob → F20; demais backlog |

### T1.5 — dashboard/API + catálogo (findings/T1.5.md)
| id | sev | arquivo:linhas | resumo | veredito → tarefa |
|----|-----|----------------|--------|-------------------|
| A1 | HIGH | src/app/api/settings/database/route.js:10-12 | isCliRequest só checa PRESENÇA do header x-9r-cli-token → pula re-auth por senha no dump/import do DB (que guarda keys cruas + tokens OAuth) | CORRIGIR → F1 |
| M1 | MED | src/app/api/models/route.js:96,29 | PUT setModelAlias(model,alias) invertido → aliases gravados nunca resolvem no /v1 + GET lê com convenção invertida | CORRIGIR → F2 |
| M2 | MED | src/app/api/providers/[id]/test-models/route.js:32 | self-fetch sem headers → 401 sob login padrão → "Test models" quebra p/ custom nodes | CORRIGIR → F1 |
| M3 | MED | src/app/api/combos/route.js:41; combos/[id]/route.js:32 | models não validados como array; rename com name:"" corrombe registro; kind aceito sem validar; TOCTOU dup → 500 | CORRIGIR → F3 |
| M4 | MED | src/lib/modelSync/scheduler.js:7 vs providers/route.js:197 | CONNECTION_MODEL_SYNC=off não cobre sync de criação/migração (só scheduler) | CORRIGIR (flag vira chokepoint p/ syncs automáticos; manual POST continua) → F4 |
| M5 | MED | src/app/api/providers/[id]/model-catalog/route.js:43-52 | POST sem single-flight/cooldown por conexão → DoS+burn de quota com requireLogin=false | CORRIGIR → F4 |
| M6 | MED | src/app/api/providers/validate/route.js:107-222 | fetches a baseUrl arbitrário sem timeout (hang) | CORRIGIR → F5 |
| B1 | LOW | src/app/api/usage/stream/route.js:53-61 | listeners do statsEmitter vazam no caminho keepalive-catch (sem cancel) | CORRIGIR (1 linha off()) → F5 |
| B2 | LOW | src/app/api/providers/[id]/route.js:104-167 | lost-update em providerSpecificData (snapshot merge) + null→200 {} | CORRIGIR null→404; lost-update → ADIAR (nota) → F6 |
| B3 | LOW | src/app/api/keys/[id]/route.js:76-78 | PUT corrida c/ DELETE → 200 {key:null} | CORRIGIR → F5 |
| B4 | LOW | src/app/api/settings/require-login/route.js:9-11 | rota pública vaza hostnames de tunnel/tailscale | CORRIGIR (verificar consumid. UI antes) → F1 |
| B5 | LOW | src/app/api/provider-nodes/[id]/route.js:93-97 | DELETE não-transacional + deixa combos órfãos | CORRIGIR transação + aviso; órfãos via helper existente se trivial → F6 |
| B6 | INFO | src/app/api/combos/remove-model/route.js:24 | sem reset de rotação (inofensivo p/ round-robin atual) | NIT — consistência barata → F3 |
| B7 | LOW | models/alias:27 sem dup-check; models/custom:31 aceita não-strings | poluição KV | CORRIGIR → F2 |
| B8 | LOW | src/app/api/settings/route.js:34,116,46-71 | 500 com message cru; newPassword "" silencioso | CORRIGIR (400 no "" + message genérico) → F5 |

Onda M2 definida: **F1** A1+M2+B4 (security/authz cluster) · **F2** M1+B7 (aliases+custom models) · **F3** M3+B6 (combos) · **F4** M4+M5 (model sync) · **F5** M6+B1+B3+B8 (validate/stream/keys/settings) · **F6** B2+B5 (providers/[id] + provider-nodes). Despacho após gate T0.4 + chegada de T1.3/T1.8 (sobreposição de área).

## Correções aplicadas
| fix | achado | commit | teste |
|-----|--------|--------|-------|
| T0.2 | pattern qwen3.8-flash-next-nvfp4 fora da ordem (genérico *qwen* engolia) | ba194ab3 | golden-url-header 130✓ + capabilities ✓ |
| T0.4 | usage-event-identity cwd-dependence; mimo-free.live assertando serviço morto (400 mimo-auto) | d08e79b2 | gate canônico ✅ 35/35 known, exit 0 |
| F24a-1 | T1.1 RH1 (metade 1): breaker preso em HALF_OPEN | f5b36bc7 | red (HALF_OPEN→esperava OPEN) → green 53/53 nos 5 arquivos do breaker; eslint 0 novos |
| F28 | T1.3 F-1 exfiltração de chave via provider_options.baseUrl | 7ad05cc5 | RED capturou header exfil; GREEN 23/23 (IPv6/mapped/rebinding/redirect/non-vacuity) + 102/102 vizinhos; confirmado por DIAG externo + suíte cheia (36 fail=all known) |
| F24a-b | T1.1 RH1 (metade 2): abort de probe prendia breaker | 5ca40b9a | settleProbe fail-closed só p/ probe pendente; CLOSED/DEGRADED no-op; 57/57+68/68 |
| F20 | T1.6 C1+H2+H3 build/pack (CRÍTICA segredo no tgz) | 22fe376b | audit gate aborta pack c/ .build-home (exit demonstrado); fail-closed cutover; 67/67 |
| T3.1 | OMNIROUTE-DIFF T-A credential health sweep (M3) | 30b30931 | 18/18+adj 65/65; UI zero-mudança provada (dots já liam testStatus) |
| F25 | T1.1 RH2 checkFallbackError sempre-true (self-DoS de combo) | 4392b4c6 | matriz + integração real (tried=1, zero cooldown writes); 111/111 suítes shouldFallback; repro fb.mjs invertido |
| F25-fx | regressão entre clusters: caller sync esquecido do backupDbLite async da F7 | a48373af | 25/25 request-details-tab verde |
| F13 | T1.2 A2/A3/M6 (name tardio, id ausente, 2× message_stop) | cc4c716a | RED 8→GREEN 11/11; translator 385 pass sem snapshot drift |
| F21′ | T1.6-H1 update notice morto + T1.3 F-4/F-6/F-7/F-8 (LAN→npm i -g; XFF spoof; XFH redirect_uri) | 5007e497 | 105/105; TRUSTED_PROXY_HOPS default 0; canônico peer-headers atualizado c/ justificativa |
| F26 | T1.1 RH3 refresh reativo sem lock + RT rotacionado re-tentado | bfa33553 | 3→1 POSTs IdP; sentinela unrecoverable; ALS reentrancy (HUNG→resolve) |
| F14 | T1.2 A4 tool_use órfão paralelo parcial | 7c54cfee | sintético p/ claude target; 435 pass translator gate |
| F15 | T1.2 M5 persona incondicional + M7 budget 512 | 9085da9a | git-archaeology p/ OAuth-gate; snap só perdeu persona; 426/0-fail |
| F16 | T1.2 A1 streaming gemini cru | 30995bb5 | RED A1 e2e→GREEN 7/7; 387 pass sem drift |
| F13-r | regressão cc4c716a (colisão de chave initState entre pernas do pivot — T1.2 B7 materializado) | a1dd438a | causa raiz debugada (args presos+sem message_stop em Codex/xAI→claude); 7/7+11/11+406/0; A/B sem drift |
| F9 | T1.8 V1 Ollama 200-fantasma (HIGH) | d2c7c2a0 | RED 18f (200-vazio reproduzido)→GREEN 19/19; regressão ollama 26/26 |
| F11 | T1.8 V3 enabledModels primeira-conexão | ad2549e9 | union por conta c/ regra unavailable própria; 7/7 + 160/160 |
| F24c | T1.1 RM11 reset no-op {ok:true} | 6e135eae | sweep por prefixo c/ limite de segmento; 404 honesto; 16/16+73/73; achou F24d (badge) |
| F24b | T1.1 RH4 laço sem catch (+latch outcome) | 99045eff | RED 7f→GREEN 10/10; RM7 real localizado em chatCore/stream → F27 |
| F24d | T1.1 RM11 follow-up badge inatingível (D11) | 57a58b10 | worst-state por prefixo no client; 14/14+44/44 |
| F17 | T1.2 M8 (RTK in-place) + M9 (is_error/imagem/tipos no pivot) | 503ae3df | copy-on-success; [tool_error]+data URI+warn agregado; 2 flips it.fails; 389/14xf/0unexp |
| F3 | T1.5 M3 (combos sem validação/rename órfão/UNIQUE 500) + B6 | 304ecdbe | kinds c/ fonte verificada; UNIQUE→400 na rota; RED 13f→GREEN 22/22; regressão 121/121 |
| F12 | T1.8 V4 (usage 0 em 6 modalidades+embeddings gemini) + V5 (tts/stt sem refresh) | b5f1e098 | recorder compartilhado fail-open; polls não cobrados; 33+4 green, 217 regressão |
| F4 | T1.5 M4 (kill-switch parcial) + M5 (sem single-flight) | 96f226aa | chokepoint automatic+cooldown 30s deduped; 18/18+169 adj | docs@d269dcb3 |
| F1 | T1.5 A1 (cli-token aceito por presença) + M2 + B4 | 31ab1b34 | isCliRequest valida valor vs machineId; require-login sem túneis (AUD-2 recovery) |
| F2 | T1.2 M1 (aliases escritos invertidos) + B7 | 74602321 | convenção canônica {alias:"provider/model"}; duplicatas 400 |
| F5 | T1.5 M6 (probes user-host sem timeout) + B1 (leak listeners) + B3/B8 | 0e337a94 | AbortSignal 8s×6 fetches; off() no catch do keepalive; 404/400 honestos |
| F27 | T1.1 RM5/RM7/RM8/RM9 | f2b4b472 | settle-once WeakMap; [DONE] real no translate; 24/24+150+35=35 known |
| F18 | T1.2 M10 (/v1beta fora do translator) | 558feda4 | delegação canônica (−39 linhas); functionCalls no JSON; 10/10+78 |
| F19 | T1.2 M11 (colisão PROVIDER_MODELS silenciosa) | 15a44a75 | warn só-listas-diferem; mapa 90-entrada provado idêntico; 7/7+baselines ✓ |
| F33 | REV-B nit1 /v1beta response-side perdia tool_calls | 936188b3 | delegação canônica; guards byte-exact; 7/7+26/26 |
| F35 | REV-B nit3 retired×curation multi-conta (domínio usuário) | f331c16e | enabledModels = evidência live; non-vacuity dos 2 lados; 253 regressão |
| F36+F36b | REV-B nit4 name-dup gemini+antigravity | 4f9aef12, e20b1532 | primeira-nome-vence; translator 389/14xf/0 sem drift |
| F30 | T1.3 F-3 MITM sudo pwd com sha256(salt hardcoded) | 17577a43 | recusa crypt sem machine key; purge do key-known; 6/6+11/11 |
| F6 | T1.5 B2/B5 (delete não-transacional; 200-fantasma) | 667b6d4b | tx única via sync cores; warning de combos órfãos sem poda surpresa; 4/4+192 |
| T3.5 | OMNIROUTE-DIFF T-E matriz saúde lite | f1917c33 | unknown≠down; achou o furo prefixo→F38; gate completo ✅ 35/35 known |
| F37 | F32 REAL-FIX pxpipe remoto→RCE-equiv | 3879f7bf | LOCAL_ONLY + pin 0.13.2 + --ignore-scripts; 16/16+74 |
| F23 | T1.6 M1/M2/M3rt/M5/M6/M7 launcher | 6308faac | drain 8s; posse por fato; NODE_PATH validado; tray await; remoções honestas; 52/52+110 |
| F38 | T3.5 achado allow-list prefixo | bdc4d2a3 | exato p/ públicas; oidc/saml children explícitos; 84+60 |
| F39 | mount ProviderHealthBadge | 870f9929 | +2 linhas; trigger ModelAvailability WIP-upstream → backlog |
| F32 | T1.3 F-14/F-15 (não-afundados) → vereditos | findings/F32.md | pxpipe REAL-FIX→F37; version/update JÁ-FECHADO/F21′; residuais baixos documentados |
| F8 | T1.4 M-1..M-4, L-1, L-3 (sqljs atômico+boot-check, retenção opt-in D8, disabledModels round-trip, exit-flush síncrono, dataDir sem throw) | 01345ad6 | f8 24/24 + regressão 87/87 + eslint 0 |
| F7 | T1.4 H-1..H-3, L-2, L-4 (import retryável com importStatus+self-heal, backup real em sql.js, initPromise/geração no driver, warnings de schema drift) | 3861ad9f | red 11/12→green 12/12 + db-* 15/15 + e2e BOOT1/2/3 |

## Revisões de marco (não-autores)
- REV-A (segurança/credo, 10 commits): 7 APROVADO · 3 APROVADO-COM-NIT · 0 BLOQUEADO; 16 suites frescas 200/200; não-vacuidade lida. (docs/orchestration/review/REV-A.md)
- REV-C (ondas 7–10, 25 commits): 21 APROVADO · 4 APROVADO-COM-NIT · 0 BLOQUEADO → **marco M2/M3 APROVADO**; 42/42 arquivos de teste landed = 379/379 verdes, eslint 43 fontes = 0 erros (docs/orchestration/review/REV-C.md)
- REV-B (translator/roteamento, 10 commits): 5 APROVADO · 5 APROVADO-COM-NIT · 0 BLOQUEADO; 135/135 testes novos + adjacentes; round-trips claude↔openai verificados sem perda. Nits viraram tarefas F33/F35/F36 + backlog B7-P1 (docs/orchestration/review/REV-B.md)
- T3.2/T3.3 landing pós-revisão: cfd0928e (sync reativo 404) f40843d4 (sweep refresh proativo)

## Gates finais
- TREE FINAL INTEGRADA (todos os waves commitados): suíte completa ✅ "No regression" 35/35 known · build ✓ 51s · eslint 138 erros/205 warns vs baseline 139/205 = 0 novos · snapshots providers(84)/alias(117)/oauth ✓ byte-for-byte · comandos canônicos em docs/orchestration/STATE.md

## Não corrigidos / aceitos com justificativa
| achado | motivo |
|--------|--------|
| apiKeysRepo guarda key de gateway em plaintext | design do produto (mostrar a key ao dono); avaliar hash+reveal-once em D futuro, fora do escopo desta onda |
| TOCTOU DNS no fetchPublic (resolve na validação e de novo no fetch) | residual pós-F28 declarado pelo worker; pinning de IP é tarefa própria com custo de conexão; mitigações atuais: camada DNS-resolve + re-validação de redirect (testes f28-search-ssrf-strong trancam) |
| `next dev` sem wrapper: Host:localhost forja origem local (T1.3 F-7) | sem socket real acessível ao guard no dev; mitigar = bind do dev em 127.0.0.1, tarefa própria (REV-A nit) |
| 401 não rotaciona mais conta em combo (F25) | mudança de UX intencional e alinhada ao veredito T3-F10; documentar no CHANGELOG da entrega |
| auditoria Destination SAML via regex first-match (F29) | nit cosmetic: bypass exige roubo do saml_state (HttpOnly, single-use); DOM-parsing é upgrade posterior |
| fetchPublic re-anexa credencial a cada redirect hop (REV-A nit) | fora do modelo de ameaça: só cutucável se o endpoint CONFIGURADO for malicioso — e aí a origem é a do dono |
| `modelLockScope`/2º arg sem chamador de produção (F27, REV-B nit 2) | rede de proteção dormente e inofensiva (wipe-all já não ocorria); remover é refactor, ligar em chat.js é mudança sem bug associado — fica como API preparada p/ T-C/T3.3, documentado |
| header `x-9r-internal-models-fetch` spoofável em host local (REV-B risco c, via T3.4/T3.5) | exige presença no mesmo host do gateway; util para o self-fetch interno; hardening por token de request fica no backlog |
| cooldown manual F4 não populado quando um join chega via sync automático | cosmético: o join devolve a promise in-flight correta; só o cache pós-30s fica por popular nesse caminho (REV-C nit) |
| drain ask-then-kill do launcher é POSIX-only (win32 mantém kill direto) | sem API de shutdown-grace no Windows sem dependência nova; residual declarado (REV-C nit) |
| L1/L3/L4 do CLI (.desktop sem quote, MAX_PORT_ATTEMPTS morto, --skip-update sobrecarregado) | severidade LOW fora do critério A2; backlog registrado |
| B7 P2–P5 (campos initState multi-dona restantes) | nenhum lido hoje em perna dupla; convenção de chave por-roteiro imposta em review (REV-B lista priorizada) |
| cartão de combo sem NENHUM tráfego atribuído não mostra a nota de sub-combo (CB5 nit-2 gap) | precisa de 1 prop extra em page.js p/ cards "—"; aviso já visível em todo card com dados — polimento, não desonestidade |
| backstop do watchdog HALF_OPEN atravessa o classificador `isFailure` custom do chat.js (AUD-1 nit sobre f5b36bc7) | caminho real conhecido é coberto pelo settleProbe (5ca40b9a); risco só para caminhos futuros sem disconnect — hardening do breaker fica no backlog |
| wiring funcional (import da rota F16) veio num commit rotulado docs (6c41043a) | janela histórica em que a rota era código morto — hoje wired, exercido por testes; higiene de commit registrada pela META-auditoria |
| ciclo POST/POST concorrente pode admitir combo cíclico (REV-D) | runtime absorve: comboPath devolve 400 determinístico antes de gravar linha ou estourar heap (mesma race shape aceita p/ nome-único) |
| `isFailureUsageStatus` JS `\b` vs SQL `LIKE 'error%'` (REV-D nit) | só emitimos `error:<código>`/timeout/threw — divergência hoje inatingível; alinhamento quando surgir o primeiro status fora da gramática |

## Métricas da auditoria (preenchido no gate final)
- Achados por frente: T0.3=3(0 reais) · T1.1=20(4H) · T1.2=20(4H) · T1.3=16(5A) · T1.4=11(3H) · T1.5=15(1A) · T1.6=18(1C+3A) · T1.7=15 candidatos→5 portáveis · T1.8=12(1H)
- Correções commitadas: 57 commits (base 1a0acbd3..HEAD; ver git log — cada cluster com mensagemRefs), ~77 arquivos de teste novos, ~638 casos
- Gates finais na árvore integrada: suíte ✅ no-regression · build ✓ · eslint 0 novos · snapshots ✓
- Backlog aceito/documentado: rate-limit gateway, V8 guard-middleware, TOCTOU DNS, lost-update B2, SAML-requireLogin-design, cli-tools env-write (F21′), multi-proc refresh lock, IP pinning
