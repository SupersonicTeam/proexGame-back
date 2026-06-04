# STATE — proexGame-back

Memória persistente: decisões, blockers, lições, todos.

## Decisões

- **2026-06-03 — Sprint 1 é backend-only.** Frontend é desenvolvido em paralelo por outra pessoa.
  A primeira apresentação enquadrará front + back **integrados**; o backend nunca é demonstrado
  isolado. Consequência: a Sprint 1 não entrega harness de demo próprio — entrega um **contrato WS
  congelado e documentado** + testes (unit das regras puras, e2e via `socket.io-client`) como
  substituto de verificação enquanto o front não conecta.
- **2026-06-03 — Sprint 1 usa tabuleiro de tamanho fixo, todas as casas `normal`.** Geração
  procedural variável (RF-06) e casas especiais (pergunta/presídio) ficam para a Sprint 2.
  `difficulty` é persistida no estado mas não afeta cálculo na S1 (semântica entra na Sprint 3).
- **2026-06-03 — Movimento na S1 = valor do dado** (sem tiers/nudge/dificuldade). Avanço fica
  isolado em `computeAdvance` para a Sprint 3 injetar a regra completa sem refator estrutural.

## Blockers

- (nenhum)

## Progresso Sprint 1 (backend)

- **2026-06-03 — Sprint 1 backend implementada.** Design + Tasks (12 tasks) + Execute concluídos
  via TDD. 47 testes unitários + 3 e2e verdes; build e lint limpos. Critério de aceite oficial
  cumprido (2 jogadores completam partida até `gameOver` por e2e com `socket.io-client`).
  Stack: NestJS 11 + `@nestjs/platform-socket.io` + ioredis 5. Estrutura: `common/` (RandomSource,
  GameError), `redis/`, `session/` (repo, service, code), `game/` (rules puras + service),
  `gateway/`. Contrato congelado em `CONTRACT-S1.md`.
- Pendência única: validar `docker build` com o daemon ativo (Docker Desktop estava offline na
  sessão; `docker compose config` validado). Dockerfile multi-stage + compose backend+redis prontos.

## Todos

- Verificar `docker build -t proexgame-back:s1 .` e `docker compose up` com o daemon ativo.
- Entregar `CONTRACT-S1.md` para a pessoa do frontend integrar.
- Próximas sprints (2-4) ainda não detalhadas — manter como na SPEC.mc até pedido explícito.

## Preferências

- Validações, updates de estado e handoffs de sessão rodam bem em modelos mais rápidos/baratos.
