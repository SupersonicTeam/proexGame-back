# Sprint 1 — Núcleo Jogável (Backend) Tasks

**Design**: `.specs/features/sprint-1-core-loop/design.md`
**Status**: Draft

> Stack de teste (de CLAUDE.md): Jest. `quick` = `npm run test`; `full` = `npm run test && npm run test:e2e`; `build` = `npm run build && npm run lint`.

---

## Execution Plan

### Phase 0 — Setup (Sequential)
```
T1
```

### Phase 1 — Domínio puro (Sequential c/ paralelismo interno)
```
T1 ─→ T2 ─┐
T1 ─→ T3 ─┼─→ T4
```

### Phase 2 — Infra de estado
```
T2 ─→ T5 ─→ T6 ─→ T7
```

### Phase 3 — Serviços (Parallel OK após deps)
```
T4,T6,T7 ─→ T8
T4,T6     ─→ T9
```

### Phase 4 — Gateway + e2e (Sequential)
```
T8,T9 ─→ T10
```

### Phase 5 — Infra Docker + docs (Parallel OK)
```
T10 ─→ T11 [P]
T10 ─→ T12 [P]
```

---

## Task Breakdown

### T1: Scaffold do projeto NestJS + tooling
**What**: Inicializar projeto NestJS (package.json, tsconfig, nest-cli.json, eslint, prettier, jest unit + e2e config, .gitignore, main.ts mínimo).
**Where**: raiz + `src/main.ts`, `src/app.module.ts`, `test/jest-e2e.json`
**Depends on**: None
**Reuses**: layout padrão NestJS
**Requirement**: S1-01 (base)
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `npm install` resolve sem erros
- [ ] `npm run build` compila
- [ ] `npm run test` roda (0 ou mais testes, exit 0)
- [ ] `npm run lint` passa
**Tests**: none
**Gate**: build
**Commit**: `chore(setup): scaffold nestjs project with tooling`

---

### T2: Tipos de domínio + erros
**What**: `SessionState`, `Player`, `Board`, `Difficulty`, `Roll`, `RankingEntry`, `DiceOutcome` + `ErrorCode` enum + `GameError`.
**Where**: `src/session/session.types.ts`, `src/common/errors/game-error.ts`
**Depends on**: T1
**Reuses**: modelo de dados do design
**Requirement**: S1-02
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Todos os tipos exportados conforme design
- [ ] `GameError` carrega `code: ErrorCode`
- [ ] `npm run build` sem erros TS
**Tests**: none
**Gate**: build
**Commit**: `feat(session): add domain types and GameError`

---

### T3: RandomSource (interface + impl default) [P]
**What**: Interface `RandomSource` (`int`, `rollD6`) + `DefaultRandomSource` com `crypto.randomInt`.
**Where**: `src/common/random/random.source.ts`, `default-random.source.ts` + spec
**Depends on**: T1
**Reuses**: token de DI do Nest
**Requirement**: S1-09
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `rollD6()` retorna sempre [1,6] (teste estatístico de limites)
- [ ] `int(a,b)` respeita limites inclusivos
- [ ] Gate `npm run test` passa · Test count: ≥3
**Tests**: unit
**Gate**: quick
**Commit**: `feat(common): add injectable RandomSource`

---

### T4: GameRules (lógica pura)
**What**: `rollDie`, `computeAdvance`, `resolveMovement`, `resolveOrder`, `nextConnectedTurnIndex`, `buildRanking`.
**Where**: `src/game/game.rules.ts` + `game.rules.spec.ts`
**Depends on**: T2, T3
**Reuses**: `RandomSource` (arg), tipos T2
**Requirement**: S1-06, S1-07, S1-08
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `computeAdvance(from,v) === from+v`
- [ ] `resolveMovement` marca `isWin` quando `toSquare >= N` (chega-ou-passa)
- [ ] `resolveOrder` re-rola só entre empatados (RNG fake) e ordena por maior valor
- [ ] `nextConnectedTurnIndex` pula `connected=false`
- [ ] `buildRanking`: winner 1º, demais por `square` desc
- [ ] Gate `npm run test` passa · Test count: ≥10
**Tests**: unit
**Gate**: quick
**Commit**: `feat(game): add pure game rules with tests`

---

### T5: RedisModule + provider ioredis
**What**: Módulo global provendo `REDIS_CLIENT` (ioredis) configurado por `REDIS_HOST`/`REDIS_PORT`.
**Where**: `src/redis/redis.module.ts`, `redis.constants.ts`, `redis.provider.ts`
**Depends on**: T2
**Reuses**: async factory provider do Nest
**Requirement**: S1-01
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Provider exporta `REDIS_CLIENT`
- [ ] Lê host/porta de env com default `127.0.0.1:6379`
- [ ] `npm run build` sem erros
**Tests**: none
**Gate**: build
**Commit**: `feat(redis): add configurable ioredis provider module`

---

### T6: SessionRepository
**What**: CRUD de `SessionState` no Redis (`session:{code}`), `save` atualiza `lastActivityAt`.
**Where**: `src/session/session.repository.ts` + `session.repository.spec.ts`
**Depends on**: T2, T5
**Reuses**: `REDIS_CLIENT`; testes com `ioredis-mock`
**Requirement**: S1-02
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `create`/`findByCode`/`save`/`exists`/`delete` funcionam contra `ioredis-mock`
- [ ] `save` atualiza `lastActivityAt`
- [ ] `findByCode` inexistente → `null`
- [ ] Gate `npm run test` passa · Test count: ≥5
**Tests**: unit
**Gate**: quick
**Commit**: `feat(session): add redis session repository`

---

### T7: SessionCode (gerador único)
**What**: `generateUniqueCode` → `#NNNNN` 5 dígitos único entre sessões ativas (re-gera em colisão).
**Where**: `src/session/session.code.ts` + `session.code.spec.ts`
**Depends on**: T3, T6
**Reuses**: `RandomSource`, `SessionRepository.exists`
**Requirement**: S1-03
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Código tem 5 dígitos
- [ ] Em colisão (repo fake diz "existe"), re-gera até inédito
- [ ] Gate `npm run test` passa · Test count: ≥3
**Tests**: unit
**Gate**: quick
**Commit**: `feat(session): add unique session code generator`

---

### T8: SessionService (lobby)
**What**: `createSession`, `joinSession`, `leaveSession`, `startGame`, `markDisconnected` com validações → `GameError`.
**Where**: `src/session/session.service.ts` + `session.service.spec.ts`, `src/session/session.module.ts`
**Depends on**: T4, T6, T7
**Reuses**: repo, code gen, rules, RandomSource
**Requirement**: S1-03, S1-04, S1-05, S1-10
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `createSession` cria host + código + status lobby
- [ ] `joinSession`: rejeita cheio (`SESSION_FULL`), iniciada (`SESSION_ALREADY_STARTED`), inexistente (`SESSION_NOT_FOUND`), nome vazio (`INVALID_NAME`)
- [ ] `startGame`: rejeita não-host (`NOT_HOST`), <2 (`NOT_ENOUGH_PLAYERS`); seta `playing` + board fixo
- [ ] `markDisconnected` marca `connected=false`
- [ ] Gate `npm run test` passa · Test count: ≥12
**Tests**: unit
**Gate**: quick
**Commit**: `feat(session): add session/lobby service with validations`

---

### T9: GameService (turnos + movimento) [P]
**What**: `resolveTurnOrder` (usa `resolveOrder`), `applyDiceRoll` (movimento + vitória + avança turno), validações de vez/estado.
**Where**: `src/game/game.service.ts` + `game.service.spec.ts`, `src/game/game.module.ts`
**Depends on**: T4, T6
**Reuses**: rules, repo, RandomSource
**Requirement**: S1-06, S1-07, S1-08, S1-10
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `applyDiceRoll` fora da vez → `NOT_YOUR_TURN`; jogo não-ativo → `GAME_NOT_ACTIVE`
- [ ] Movimento que atinge N → `isWin`, status `finished`, ranking
- [ ] Sem vitória → `currentTurnIndex` avança pulando desconectado
- [ ] Gate `npm run test` passa · Test count: ≥8
**Tests**: unit
**Gate**: quick
**Commit**: `feat(game): add game service for turns and movement`

---

### T10: GameGateway + wiring + e2e do loop
**What**: `@WebSocketGateway` com `@SubscribeMessage` para cada evento client→server, hooks connect/disconnect, emissão dos eventos server→client; wiring no `AppModule`; e2e do loop completo.
**Where**: `src/gateway/game.gateway.ts`, `gateway.dto.ts`, `gateway.module.ts`, `src/app.module.ts` (mod), `test/e2e/game-loop.e2e-spec.ts`
**Depends on**: T8, T9
**Reuses**: SessionService, GameService; salas socket.io por código
**Requirement**: S1-01..S1-11 (integração)
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Eventos `createSession/joinSession/startGame/rollForOrder/rollDice/leaveSession` tratados
- [ ] Erros viram `error{code,message}` ao remetente
- [ ] e2e: 2 clientes `socket.io-client` jogam até `gameOver`, turnos sincronizados
- [ ] `rollDice` fora da vez → `error NOT_YOUR_TURN` no e2e
- [ ] Gate `npm run test && npm run test:e2e` passa · e2e ≥3 casos
**Tests**: e2e
**Gate**: full
**Commit**: `feat(gateway): add socket.io game gateway with e2e loop`

---

### T11: Artefatos Docker [P]
**What**: `Dockerfile` multi-stage, `docker-compose.yml` (backend+redis), `.dockerignore`, `.env.example`.
**Where**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`
**Depends on**: T10
**Reuses**: env `REDIS_HOST`/`REDIS_PORT` do RedisModule
**Requirement**: S1-12
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] `docker build` produz imagem que roda `node dist/main`
- [ ] `docker compose config` válido; backend referencia `redis:6379`
- [ ] `.dockerignore` exclui `node_modules`, `.git`, `dist`, envs
- [ ] `.env.example` documenta variáveis
**Tests**: none
**Gate**: build
**Commit**: `build(docker): add dockerfile and compose for backend + redis`

---

### T12: Documento de contrato WS da Sprint 1 [P]
**What**: `CONTRACT-S1.md` com cada evento (in/out), payloads e motivos de `error`, para o front integrar.
**Where**: `.specs/features/sprint-1-core-loop/CONTRACT-S1.md`
**Depends on**: T10
**Reuses**: seção de contrato da spec
**Requirement**: S1-11
**Tools**: MCP: NONE · Skill: NONE
**Done when**:
- [ ] Todos os eventos S1 documentados com shape de payload
- [ ] Lista de `ErrorCode` documentada
**Tests**: none
**Gate**: none (docs)
**Commit**: `docs(contract): document sprint 1 websocket contract`

---

## Validação pré-aprovação

### Check 1 — Granularidade
| Task | Escopo | Status |
| ---- | ------ | ------ |
| T1 | scaffold + config | ✅ coeso |
| T2 | tipos + erro (1 arquivo de tipos + 1 de erro) | ✅ |
| T3 | 1 interface + 1 impl | ✅ |
| T4 | 1 módulo de regras puras | ✅ coeso |
| T5 | 1 módulo Redis | ✅ |
| T6 | 1 repositório | ✅ |
| T7 | 1 função geradora | ✅ |
| T8 | 1 serviço (lobby) | ✅ coeso |
| T9 | 1 serviço (jogo) | ✅ coeso |
| T10 | 1 gateway + wiring + e2e | ✅ (e2e co-locado por compilação) |
| T11 | artefatos docker | ✅ coeso |
| T12 | 1 doc | ✅ |

### Check 2 — Cross-check diagrama × `Depends on`
| Task | Depends (body) | Diagrama | Status |
| ---- | -------------- | -------- | ------ |
| T1 | None | raiz | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T1 | T1→T3 | ✅ |
| T4 | T2,T3 | T2→T4, T3→T4 | ✅ |
| T5 | T2 | T2→T5 | ✅ |
| T6 | T2,T5 | T5→T6 (T2 via T5) | ✅ |
| T7 | T3,T6 | T6→T7 (T3 via T4 chain/independente) | ✅ |
| T8 | T4,T6,T7 | →T8 | ✅ |
| T9 | T4,T6 | →T9 | ✅ |
| T10 | T8,T9 | T8,T9→T10 | ✅ |
| T11 | T10 | T10→T11 | ✅ |
| T12 | T10 | T10→T12 | ✅ |

`[P]` consistente: T11/T12 não dependem entre si ✅; T9 `[P]` vs T8 — não dependem entre si ✅; T3 `[P]` vs T2 — independentes ✅.

### Check 3 — Co-location de testes (greenfield; matriz derivada de CLAUDE.md)
CLAUDE.md exige testes para: movimento, tiers, nudge, vitória, clamp, turno de presídio, reconexão. Na S1 aplicam-se movimento, vitória, clamp (regras), além de ordem e turno.
| Task | Camada | Requer | Task diz | Status |
| ---- | ------ | ------ | -------- | ------ |
| T1 | config | none | none | ✅ |
| T2 | tipos | none | none | ✅ |
| T3 | util RNG | unit | unit | ✅ |
| T4 | regras (movimento/vitória/clamp/ordem) | unit | unit | ✅ |
| T5 | infra/config | none | none | ✅ |
| T6 | repositório | unit | unit | ✅ |
| T7 | util código | unit | unit | ✅ |
| T8 | serviço | unit | unit | ✅ |
| T9 | serviço (turno) | unit | unit | ✅ |
| T10 | gateway (loop) | e2e | e2e | ✅ |
| T11 | infra docker | none | none | ✅ |
| T12 | docs | none | none | ✅ |

Nenhuma violação. `Tests: none` só onde a matriz permite (config/tipos/infra/docs).

---

## Status de execução
| Task | Status | Verificação |
| ---- | ------ | ----------- |
| T1 | ✅ Done | build + lint limpos |
| T2 | ✅ Done | build limpo |
| T3 | ✅ Done | 4 testes unit |
| T4 | ✅ Done | 13 testes unit |
| T5 | ✅ Done | build limpo |
| T6 | ✅ Done | 5 testes unit (ioredis-mock) |
| T7 | ✅ Done | 3 testes unit |
| T8 | ✅ Done | 12 testes unit |
| T9 | ✅ Done | 10 testes unit |
| T10 | ✅ Done | 3 e2e (loop até gameOver) + gate full |
| T11 | ⏳ Pendente verificação de `docker build` (daemon) | `docker compose config` OK |
| T12 | ✅ Done | CONTRACT-S1.md |

**Totais:** 47 testes unitários + 3 e2e passando. Build e lint limpos.
