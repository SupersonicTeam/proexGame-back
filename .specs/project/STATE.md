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

## SPRINT 2 — CONCLUÍDA ✅ (2026-06-05, backend-only)

Sprint 2 backend **100% completa** (13/13 tasks S2-01..S2-13). Execute via TDD com commits
atômicos por task. Contrato congelado em `CONTRACT-S2.md`.

**Gates finais:** build ✅ · lint ✅ · **188 unit ✅** · **8 e2e ✅** (4 suites: game-loop,
questions-loop, prison, reconnect).

**Entregue:**
- Tipos da S2 (Question/PendingQuestion/Subject; Player.skipTurns/usedQuestionIds/pendingQuestion;
  Board.subjectBySquare; SessionState.servedQuestionIds).
- Banco de perguntas JSON em memória (`QuestionBankService`, fail-fast no schema, fixtures
  matematica/portugues em `/questions`).
- Tabuleiro procedural (`board.rules.generateBoard`) ligado no início via `GameService.setupBoard`.
- Balanceamento completo §4 (D1): tiers, avanço/recuo, nudge, encadeamento, clamp (`game.rules`).
- Fluxo de pergunta: aterrissagem (`applyDiceRoll`), `submitAnswer`, presídio (`startTurnSkipIfNeeded`).
- Reconexão: `ReconnectService` (timers in-process 5 min) + TTL Redis deslizante + expiração.
- Gateway: submitAnswer/reconnect, questionPrompt/answerResult/turnSkipped/playerReconnected/
  sessionClosed, DTOs validados, `advanceTurn` drena presídios.

**Segurança (RF-16) — verificada:** `toQuestionPrompt` é a única projeção ao client; e2e
`questions-loop` afirma que o payload nunca carrega `correctIndex`/`proximalIndex`. Validação
estrita de DTO; `playerId` UUID como portador de reconexão; TTL limita memória.

**Decisão de infra aplicada:** `.gitattributes` (eol=lf) — o checkout do worktree no Windows vinha
em CRLF e quebrava o lint (prettier endOfLine=lf). Normalizado; CI roda em LF.

**Ponto que sobra para a S3 (frontend):** S3 fica só com o frontend (SVG, telas de pergunta/
resultado), pois o balanceamento foi puxado para a S2 (D1). Banco final de conteúdo (10 matérias)
e hardening/deploy permanecem na S4.

**Novos ErrorCode:** NO_PENDING_QUESTION, QUESTION_MISMATCH, INVALID_OPTION, RECONNECT_FAILED.

## SPRINT 3 — CONCLUÍDA ✅ (2026-06-09, backend-only — habilitação do frontend)

Como o balanceamento já veio na S2 (D1), a S3 backend virou **habilitação do frontend**: o delta
de contrato que destrava o render do tabuleiro SVG, peões e telas de pergunta/resultado — inclusive
após refresh/reconexão. Spec em `.specs/features/sprint-3-frontend-enablement/`; contrato congelado
em `CONTRACT-S3.md`. Origem: issue #7 ("Contrato s3"). Tudo **aditivo/retrocompatível** à S2.

**Entregue (6 commits atômicos):**
- `square` em `playerView`; `difficulty` em `lobbyState`.
- Evento **`gameState`** (snapshot completo: board + posições + turno + dificuldade + ranking),
  emitido em `startGame`, `reconnect` (ao remetente) e via novo handler **`requestState`**.
- `subject` no `questionPrompt`.
- `correctIndex` no `answerResult`, **revelado só ao autor** (sala recebe sem ele).

**Decisões da S3:**
- **gameState como evento novo** (vs. inflar lobbyState): semântica limpa — lobbyState p/ lobby,
  gameState p/ partida.
- **answerResult: correctIndex só ao autor** (`client.emit`); sala via `client.broadcast` sem a
  correta. Veio da revisão de segurança (MEDIUM): broadcast da correta vazaria p/ adversários.
- **requestState** lê `code` só do `socket.data` (vinculado pelo servidor) → sem IDOR.

**Gates finais:** build ✅ · lint ✅ · **193 unit ✅** · **11 e2e ✅** (5 suites; +`game-state.e2e-spec.ts`).
Code review ✅ aprovado. Segurança: sem críticos/altos; RF-16 preservado e reforçado.

**Ressalva p/ S4 (hardening):** CORS `origin: true` em `game.gateway.ts` + `main.ts` é
pré-existente (S1/S2) e deve virar origem explícita via env (`FRONTEND_ORIGIN`). Chip de task criado.

## SPRINT 4 — EM ANDAMENTO (2026-06-14)

Sprint 4 = Conteúdo (10 matérias) + testes + hardening + deploy + playtest. Status por item:

- **Deploy VPS ✅** — CI/CD (`release.yml` build→GHCR→SSH→compose) + `deploy/` (compose prod,
  nginx wss/TLS) **em produção**, com fixes recentes (sync do `docker-compose.prod.yml` para a
  VPS, GHCR auth via `GITHUB_TOKEN` efêmero).
- **Hardening RF-16 ✅** — CORS restrito a `FRONTEND_ORIGIN` (resolve a ressalva da S3),
  `correctIndex` revelado só ao autor, `toQuestionPrompt` como projeção única ao client.
- **Testes ✅** — 203 unit + 11 e2e (movimento, tiers, nudge, vitória, clamp, presídio, reconexão).
- **Conteúdo — TEMPLATE/SCAFFOLDING entregue (não o conteúdo final).** Decisão do Murilo
  (2026-06-14): ele redige as perguntas e confirma o set de 10 matérias depois. Entregue:
  `questions/README.md` (guia de autoria + schema + foco no distrator proximal + 10 matérias
  sugeridas c/ prefixos) e `questions/TEMPLATE.json.example` (modelo copiável). O loader filtra
  só `*.json` → `README.md` e `*.json.example` são ignorados (verificado: carrega só
  matematica/portugues).
- **Playtest/calibração §4** — manual, pendente (evento único).

**Restante p/ fechar a S4:** autoria do conteúdo das 10 matérias (Murilo, usando o template) +
playtest/calibração. Banco atual: matematica (5) + portugues (5) — expandir para ~20/matéria.

## SPRINT 4 — Ordem interativa (RF-04) + code-review fixes (2026-06-14)

Bug relatado pelo Murilo: "ao iniciar, a ordem não é rolada — começa aleatório; e empate deveria
re-rolar". **Causa raiz (não era o algoritmo):** `resolveOrder` já desempatava certo, mas o fluxo
era da S1 — `handleRollForOrder` era no-op e `startGame` auto-resolvia a ordem, emitindo só a 1ª
rodada em `orderResult` (re-rolls de empate invisíveis). Decisão do Murilo: **ordem interativa**
(cada jogador rola). Também pediu code-review geral + contract consolidado p/ o front.

**Entregue (TDD; build/lint/216 unit/12 e2e ✅):**
- **Fase de ordem interativa (RF-04):** novo `status: 'ordering'` entre lobby e playing. Regras
  puras em `src/game/ordering.rules.ts` (partição em grupos; re-rola só entre empatados; rodadas
  até resolver). Orquestração em `GameService.beginOrdering`/`rollForOrder`/`autoRollPendingDisconnected`.
- **Gateway:** `startGame` → `gameStarted`→`gameState(ordering)`→`orderPhase`. `rollForOrder`
  passa a ser real → `orderRoll` + (`orderResult{rolls,rounds,turnOrder}`→`gameState`→`turnChanged`
  | novo `orderPhase`). Disconnect na ordem → auto-roll; `leaveSession` na ordem → reinicia ordem
  (≥2) ou volta ao lobby (`returnToLobby`). Reconexão na ordem → `orderPhase` ao reconectado.
- **`gameState` ganhou campo `ordering`** (`{round, playersToRoll, rolled}`; null fora da fase).
- **Code-review fixes escolhidos:** **P3** (removida geração dupla de board no `startGame` — só
  `setupBoard` gera o procedural) e **P5** (`INVALID_PAYLOAD` separa erro de transporte dos códigos
  de regra de jogo em `parseSubmitAnswer`/`parseReconnect`). **Não** feitos (decisão): P2 (atomicidade/
  lock — limitação documentada) e P4 (maxLength no nome).
- **Novos ErrorCode:** ORDER_NOT_ACTIVE, NOT_ROLLING_FOR_ORDER, ALREADY_ROLLED_FOR_ORDER, INVALID_PAYLOAD.
- **`CONTRACT.md` na raiz** — contrato WS consolidado e autoritativo p/ o frontend (supersede os
  CONTRACT-S1/S2/S3, mantidos como histórico).

**Achados de code-review NÃO corrigidos (registrados):** P2 atomicidade (read-modify-write sem
lock; risco baixo em ≤20 users/turnos alternados; double-click em `rollDice` etc.) · P4 nome sem
`maxLength`/sanitização (risco de XSS no front se não escapar; limitar a ~24 chars).

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
