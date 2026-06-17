# Plano — Correções do code-review (hardening Sprint 4)

Origem: code-review geral do backend (persistência Redis ao reiniciar + regras de negócio).
Branch: `claude/objective-bhaskara-c3cfd4`. Execução: subagent-driven-development + TDD.

## Decisões de produto (confirmadas pelo Murilo)

- **#3 abaixo de 2 jogadores em partida:** declarar o jogador restante **vencedor** (gameOver).
- **#2 restart do backend:** **incluir** reconciliação no boot.
- **#6 tier:** **excluir** jogadores desconectados do cálculo de leader/last.

## Tarefas

### Task A — Persistência durável do Redis (CRÍTICO, #1)
Arquivos: `docker-compose.yml`, `deploy/docker-compose.prod.yml`.
- Serviço `redis`: `command: ["redis-server","--appendonly","yes","--appendfsync","everysec"]` + `volumes: [redis_data:/data]`.
- Declarar `volumes: { redis_data: {} }` no topo de cada compose.
- DoD: `docker compose config` válido; estado sobrevive a recreate do container Redis.

### Task B — Shutdown hooks + log de erro do ioredis (MÉDIO, #4/#5)
Arquivos: `src/main.ts`, `src/redis/redis.provider.ts`.
- `main.ts`: `app.enableShutdownHooks()` antes de `listen()`.
- `redis.provider.ts`: `client.on('error', (e) => logger.error(...))`.
- DoD: build ok; `onModuleDestroy` passa a ser chamado em SIGTERM.

### Task C — computeTier exclui desconectados (#6) — TDD
Arquivo: `src/game/game.rules.ts` + `game.rules.spec.ts`.
- max/min apenas sobre `players.filter(connected)`; fallback para todos se nenhum conectado (guard contra `Math.max(...[])`).
- DoD: teste cobrindo desconectado atrás não rouba o tier `last`; suíte verde.

### Task D — leaveSession/expire mantém turno e declara vencedor < 2 (#3) — TDD
Arquivos: `src/session/session.service.ts`, `src/gateway/game.gateway.ts` + specs.
- `leaveSession` em `ordering`/`playing`: remover de `turnOrder`, reajustar `currentTurnIndex` (mesma lógica de `expireDisconnectedPlayer`).
- Se restar exatamente 1 jogador durante `playing`: `status='finished'`, `winner`=restante, montar `ranking`.
- Gateway: emitir `gameOver` quando a partida terminar por abandono; manter `turnChanged` consistente.
- DoD: testes para saída do jogador-da-vez, queda para 1 jogador (gameOver), saída no lobby (inalterado).

### Task E — Reconciliação no boot (#2) — TDD (depende de D)
Arquivos: `src/session/session.repository.ts` (novo `scanCodes()`), novo hook `OnApplicationBootstrap` (serviço dedicado ou no gateway), reuso de `ReconnectService`/`expireDisconnectedPlayer`.
- No boot: `SCAN session:*`; para cada jogador `connected===false`, re-armar o grace com o tempo restante (`GRACE_PERIOD_MS - (now - lastActivityAt)`), expirando já se estourou.
- Garantir que o turno não trave: se o jogador da vez não está ativo, acionar `passTurnIfDisconnected`.
- DoD: teste do scan + re-arm; suíte verde.

## Revisão
Revisão independente final (code-reviewer) sobre o diff completo da branch + `npx jest` verde antes de finalizar.
