# OMNIROUTE-DIFF — análise read-only comparativa (domínio: modelos / providers / health)

Tarefa T1.7. OmniRoute lido em `/home/scursel/omniroute-ref` (nada alterado lá).
Recorte: status de modelos, auto-update de providers, health checks, catálogo de
modelos. Filtro de decisão: **ALTO VALOR + BAIXO CUSTO + ZERO fricção de
usabilidade** — 9router vence pela simplicidade; complexidade OmniRoute não é
meta.

## 0. Contexto em 5 linhas

OmniRoute é o superset do mesmo DNA (`open-sse/` compartilhado): 359 providers,
SQLite com 178 migrations, MCP server, gamification, ~154 módulos só em
`src/lib/`. O domínio que nos interessa lá é espalhado em ~25 módulos que se
chamam entre si (event bus, settings DB, readCache, exclusive leases, radar
feed) — portar "o app" é o caminho para a complexidade que assusta. O que vale
portar são **mecanismos isolados**, ancorados em infra que o 9router já tem.

O 9router já fez o port conceitual do núcleo:
`src/lib/modelSync/connectionCatalog.js` + `scheduler.js` (≈ `modelSyncScheduler`),
`src/lib/modelCatalog/sync.js` (≈ `modelsDevSync` + `pricingSync` + overlay do
OpenRouter), `src/shared/utils/modelTier.js` (≈ `freeModels`), união
multi-conta em `/v1/models`, keep-last-good, regra de ausência em 2 syncs,
statuses `ok/stale/error/never-synced`. Documentado em
`docs/MODEL_SYNC_CATALOG.md`. Abaixo, o que **ainda** falta.

---

## 1. Mapa funcional OmniRoute ↔ 9router (domínio modelos/providers)

| Capacidade | OmniRoute | 9router hoje | Estado |
| --- | --- | --- | --- |
| Sync de catálogo por conexão (`/models`) | `shared/services/modelSyncScheduler.ts` (opt-in `autoSync`, 6h, self-fetch loopback com token interno) | `modelSync/connectionCatalog.js` + `scheduler.js`: **todos** os ativos, 24h, em-processo, SSRF guard, retry/backoff, keep-last-good | **EQUIVALENTE — e superior** (menos config, sem self-fetch HTTP) |
| Auto-sync reativo a 404 model-not-found | `providerModels/reactiveModelSync.ts` (cooldown 10min + dedupe in-flight, fire-and-forget) | não existe; catálogo fica congelado até o ciclo de 24h | **FALTA** (port trivial, máquina de sync já existe) |
| Refresh proativo de token OAuth em background | `tokenHealthCheck.ts` (1220 L, sweep 60s, intervalo por conexão, retry budget de expirados) + `tokenRefreshCircuit.ts` (backoff de refresh; **não nula o refreshToken** em provider de token rotativo no 1º invalid_grant) | refresh sob demanda (`oauthCredentialManager`, chamado no test/handshake); conexão ociosa só descobre token morto no 1º request | **FALTA o sweep**; os guardas de circuit são qualidade a absorver |
| Health sweep de credenciais em background | `credentialHealth/scheduler.ts` (reusa `testSingleConnection`, backoff 5→10→30→120min, conc 5, override por conexão, cache TTL 5min/stale 10min, evento de transição) + `localHealthCheck.ts` (nodes localhost via GET /models) | `testSingleConnection` existe e cobre ~57 variantes (`testUtils.js`), mas **só roda em clique manual**; `testStatus` fica obsoleto | **FALTA** — é o gap central de "status colorido confiável sem pedir config" |
| Matriz de saúde provider/modelo | `monitoring/providerHealthMatrix.ts` (636 L: success rate, latência, lockouts, breaker, score por provider, ranges 1h–30d) + `providerHealthAutopilot.ts` (760 L: issues + ações de reparo) | peças cruas: `ModelAvailabilityBadge` (cooldowns por tráfego), `CircuitBreakerBadge`, rotas `/api/usage/providers|stats` | **INFERIOR** (sem visão consolidada); autopilot **não vale** o custo/risco agora |
| models.dev: capacidades + preços | `modelsDevSync.ts` (861 L TS: DB, namespaces, backup, settings UI, env kill) | `modelCatalog/sync.js` (308 L JS: ETag, maioria de modais, deltas de limite, overlay de custo com fallback OpenRouter, arquivo slim) | **EQUIVALENTE no resultado**, 1/3 do tamanho |
| Ciclo de vida de modelo (deprecated/EOL) | `modelLifecycle.ts`: status com data de shutdown → `warn`/`reject`; filtros `filterSelectableModels` aplicados na discovery | `status` do models.dev é **descartado** em `slim()`; remoção de EOL é manual (cf. commit "drop NVIDIA EOL models") | **FALTA** (sinal pronto na mesma fonte que já baixamos) |
| Classificador free/pago | `freeModels.ts` (257 L): 2 regimes (contar pode usar feed remoto; **decidir** só com catálogo shipped), `freeType` regime (`discontinued` nunca conta como free) | `modelTier.js`: precedência price→models.dev→:free→curado→unknown (nunca "unknown=pago") | **EQUIVALENTE para dados observados**; o regime `discontinued` só importa junto do catálogo curado (§2 ADIAR) |
| Catálogo curado de free tiers (orçamento) | `open-sse/config/freeModelCatalog.data.ts`: ~489 linhas, `monthlyTokens`, `poolKey` (dedupe de pool compartilhado), `tos: caution/avoid`, `evidence:` por número, `FREE_CATALOG_CURATED_AT`, dashboard `/free-tiers` | não existe | **FALTA, mas não portável barato**: exige curadoria re-audited a cada 2 semanas — é exatamente a complexidade que assusta |
| Dedupe multi-conta | união de contas + `poolKey` p/ contagem de tokens | união implementada (`v1/models` ~L529–560: "any account lists it → advertised") | **EQUIVALENTE** (poolKey pertence ao free-tier dashboard, não ao status) |
| Staleness | statuses de sync + TTL do cache de credenciais + re-probe "inconclusive" (`probePolicy.ts`) | `ok/stale/error/never-synced` + keep-last-good | **EQUIVALENTE no catálogo**; TTL de health vem com o sweep |
| Preços não-token (por segundo/imagem/caractere) | `pricingSync.ts` (LiteLLM, opt-in) | `pricing.request → credits` (curado, com aviso "may change") | paridade prática p/ chat; refinamento = ADIAR |
| Ranking de popularidade via frontend interno do OpenRouter | `catalog/openrouterProviderStats.ts` (API **não documentada**, zod defensivo) | não existe | **NÃO TRAZER** (contrato pode sumir; dependência fragilizante) |
| Radar (feed remoto assinado de free tiers) | `lib/radar/*` | rejeitado em `PESQUISA-CATALOGOS-PROVEDORES.md` | **NÃO TRAZER** (servidor privado deles) |
| Descoberta automática de providers novos | `lib/discovery/index.ts` — **Fase 1: stub** (types + probe) | guardrail explícito: provider novo exige registry entry revisado | **NÃO TRAZER** (vaporware lá; princípio de segurança aqui já é melhor) |
| Auto-update do app | `system/autoUpdate.ts` (421 L, self-update via git/npm) | CLI `9router` faz install/update | fora do domínio; **NÃO TRAZER** |

---

## 2. Candidatos a portar — tabela ranqueada

| # | Candidato | Valor | Custo | Usabilidade | Veredito |
|---|---|---|---|---|---|
| 1 | **Sweep de health de credenciais em background** (credentialHealth/scheduler + cache, absorvendo localHealthCheck p/ nodes locais) | ALTO — status colorido sempre-fresco sem clicar Test | BAIXO — reaproveita `testSingleConnection` intacto; ~200 linhas JS | +zero config (ligado por padrão, env kill) | **TRAZER AGORA** |
| 2 | **Auto-sync reativo a `model_not_found`** (reactiveModelSync) | ALTO — cura staleness de catálogo pinado sozinho | BAIXO — hook de ~15 linhas na hot path + módulo com cooldown/dedupe | invisível | **TRAZER AGORA** |
| 3 | **Sweep de refresh OAuth proativo** + guardas do `tokenRefreshCircuit` | ALTO-MÉDIO — menos falha visível em conexão ociosa; evita invalidar auth por race de refresh | MÉDIO-BAIXO — reuse `oauthCredentialManager`; só sweep | invisível | **TRAZER AGORA** |
| 4 | **Sinal de lifecycle do models.dev** (deprecated/EOL/alpha) no catálogo → badge + filtro | MÉDIO-ALTO — para de anunciar modelo morto sem curadoria manual | BAIXO — 1 campo em `slim()` + consumo no `/v1/models` e dashboard | aditivo | **TRAZER AGORA** |
| 5 | **Matriz lite de saúde provider/modelo** (read-only: success rate + latência + cooldowns + breaker, join das rotas de usage existentes) | MÉDIO-ALTO — "confiável" visível | MÉDIO — agregação nova, mas sem ações | painel já existe | **TRAZER AGORA (escopo cortado)** |
| 6 | Autopilot de reparo (clear breaker/cooldown/reactivate com hash de precondição) | MÉDIO | ALTO — 760 L de política + UI de confirmação | risco de automação mexendo em estado | ADIAR |
| 7 | Catálogo curado de free tiers (`freeModelCatalog` + /free-tiers + poolKey + `freeType`) | ALTO p/ narrativa "grátis" | ALTO — curadoria contínua com evidence; 489 linhas + metod | bom, mas vira dívida | ADIAR (se um dia, trazer *magro*: provider/model/freeType/tos, sem orçamento) |
| 8 | `syncedAutoAliases` (bare name → tier padrão p/ antigravity) | MÉDIO p/ usuários agy | BAIXO-MÉDIO | bom | ADIAR |
| 9 | pricingSync LiteLLM | BAIXO — overlay models.dev+OpenRouter já cobre | BAIXO | neutro | ADIAR (só se unknown-tier persistir alto) |
| 10 | Preços não-token por dimensão (seg/imagem/char) | BAIXO-MÉDIO | MÉDIO (tabela de custo de uso) | neutro | ADIAR |
| 11 | Quota pools / quota-sharing engine | BAIXO p/ nosso público | ALTO | enterprise | NÃO TRAZER |
| 12 | Radar / openrouter frontend-stats | MÉDIO | ALTO + frágil | dependência externa | NÃO TRAZER |
| 13 | Arquitetura self-fetch do modelSyncScheduler (HTTP interno + pinned TLS + header token) | NENHUM — chamamos em-processo | — | — | NÃO TRAZER |
| 14 | discovery/ scanner | — | — | — | NÃO TRAZER (stub) |
| 15 | Settings UI de sync (DB wins over env) | BAIXO | MÉDIO | env kill chega | ADIAR |

Detalhes de qualidade citados no brief, com situação: **região/quota** — Omni
Route só tem 2 mecanismos reais: gate `regional-identity` que *exclui da conta*
(ModelScope) e tabela regional hardcoded; nada portável de valor agora (anotar
flag quando/se vier o catálogo free magro). **Staleness** — coberto (falta só
TTL no sweep #1). **Dedupe multi-conta** — coberto. **Pricing** — coberto na
precedência; dimensões não-token = #10. **Auto-descoberta periódica** — coberta
por conexão + models.dev; o que falta é a reatividade #2 e o lifecycle #4.
**Status confiável sem config** — é exatamente o #1 (+ #3).

---

## 3. Specs TRAZER AGORA

### T-A. Credential health sweep (`src/lib/credentialHealth/`)
**Origem:** `credentialHealth/scheduler.ts` (492 L), `cache.ts` (314), `probePolicy.ts` (23), `localHealthCheck.ts` (245).
**Arquivos 9router afetados:** novos `src/lib/credentialHealth/scheduler.js` + `cache.js`; start em `src/instrumentation.js` (`startCredentialHealth()`); `src/app/api/providers/[id]/test/testUtils.js` (escrever no cache pós-teste manual, para o clique manual refrescar na hora); consumo no dashboard via `src/app/api/models/availability/route.js` (mergir `health` por conexão) e componentes `ConnectionsCard`/`ModelAvailabilityBadge`.
**Comportamento:** sweep periódico chama `testSingleConnection(id)` para conexões ativas cujo último teste venceu; grava `connection.testStatus` + `lastTested` (campos já existem) e cache em memória (TTL 5min, stale 10min, max 500 entradas). Backoff por conexão 5→10→30→120min no erro, reset no sucesso; concorrência 5; intervalo global default 60min; override por conexão em `providerSpecificData.healthCheckInterval` (minutos; `0` = nunca). Probe inconclusivo (válido mas warning de validade ambígua) recheque mais devagar (≥30min) — política de `probePolicy.ts`. Nodes custom/localhost entram (é o substituto do localHealthCheck; timeout 5s via testUtils). Kill switch `CREDENTIAL_HEALTH=off`; build/test guard (não iniciar em `NEXT_PHASE=production-build`). Logs sem segredos (padrão do repo).
**Testar:** `tests/unit/credential-health.test.js` com timers fake + `testSingleConnection` stubbed: sequência de backoff, override 0 pula, TTL/stale, sucesso reseta, sweep não roda desligado. Verificar UI: dot colorido muda sem clique após 1 ciclo forçado.

### T-B. Reactive model sync em `model_not_found`
**Origem:** `providerModels/reactiveModelSync.ts`.
**Arquivos afetados:** novo `src/lib/modelSync/reactive.js`; hook em `open-sse/handlers/chatCore.js` no caminho de erro onde o código efetivo é `model_not_found`/404 upstream (ver `open-sse/config/errorConfig.js` L7; garantir que é 404 *de modelo upstream*, não de rota local); consome `syncConnectionCatalog(connectionId)` existente.
**Comportamento:** ao detectar model-not-found para (provider, connectionId) que tem `modelsFetcher` sincronizável (`SYNCABLE_MODELS_FETCHER_TYPES`), dispara `syncConnectionCatalog` fire-and-forget. Cooldown 10min por conexão + dedupe in-flight (burst de 404 → 1 sync). Nunca bloqueia/retry-a o request atual; falha só loga (o ciclo de 24h é backstop). Sem configuração de usuário; sem kill switch além de `CONNECTION_MODEL_SYNC=off` respeitado no sync em si.
**Testar:** unit: stub do sync; 20 triggers simultâneos → 1 chamada; provider não-sincronizável → no-op; depois do cooldown dispara de novo. Integração leve: erro com code model_not_found no mock executor chama o trigger.

### T-C. Sweep proativo de refresh OAuth
**Origem:** `tokenHealthCheck.ts` (+ `tokenRefreshCircuit.ts` como política).
**Arquivos afetados:** novo `src/lib/tokenHealth/scheduler.js` + `src/lib/tokenHealth/refreshCircuit.js`; start em `src/instrumentation.js`; reusa `open-sse/services/oauthCredentialManager.js` (`shouldRefreshCredentials`/`refreshProviderCredentials`).
**Comportamento:** tick leve (60s) varre conexões OAuth ativas; refresh quando `tokenExpiresAt` a < janela (ex.: 10min) OU quando `providerSpecificData.healthCheckInterval` venceu (default 60min). Erro de refresh: registra `providerSpecificData.refreshCircuit = { until }` com backoff (5→10→30→120min) e **não** zera o refreshToken em providers de token rotativo (lista `PRESERVE_REFRESH_TOKEN_PROVIDERS`, hoje `claude`) quando o erro é "unrecoverable" (invalid_grant costuma ser race de dual-consumer); conexão expirada tem retry budget 3×/5min antes de virar `testStatus: "expired"`. Sweeps#T-A respeitam a janela do circuit (não re-testar durante backoff de refresh). Kill `TOKEN_HEALTH=off`.
**Testar:** unit com fixtures de expiração: refresh antes de vencer; circuit until respeitado; preserve-token no invalid_grant de claude; budget de expirados marca `expired` só após 3 falhas.

### T-D. Lifecycle status do models.dev no catálogo
**Origem:** `modelLifecycle.ts` + `filterSelectableModels` (versão magra).
**Arquivos afetados:** `src/lib/modelCatalog/sync.js` (`slim()` capturar `st: model.status`; `build()` propagar p/ o arquivo do catálogo), `open-sse/providers/catalogOverride.js` + `capabilities.js` (expor `lifecycle: "deprecated"|"retired"|null`), `src/app/api/v1/models/route.js` (retired some de `/v1/models` e do combo-fallback, respeitando a regra de ausência das contas; deprecated continua e ganha metadado), UI: chip discreto no ModelsCard.
**Comportamento:** modelo com status retired/EOL no models.dev não é mais anunciado sem intervenção manual (hoje isso é commit à mão); deprecated é advertido, nunca removido silenciosamente (data de shutdown fica fora do escopo). Conservador: sinal só aplica a modelos que **não** têm evidência ao vivo de uma conexão (catálogo sincronizado por conta vence o feed) — coerente com "missing from 2 syncs" existente.
**Testar:** unit com fixture de api.json (status alpha/deprecated/EOL); GET /v1/models filtra/annota; sync rodando não perde o campo.

### T-E. Matriz lite de saúde (read-only)
**Origem:** `providerHealthMatrix.ts` (corte: sem scores sintéticos, **sem ações/autopilot**).
**Arquivos afetados:** novo `src/app/api/health/providers/route.js` agregando: usage DB (`src/lib/usageDb.js` + agregações que `/api/usage/providers|stats` já fazem) por provider/modelo (requests, successRate, avgLatency, lastErrorAt por range 1h/24h/7d), estado do `open-sse/utils/circuitBreaker.js` (`getAllCircuitBreakerStatuses`-equivalente), lockouts/cooldowns de `open-sse/services/accountFallback.js` e `modelCatalogStatus` de `connectionCatalog.js`. UI: coluna "Saúde" compacta no ModelsCard + popover por provider (mesma visual do ModelAvailabilityBadge, polls 30s).
**Comportamento:** só leitura, zero interação nova; fallback gracioso quando usage DB vazio (badge "unknown", nunca "down" sem dados — princípio "missing data never called paid" aplicado a saúde). O `GET /api/health` atual (`{ok:true}`) permanece intocado p/ liveness.
**Testar:** unit: seed de usage rows → agregados corretos por range; provider sem tráfego → unknown não error. Manual: dashboard com 1 provider em cooldown mostra amber com razão.

---

## 4. Evidência de leitura (OmniRoute, nada alterado)

Modelos lidos: `README.md`, `AGENTS.md`, e os módulos `wc -l`-verificados citados
acima; consumo no dashboard via `src/app/api/monitoring/health/route.ts` e
rotas de providers. 9router: `docs/MODEL_SYNC_CATALOG.md`,
`docs/PESQUISA-CATALOGOS-PROVEDORES.md`, `src/lib/modelSync/*`,
`src/lib/modelCatalog/sync.js`, `src/shared/utils/modelTier.js`,
`connectionStatus.js`, `/api/models/availability`, `test/testUtils.js`,
`open-sse/utils/circuitBreaker.js`, `open-sse/services/accountFallback.js`,
`instrumentation.js`, `v1/models/route.js` (união multi-conta L529–560),
git log `sync|catalog|model`.
