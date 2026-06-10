# Sprint 3 — Habilitação do frontend (Backend)

**Spec base:** `CONTRACT-S2.md` (congelado) + issue #7 ("Contrato s3")
**Escopo:** Backend-only. O frontend (SVG procedural, telas de pergunta/resultado) é
desenvolvido em paralelo; a entrega é o **delta de contrato da S3 (`CONTRACT-S3.md`)** —
adições que destravam o frontend — + testes (unit das projeções, e2e via `socket.io-client`).
**Status:** Specify
**Data:** 2026-06-09

---

## 1. Contexto e motivação

O balanceamento (tiers/nudge/dificuldade) e o fluxo de pergunta — que o `CLAUDE.md` atribuía à
Sprint 3 — **já foram entregues na Sprint 2** (decisão D1). Portanto a Sprint 3 canônica é
frontend-only. Esta spec cobre o **backend de habilitação** do frontend: as lacunas do contrato
atual que impedem o cliente de renderizar o tabuleiro SVG, os peões e as telas de pergunta/
resultado — especialmente **após um refresh/reconexão no meio da partida**.

Todas as mudanças são **aditivas e retrocompatíveis**: nenhum payload existente perde campos,
para não quebrar a integração já feita com o contrato S2.

---

## 2. Lacunas identificadas (no código atual)

| # | Lacuna | Evidência | Impacto no frontend |
|---|--------|-----------|---------------------|
| L1 | `toPlayerView` não expõe `square` | `gateway.dto.ts:61` | Não há como posicionar os peões no tabuleiro. |
| L2 | Nenhum snapshot completo de estado de jogo | `lobbyState` (`gateway.dto.ts:71`) só traz `code/status/hostId/players` | Após refresh/reconexão, o cliente nunca reobtém `board`/posições → não redesenha o tabuleiro. |
| L3 | Sem evento de resync sob demanda | gateway não tem handler de pedido de estado | Refresh do navegador perde o estado; cliente fica cego até o próximo evento. |
| L4 | `questionPrompt` não traz `subject` | `question.rules.ts:62` (`QuestionPromptView`) | Tela de pergunta não sabe a matéria para tematizar/rotular. |
| L5 | `answerResult` não revela a correta | `game.gateway.ts:152` | Tela de resultado (jogo educativo) não consegue destacar a alternativa correta após submeter. |

---

## 3. Requisitos cobertos

| RF | Descrição | Onde |
|----|-----------|------|
| RF-16 | Autoridade total: a correta NUNCA é enviada **antes** da submissão | L5 preserva isto (revela só **depois** do `submitAnswer`) |
| RF-14 | Sessão sobrevive a refresh/queda; reconexão restaura **estado renderizável** | L2/L3 completam a restauração (board + posições) |
| (UX) | Frontend renderiza tabuleiro SVG, peões e telas de pergunta/resultado | L1..L5 |

> RF-16 continua **bloqueante**: `questionPrompt` jamais carrega a correta; a revelação da L5
> trafega exclusivamente no `answerResult`, que por definição só existe **após** a submissão.

---

## 4. Delta de contrato — Sprint 3

### 4.1 Enriquecimento de projeções existentes (aditivo)

**`toPlayerView`** passa a incluir `square`:
```ts
{ id, name, connected, isHost, square }   // + square
```

**`toLobbyState`** passa a incluir `difficulty`:
```ts
{ code, status, hostId, difficulty, players }   // + difficulty
```

### 4.2 Novo evento server→client: `gameState` (snapshot completo)

Projeção `toGameState(state)` — a visão canônica e completa para (re)render:
```ts
{
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  difficulty: 'easy' | 'normal' | 'hard';
  board: { size, tileTypeBySquare, subjectBySquare };
  players: { id, name, connected, isHost, square }[];
  currentTurnPlayerId: string | null;   // null fora de 'playing'
  winner: string | null;
  ranking: RankingEntry[] | null;        // preenchido só em 'finished'
}
```
**Emitido quando:**
- logo após `gameStarted` (sala inteira);
- após `reconnect` bem-sucedido (só ao remetente), substituindo a necessidade de reenviar `gameStarted`;
- em resposta a `requestState` (ver 4.3).

Não vaza `socketId`, `pendingQuestion`, `correctIndex`, `servedQuestionIds` nem `usedQuestionIds`.

### 4.3 Novo evento client→server: `requestState`

`requestState{}` (sem payload obrigatório; identidade vem do socket) → servidor responde
com `gameState` **só ao remetente**. Permite recuperar o estado após um refresh do navegador.
Se o socket não está vinculado a uma sessão, emite `error{NOT_IN_SESSION}`.

### 4.4 `subject` no `questionPrompt`

`QuestionPromptView` e o payload `questionPrompt` passam a incluir `subject`:
```ts
{ questionId, subject, statement, options }   // + subject
```
RF-16-safe: `subject` é a matéria, não a resposta.

### 4.5 Revelação da correta no `answerResult` (pós-submissão)

`answerResult` passa a incluir `correctIndex` (índice da alternativa correta na lista `options`
que o jogador recebeu no `questionPrompt`):
```ts
{ playerId, correct, errorType, movement, fromSquare, toSquare, correctIndex }   // + correctIndex
```
RF-16-safe: emitido **apenas** no `answerResult`, que só existe após o `submitAnswer`. O
`correctIndex` é capturado da `pendingQuestion` **antes** de ela ser limpa no `submitAnswer`.

---

## 5. Modelo de dados

Nenhuma mudança no `SessionState` persistido. Todo o delta é de **projeção/emissão** (camada de
contrato), exceto o threading do `correctIndex` no resultado de `submitAnswer` (já existe em
`PendingQuestion.correctIndex` — só precisa ser propagado ao DTO de saída).

---

## 6. Quebra em PRs incrementais

Cada PR entrega **uma responsabilidade lógica**, é **deployável isoladamente** e **aditivo**
(não quebra o contrato S2). Ordem sugerida; PR4 e PR5 são independentes entre si.

| PR | Branch | Entrega | Depende de |
|----|--------|---------|------------|
| **PR1** | `feat/s3-player-square` | `square` em `toPlayerView`; `difficulty` em `toLobbyState` (L1) | — |
| **PR2** | `feat/s3-gamestate-snapshot` | Projeção `toGameState` + evento `gameState` emitido em `gameStarted` e `reconnect` (L2) | PR1 |
| **PR3** | `feat/s3-request-state` | Handler `requestState` (c→s) → `gameState` ao remetente (L3) | PR2 |
| **PR4** | `feat/s3-question-subject` | `subject` no `questionPrompt` (L4) | — |
| **PR5** | `feat/s3-answer-reveal` | `correctIndex` no `answerResult` (L5) | — |
| **PR6** | `docs/s3-contract` | Congela `CONTRACT-S3.md`; atualiza `STATE.md`; e2e de snapshot+reveal; fecha issue #7 | PR1..PR5 |

---

## 7. Critérios de aceite

1. **L1:** unit de `toPlayerView`/`toLobbyState` afirma presença de `square`/`difficulty`.
2. **L2:** unit de `toGameState` afirma o shape completo e a **ausência** de `socketId`,
   `pendingQuestion`, `correctIndex`. e2e: após `gameStarted`, a sala recebe `gameState` com
   `board` e posições.
3. **L3:** e2e: cliente emite `requestState` e recebe `gameState` coerente; socket sem sessão
   recebe `error{NOT_IN_SESSION}`.
4. **L4:** unit/e2e: `questionPrompt` inclui `subject` e **nunca** a correta.
5. **L5 (RF-16 — bloqueante):** e2e afirma que (a) `questionPrompt` **não** contém `correctIndex`
   nem o texto da correta; (b) `answerResult` **contém** `correctIndex` apontando para a opção
   correta; (c) `correctIndex ∈ [0, options.length-1]`.
6. **Retrocompatibilidade:** nenhum campo existente do contrato S2 é removido ou renomeado.
7. **Gates por PR:** `npm run build` ✅, `npm run lint` ✅, `npm run test` ✅, `npm run test:e2e` ✅.

---

## 8. Fora do escopo (S3 backend)

- Frontend em si (SVG, telas) — paralelo.
- Conteúdo final do banco (10 matérias) e hardening/deploy — Sprint 4.
- Geometria/coordenadas do tabuleiro no servidor — o SVG é **procedural no frontend** a partir
  de `board.size` + `tileTypeBySquare` (decisão do `CLAUDE.md`). O backend não envia coordenadas.
