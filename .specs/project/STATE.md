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

## Versionamento / CI (2026-06-04)

- **GitHub Actions** configurado em `.github/workflows/`:
  - `ci.yml` — roda lint + build + 47 unit + 3 e2e em cada PR e push na main (sem Redis real; usa ioredis-mock).
  - `release.yml` — no merge para main, deriva a versão por **Conventional Commits** (`feat`→minor,
    `fix`→patch, `BREAKING CHANGE`→major), cria a tag `vX.Y.Z` e publica um GitHub Release com changelog.
    Action: `mathieudutour/github-tag-action@v6.2` + `softprops/action-gh-release@v2`.
- **Primeira tag esperada:** `v0.1.0` (base 0.0.0 + os `feat:` da Sprint 1 = minor bump), alinhada ao `package.json`.
- **Permissão:** `release.yml` usa `permissions: contents: write` (menor privilégio). O default do repo
  é read-only; se o Release falhar por permissão, marcar Settings → Actions → General → Workflow
  permissions → "Read and write permissions".
- Recomendado: ativar branch protection na main exigindo o check de CI verde antes do merge.

## Sprint 2 — PLANEJADA (2026-06-04, backend-only)

Specify + Design + Tasks gerados em `.specs/features/sprint-2-sessions-questions/`
(spec.md, context.md, design.md, tasks.md — 13 tasks S2-01..S2-13). Execute ainda não iniciado.

**Decisões do usuário (context.md):**
- **D1 — tabela §4 puxada para a S2.** Balanceamento completo (avanço C_d+T_p, recuo proximal/total,
  tiers, nudge, encadeamento, clamp — RF-10/11/13) entra no backend agora; S3 fica só com frontend.
  Consome o ponto de extensão `computeAdvance` (substitui, não estende).
- **D2 — reconexão por timer in-process (setTimeout 5 min) + TTL Redis deslizante** como backstop.
  Sem `notify-keyspace-events`. Adequado a single-node.
- **D3 — não-repetição de perguntas global por sessão** (`servedQuestionIds`). Satisfaz RF-09
  ("mesma casa, perguntas diferentes") de graça. `usedQuestionIds` por jogador vira auditoria.

**Diretriz transversal:** segurança (pedido explícito). RF-16 vira critério de aceite bloqueante:
`correct`/`correctIndex` só no `PendingQuestion` no Redis; projeção única `toQuestionPrompt` impede
vazamento; validação estrita de DTO; `playerId` UUID como portador de reconexão; TTL limita memória.

**Novos eventos WS:** `submitAnswer`, `reconnect` (c→s); `questionPrompt`, `answerResult`,
`turnSkipped`, `playerReconnected`, `sessionClosed` (s→c). Contrato será congelado em `CONTRACT-S2.md` (S2-13).

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

## SPRINT 1 — CONCLUÍDA ✅ (2026-06-04)

Sprint 1 backend **100% completa**. Todos os 12 requisitos (S1-01..S1-12) verificados.
Gates: build ✅, lint ✅, 47 unit ✅, 3 e2e ✅. Docker: imagem `proexgame-back:s1` construída;
`docker compose up` sobe backend + redis (redis interno, não exposto no host); smoke test
`socket.io-client` externo criou sessão com sucesso (`createSession` → `sessionCreated`).

Melhoria aplicada no `docker-compose.yml`: Redis não é mais exposto no host (segurança + evita
conflito de porta); porta do backend configurável via `BACKEND_PORT` (default 3000). Para subir
local quando a 3000 estiver ocupada: `BACKEND_PORT=3010 docker compose up`.

**Comandos de verificação rápida do que já existe:**
```bash
npm install        # se node_modules não estiver presente
npm run test       # 47 unit
npm run test:e2e   # 3 e2e (loop até gameOver)
npm run build && npm run lint
```

**Próximo trabalho natural (quando pedido):** Sprint 2 — reconexão c/ grace period (RF-14/15),
geração procedural do tabuleiro 20–30 (RF-06/07), casas de presídio (RF-17–20), banco de
perguntas JSON + fluxo de pergunta (RF-08/09). Pontos de extensão já preparados no código:
`computeAdvance` (game.rules) e `makeBoard` (session.service).

## Preferências

- Validações, updates de estado e handoffs de sessão rodam bem em modelos mais rápidos/baratos.
