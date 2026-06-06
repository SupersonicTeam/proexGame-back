# Sprint 2 — Tasks (Backend)

**Design:** `design.md` · **Spec:** `spec.md` · **Decisões:** `context.md`

Convenções: TDD (teste antes da impl). Commits Conventional. Código/identificadores em inglês,
comentários PT-BR. `[P]` = paralelizável (sem dependência mútua de arquivos). Gate `quick`=`npm run test`,
`full`=`+ test:e2e`, `build`=`+ build && lint`.

Legenda de status: ⬜ pendente · 🟦 em andamento · ✅ concluído

---

## S2-01 ✅ — Tipos de domínio da Sprint 2
- **What:** Estender tipos: `TileType` += `'question'|'prison'`; `Subject`; `Question`;
  `PendingQuestion` (com `statement`, `correctIndex`, `proximalIndex`); `Player` += `usedQuestionIds`,
  `skipTurns`, `pendingQuestion`; `Board` += `subjectBySquare`; `SessionState` += `servedQuestionIds`.
  Remover `BOARD_SIZE` fixo (ou marcar deprecado — N passa a ser sorteado).
- **Where:** `src/session/session.types.ts`, novo `src/questions/question.types.ts`.
- **Depends on:** —
- **Reuses:** tipos S1 existentes.
- **Done when:** compila; campos novos opcionais não quebram código S1; `tsc` limpo.
- **Tests:** type-level (compilação). Sem spec dedicado.
- **Gate:** build

## S2-02 [P] ✅ — Banco de perguntas: schema + fixtures + loader
- **What:** `QuestionBankService` com `OnModuleInit` que lê `/questions/*.json`, valida schema
  (fail-fast), e expõe `subjects()`, `pickQuestion(subject, excludedIds, rng)`, `getById(id)`.
  Criar fixtures mínimas (≥6 perguntas em ≥2 matérias) suficientes para testes e para não esgotar
  numa partida curta.
- **Where:** `src/questions/question-bank.service.ts`, `question-bank.module.ts`, `questions/*.json`.
- **Depends on:** S2-01
- **Reuses:** padrão de módulo/provider Nest; `RandomSource`.
- **Done when:** boot carrega fixtures; schema inválido derruba o boot; `pickQuestion` respeita
  `excludedIds` e devolve `null` no esgotamento.
- **Tests:** `question-bank.service.spec.ts` — carga válida, schema inválido, exclusão, esgotamento.
- **Gate:** full

## S2-03 [P] ✅ — Geração procedural do tabuleiro (RF-06/07/17/18)
- **What:** `board.rules.ts` puro: `generateBoard(difficulty, subjects, rng)`, `DENSITY`,
  `prisonCount(N)`. Ordem obrigatória da §3.1. Atribui `subject` a cada casa-pergunta.
- **Where:** `src/game/board.rules.ts`.
- **Depends on:** S2-01
- **Reuses:** `RandomSource`.
- **Done when:** N∈[20,30]; 0=`start`, N=`finish`; presídios por faixa (RF-18); densidade correta;
  tipos mutuamente exclusivos; `subjectBySquare` só em `question`.
- **Tests:** `board.rules.spec.ts` — range de N, contagem de presídio nas faixas, densidade por
  dificuldade, reserva 0/N, exclusividade, subjects.
- **Gate:** full

## S2-04 [P] ✅ — Tiers + tabela de avanço/recuo (RF-10/13)
- **What:** Em `game.rules.ts`: `computeTier`, `advanceFor`, `recoilFor`. Substituir o
  `computeAdvance` placeholder da S1.
- **Where:** `src/game/game.rules.ts`.
- **Depends on:** S2-01
- **Reuses:** `SessionState`, padrão de funções puras.
- **Done when:** 9 células de avanço (tier×dificuldade) e 6 de recuo conferem com a §4; tiers
  tratam empate e partida de 2.
- **Tests:** `game.rules.spec.ts` (estender) — tiers, avanço, recuo.
- **Gate:** full

## S2-05 ✅ — Nudge + resolução de movimento (RF-11)
- **What:** `applyNudge(board, target, rng)`, `resolveCorrectMovement`, `resolveErrorMovement`;
  ajustar `resolveMovement` (dado) a devolver o `tileType` de destino. Clamp (≥1; ≥N→vitória).
- **Where:** `src/game/game.rules.ts`.
- **Depends on:** S2-03, S2-04
- **Reuses:** `board.rules` (tipos de casa), tabelas de S2-04.
- **Done when:** nudge desvia de `question`/`prison` com P=0.7 (prefere +1); encadeamento possível;
  recuo nunca <1; recuo não dispara nada.
- **Tests:** `game.rules.spec.ts` — nudge nos dois ramos de P (RNG fixo), encadeamento, clamp.
- **Gate:** full

## S2-06 ✅ — Seleção de pergunta + PendingQuestion (RF-09/16)
- **What:** `question.rules.ts`: `buildPendingQuestion(q, rng)` (shuffle + índices),
  `classifyAnswer(pending, optionIndex)`, `toQuestionPrompt(pending)` (projeção segura).
  Decidir o fallback de esgotamento por matéria (tratar casa como `normal` no pouso — ver design).
- **Where:** `src/game/question.rules.ts`.
- **Depends on:** S2-01, S2-02
- **Reuses:** `Question`, `RandomSource`.
- **Done when:** opções embaralhadas (4); `classifyAnswer` mapeia none/proximal/wrong;
  `toQuestionPrompt` **não** contém `correct`/índices/`proximal`.
- **Tests:** `question.rules.spec.ts` — shuffle determinístico, classificação, **asserção de segurança**.
- **Gate:** full

## S2-07 ✅ — Aterrissagem no dado: dispara pergunta / presídio (RF-08/19/20)
- **What:** Em `GameService.applyDiceRoll`: classificar a casa de destino; `question`→criar
  `pendingQuestion` (QuestionBank + question.rules, exclusão global via `servedQuestionIds`),
  não passar turno, sinalizar prompt; `prison`→`skipTurns++`, passar turno; else→fluxo S1.
- **Where:** `src/game/game.service.ts`.
- **Depends on:** S2-05, S2-06
- **Reuses:** `QuestionBankService`, `SessionRepository`, regras puras.
- **Done when:** pouso em cada tipo de casa segue §3.6; `servedQuestionIds`/`usedQuestionIds`
  atualizados ao servir; turno não passa em `question`.
- **Tests:** `game.service.spec.ts` — pouso em normal/question/prison/finish (repo fake + RNG fake).
- **Gate:** full

## S2-08 ✅ — submitAnswer: classificação, movimento, encadeamento (RF-08/10/11/16)
- **What:** `GameService.submitAnswer(code, playerId, questionId, optionIndex)`: valida turno/pendência/
  `questionId`/`optionIndex∈[0,3]`; classifica; acerto→`resolveCorrectMovement`(+encadeamento re-armando
  pendência sem trocar turno); erro→`resolveErrorMovement` (sem trigger) e passa turno; limpa
  `pendingQuestion`; persiste. Retorna `answerResult` + eventual novo prompt + vitória.
- **Where:** `src/game/game.service.ts`.
- **Depends on:** S2-07
- **Reuses:** regras puras, `QuestionBankService`.
- **Done when:** todos os ramos cobertos; erros de validação retornam o `ErrorCode` certo **sem**
  alterar estado; acerto que cai em `question` re-arma pendência; vitória encerra.
- **Tests:** `game.service.spec.ts` — acerto/proximal/total, encadeamento, vitória por resposta,
  e os 3 erros (`NO_PENDING_QUESTION`, `INVALID_OPTION`, `QUESTION_MISMATCH`).
- **Gate:** full

## S2-09 ✅ — Turno de presídio: perda de jogada (RF-20)
- **What:** `GameService.startTurnSkipIfNeeded(code)`: se o jogador da vez tem `skipTurns>0`,
  decrementa, passa turno, retorna sinal de `turnSkipped{playerId, remaining}`.
- **Where:** `src/game/game.service.ts`.
- **Depends on:** S2-07
- **Reuses:** `nextConnectedTurnIndex`.
- **Done when:** decrementa exatamente 1; passa a vez sem rolar; idempotente quando `skipTurns=0`.
- **Tests:** `game.service.spec.ts` — skip único, múltiplos presos em sequência, sem skip.
- **Gate:** full

## S2-10 ✅ — Reconexão (grace 5 min) + expiração + TTL (RF-14/15)
- **What:** `ReconnectService` (timers in-process): `armDisconnect`, `cancel`, `reconnect`,
  expiração→remove jogador/sessão→`sessionClosed`. `SessionRepository.save/create` com TTL
  deslizante (`SESSION_TTL_SECONDS`). `SessionService.reconnect(code, playerId, socketId)`.
- **Where:** `src/session/reconnect.service.ts`, `session.repository.ts`, `session.service.ts`,
  `session.module.ts`.
- **Depends on:** S2-01
- **Reuses:** `SessionRepository`, `markDisconnected` (S1).
- **Done when:** reconexão na janela revincula e zera o timer; expiração remove e, se vazia, apaga
  a chave; TTL aplicado em cada `save`.
- **Tests:** `reconnect.service.spec.ts` / `session.service.spec.ts` — fake timers (`jest.useFakeTimers`),
  reconexão dentro/fora da janela, expiração apaga, TTL setado (repo fake registra args do `set`).
- **Gate:** full

## S2-11 ✅ — Gateway: novos eventos + DTOs validados + ErrorCodes
- **What:** `@SubscribeMessage('submitAnswer')`, `('reconnect')`; `handleDisconnect` arma o grace;
  emitir `questionPrompt` (via `toQuestionPrompt`), `answerResult`, `turnSkipped`, `playerReconnected`,
  `sessionClosed`; após `turnChanged`, drenar `startTurnSkipIfNeeded` em laço. DTOs `SubmitAnswerDto`,
  `ReconnectDto` com validação estrita. Novos `ErrorCode` no enum + mensagens PT-BR.
- **Where:** `src/gateway/game.gateway.ts`, `gateway.dto.ts`, `src/common/errors/game-error.ts`.
- **Depends on:** S2-08, S2-09, S2-10
- **Reuses:** `emitError`, `bindSocket`, padrão de DTO da S1.
- **Done when:** novos eventos no contrato funcionam; `questionPrompt` nunca carrega segredo;
  inputs inválidos viram `error` sem mudar estado.
- **Tests:** `gateway.dto.spec.ts` — validação dos novos DTOs (bounds/tipos).
- **Gate:** full

## S2-12 ✅ — E2E: pergunta + presídio + reconexão + segurança
- **What:** Três specs e2e com `socket.io-client` e app real: (a) partida com `questionPrompt`→
  `submitAnswer`→`answerResult`→`gameOver` **+ asserção de que nenhum payload contém `correct`/
  `correctIndex`/`proximal`**; (b) presídio com RNG forçado (perde 1 turno); (c) reconexão na janela
  + expiração apaga a chave.
- **Where:** `test/e2e/questions-loop.e2e-spec.ts`, `prison.e2e-spec.ts`, `reconnect.e2e-spec.ts`.
- **Depends on:** S2-11
- **Reuses:** harness e2e da S1 (`game-loop.e2e-spec.ts`).
- **Done when:** os 3 specs passam; asserção de segurança verde (bloqueante — critério §6.4).
- **Tests:** os próprios e2e.
- **Gate:** full

## S2-13 ✅ — Contrato congelado S2 + STATE
- **What:** `CONTRACT-S2.md` (estende o S1 com os novos eventos, payloads, ErrorCodes e regra de
  reconexão para a pessoa do frontend). Atualizar `STATE.md` (progresso, decisões D1–D3, pontos de
  extensão restantes para S3/S4).
- **Where:** `.specs/features/sprint-2-sessions-questions/CONTRACT-S2.md`, `.specs/project/STATE.md`.
- **Depends on:** S2-12
- **Reuses:** formato do `CONTRACT-S1.md`.
- **Done when:** contrato cobre todos os eventos S2; STATE reflete a sprint concluída.
- **Tests:** revisão (doc).
- **Gate:** quick

---

## Ordem de execução sugerida

```
S2-01
 ├─ S2-02 [P]  ─┐
 ├─ S2-03 [P]   │
 ├─ S2-04 [P]   │
 └─ S2-10       │
       S2-05 ───┤ (precisa 03+04)
       S2-06 ───┘ (precisa 02)
            S2-07 (precisa 05+06)
              ├─ S2-08
              └─ S2-09
                   S2-11 (precisa 08+09+10)
                     S2-12
                       S2-13
```

Tarefas `[P]` (S2-02/03/04) podem ser delegadas a sub-agents em paralelo após S2-01, cada uma
recebendo: sua definição aqui, `design.md`, `context.md`, e `CONVENTIONS`/CLAUDE.md.

## Rastreabilidade RF → Task

| RF | Task(s) |
|----|---------|
| RF-06/07/17/18 | S2-03 |
| RF-08 | S2-05, S2-07, S2-08 |
| RF-09 | S2-02, S2-06, S2-07 |
| RF-10/13 | S2-04, S2-05, S2-08 |
| RF-11 | S2-05, S2-08 |
| RF-14/15 | S2-10 |
| RF-16 (segurança) | S2-06, S2-08, S2-11, S2-12 |
| RF-19 | S2-07 |
| RF-20 | S2-09 |
