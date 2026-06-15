# Contrato WebSocket — proexGame (consolidado, atual)

> **Fonte única de verdade** para o frontend conectar ao backend. Consolida S1+S2+S3 e a
> **Sprint 4** (fase de ordem interativa — RF-04). Os contratos por sprint em
> `.specs/features/*/CONTRACT-S*.md` permanecem como histórico; em caso de divergência,
> **este arquivo prevalece**.

## Transporte e identidade

- **Socket.IO**, namespace padrão `/`. Cliente: `socket.io-client`.
- **CORS/origem:** em produção, restrito a `FRONTEND_ORIGIN` (uma URL ou várias separadas por
  vírgula; barra final é ignorada). Em dev/test sem a variável, libera qualquer origem.
- **Sala** = `code` (5 dígitos, string). O servidor vincula o socket à sala em
  create/join/reconnect; eventos de sala vão para todos na sala.
- **Identidade** = `playerId` (UUID v4) gerado pelo servidor. **É o portador da reconexão** —
  o front deve guardá-lo (ex.: `localStorage`) junto com o `code`.
- **Sem auth.** Nome digitado + `playerId`.
- **Autoridade total do servidor (RF-16):** todas as rolagens, seleção de pergunta, validação
  de resposta e cálculo de movimento são no backend. A alternativa correta **nunca** é enviada
  antes da submissão.

## Ciclo de vida da sessão (`status`)

```
lobby ──startGame──▶ ordering ──(todos rolam, RF-04)──▶ playing ──(vitória)──▶ finished
```

- **lobby** — aguardando jogadores (2–4). Só o host inicia.
- **ordering** — *novo na S4*: cada jogador rola o d6 para definir a ordem; empate re-rola só
  entre os empatados. Vira `playing` quando a ordem é totalmente resolvida.
- **playing** — partida em andamento (turnos).
- **finished** — alguém venceu (chega-ou-passa).

---

## Tipos compartilhados

```ts
type Difficulty = 'easy' | 'normal' | 'hard';
type SessionStatus = 'lobby' | 'ordering' | 'playing' | 'finished';
type TileType = 'start' | 'normal' | 'question' | 'prison' | 'finish';

interface PlayerView {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  square: number; // 0 = início
}

interface Board {
  size: number;                                // N ∈ [20, 30]
  tileTypeBySquare: Record<number, TileType>;  // só casas especiais; demais são 'normal'
  subjectBySquare: Record<number, string>;     // matéria das casas 'question'
}

interface Roll { playerId: string; value: number; }            // value ∈ [1, 6]
interface RankingEntry { playerId: string; name: string; square: number; position: number; }
```

---

## client → server

| Evento | Payload | Ack (callback) | Efeito (eventos emitidos) |
| --- | --- | --- | --- |
| `createSession` | `{ name: string, difficulty: Difficulty }` | `{ code, playerId }` | `sessionCreated` (ao autor) + `lobbyState` (sala) |
| `joinSession` | `{ code: string, name: string }` | `{ code, playerId }` | `playerJoined` + `lobbyState` (sala) |
| `startGame` | _(nenhum)_ | — | `gameStarted` → `gameState`(ordering) → `orderPhase` (sala). **Só o host**; ≥2 jogadores. |
| `rollForOrder` | _(nenhum)_ | — | `orderRoll` + (`orderResult`→`gameState`→`turnChanged` **ou** novo `orderPhase`). RF-04. |
| `rollDice` | _(nenhum)_ | — | `diceResult` + (`gameOver` **ou** `questionPrompt`(ao autor) **ou** `turnChanged`[+`turnSkipped`]). |
| `submitAnswer` | `{ questionId: string, optionIndex: number }` | — | `answerResult` + (`gameOver` **ou** `questionPrompt`(encadeamento) **ou** `turnChanged`). |
| `leaveSession` | _(nenhum)_ | — | `lobbyState` (ou, se na fase de ordem, reinício da ordem / volta ao lobby). |
| `reconnect` | `{ code: string, playerId: string }` | `{ code, playerId }` | `playerReconnected` + `lobbyState` + [`turnChanged`/`orderPhase`] + `gameState` (ao autor). |
| `requestState` | _(nenhum)_ | — | `gameState` (só ao autor). Resync sob demanda (pós-refresh). |

> **Identificação:** `startGame`, `rollForOrder`, `rollDice`, `submitAnswer`, `leaveSession`,
> `requestState` **não** levam `code`/`playerId` no payload — o servidor os lê do `socket.data`
> (vinculado em create/join/reconnect). Isso evita IDOR. Socket sem sessão → `error{NOT_IN_SESSION}`.

---

## server → client

### Lobby e estado

| Evento | Payload | Quando |
| --- | --- | --- |
| `sessionCreated` | `{ code: string, playerId: string }` | Após `createSession` (só ao autor). |
| `playerJoined` | `{ player: PlayerView \| null }` | Após `joinSession` (sala). |
| `lobbyState` | `{ code, status, difficulty, hostId: string \| null, players: PlayerView[] }` | Em create/join/leave/reconnect. |
| `gameStarted` | `{ board: Board }` | Após `startGame` (sala). Board procedural já gerado. |
| `gameState` | _(ver shape abaixo)_ | Snapshot canônico: após `gameStarted`; no `orderResult`; após `reconnect` e `requestState` (só ao autor). |

#### Shape do `gameState`

```ts
{
  code: string;
  status: SessionStatus;
  difficulty: Difficulty;
  board: Board;
  players: PlayerView[];
  currentTurnPlayerId: string | null;   // null fora de 'playing'
  ordering: {                            // != null SÓ em status 'ordering' (RF-04)
    round: number;
    playersToRoll: string[];             // quem está no grupo que ainda rola nesta rodada
    rolled: string[];                    // quem já rolou nesta rodada (use p/ esconder o botão)
  } | null;
  winner: string | null;                 // playerId
  ranking: RankingEntry[] | null;        // preenchido só em 'finished'
}
```

**Nunca vaza:** `socketId`, `pendingQuestion`, `correctIndex`/`proximalIndex`, `servedQuestionIds`,
`usedQuestionIds` (garantido por construção + teste e2e via `JSON.stringify`).

### Fase de ordem — RF-04 (novo na Sprint 4)

| Evento | Payload | Quando |
| --- | --- | --- |
| `orderPhase` | `{ round: number, playersToRoll: string[] }` | Início da fase (round 1) e a cada nova rodada de desempate. Diz **quem deve rolar agora**. |
| `orderRoll` | `{ playerId: string, value: number, round: number }` | A cada rolagem individual (sala) — para animar o dado. |
| `orderResult` | `{ rolls: Roll[], rounds: Roll[][], turnOrder: string[] }` | Ordem totalmente resolvida. `rounds` = todas as rodadas (inclui desempates); `rolls` = `rounds[0]` (compat). |

**Fluxo da fase de ordem:**
```
startGame → gameStarted{board} → gameState{status:'ordering', ordering} → orderPhase{round:1, playersToRoll:[...todos]}

para cada jogador em playersToRoll:
  client: rollForOrder
  server: orderRoll{playerId, value, round}   (broadcast)

ao completar a rodada:
  • sem empate  → orderResult{rolls, rounds, turnOrder} → gameState{status:'playing'} → turnChanged{firstPlayerId}
  • com empate  → orderPhase{round+1, playersToRoll:[só os empatados]}   (repete)
```

**Regras de UI:**
- Mostrar o botão "rolar" só para o `playerId` local **se** ele estiver em `orderPhase.playersToRoll`
  **e** ainda **não** em `gameState.ordering.rolled` (relevante após reconexão no meio da rodada).
- Empates re-rolam **apenas entre os empatados** — os já resolvidos ficam fixos.
- O servidor rejeita rolagem inválida: fora da fase (`ORDER_NOT_ACTIVE`), de quem não está no grupo
  (`NOT_ROLLING_FOR_ORDER`), ou segunda rolagem na mesma rodada (`ALREADY_ROLLED_FOR_ORDER`).
- **Robustez:** se um jogador cai durante a ordem, o servidor **rola por ele** automaticamente
  (emite `orderRoll` normalmente). Se alguém sai (`leaveSession`), a ordem reinicia com os restantes
  (`orderPhase` round 1) — ou volta ao lobby se sobrarem menos de 2.

### Turno e movimento

| Evento | Payload | Quando |
| --- | --- | --- |
| `turnChanged` | `{ playerId: string }` | Início do turno de um jogador. |
| `diceResult` | `{ playerId, value, fromSquare, toSquare }` | Após `rollDice`. `value` ∈ [1,6]. |
| `turnSkipped` | `{ playerId, remaining: number }` | Presídio (RF-20): o jogador perde a vez; `remaining` = turnos a pular restantes. |
| `gameOver` | `{ winner: string, ranking: RankingEntry[] }` | Vitória (chega-ou-passa, RF-12). |

### Fluxo de pergunta (RF-08/09/16)

| Evento | Payload | Quando |
| --- | --- | --- |
| `questionPrompt` | `{ questionId, subject, statement, options: string[] }` | Aterrissou em casa-pergunta (via dado ou avanço de acerto). **Só ao jogador da vez.** Sem qualquer pista da correta. |
| `answerResult` (autor) | `{ playerId, correct, errorType, movement, fromSquare, toSquare, correctIndex }` | Após `submitAnswer`, **só ao autor**. `correctIndex` é o índice da correta em `options` (revelação pós-submissão). |
| `answerResult` (sala) | `{ playerId, correct, errorType, movement, fromSquare, toSquare }` | Mesmo evento aos demais, **sem `correctIndex`**. |

- `errorType`: `'none'` (acerto) · `'proximal'` (distrator próximo) · `'wrong'` (erro total).
- `movement`: delta de casas (negativo no recuo). `options.length` é sempre 4 (1 correta, 1 proximal, 2 erradas, embaralhadas).

### Conexão

| Evento | Payload | Quando |
| --- | --- | --- |
| `playerDisconnected` | `{ playerId }` | Um jogador caiu (grace de 5 min inicia, RF-14). |
| `playerReconnected` | `{ playerId }` | Um jogador reconectou dentro do grace. |
| `sessionClosed` | `{ reason: string }` | Sessão encerrada (ex.: inatividade — RF-15). |
| `error` | `{ code: ErrorCode, message: string }` | Qualquer falha (só ao remetente). Não altera o estado. |

---

## Sequências de emissão (resumo)

```
# Início + ordem (RF-04)
startGame → gameStarted{board} → gameState{ordering} → orderPhase{1,...}
  → (rolagens) orderRoll* → orderResult → gameState{playing} → turnChanged

# Turno normal
rollDice → diceResult → turnChanged                      (casa normal)
rollDice → diceResult → turnSkipped → turnChanged        (presídio)
rollDice → diceResult → questionPrompt(autor)            (casa-pergunta; turno NÃO passa)
submitAnswer → answerResult → turnChanged                (acerto/erro sem encadeamento)
submitAnswer → answerResult → questionPrompt(autor)      (acerto encadeou nova pergunta, RF-11)
rollDice|submitAnswer → diceResult|answerResult → gameOver   (vitória)

# Reconexão (RF-14)
reconnect{code,playerId} → playerReconnected → lobbyState
  → [turnChanged se playing | orderPhase se ordering] → gameState(ao autor)
```

---

## ErrorCode (evento `error`)

`SESSION_NOT_FOUND` · `SESSION_FULL` · `SESSION_ALREADY_STARTED` · `INVALID_NAME` · `NOT_HOST` ·
`NOT_ENOUGH_PLAYERS` · `NOT_YOUR_TURN` · `GAME_NOT_ACTIVE` · `NOT_IN_SESSION` · `ANSWER_PENDING` ·
`NO_PENDING_QUESTION` · `QUESTION_MISMATCH` · `INVALID_OPTION` · `RECONNECT_FAILED` ·
`ORDER_NOT_ACTIVE` · `NOT_ROLLING_FOR_ORDER` · `ALREADY_ROLLED_FOR_ORDER` ·
`INVALID_PAYLOAD` · `INTERNAL`

> `INVALID_PAYLOAD` (S4): payload malformado de `submitAnswer`/`reconnect` (erro de transporte),
> separado dos códigos de regra de jogo.
> `ANSWER_PENDING` (S4): `rollDice` recebido enquanto o jogador tem uma pergunta pendente — precisa
> responder (`submitAnswer`) antes de rolar de novo. Surge tipicamente no double-click em `rollDice`
> quando a 1ª rolagem caiu em casa-pergunta (o turno não passou). O front pode ignorá-lo (UI já
> deve estar na tela de pergunta) ou exibir um aviso leve.

---

## Mudanças da Sprint 4 (em relação ao CONTRACT-S3)

- **`status` ganha `'ordering'`** entre `lobby` e `playing`.
- **`rollForOrder` deixa de ser no-op**: agora é a rolagem interativa de cada jogador (RF-04).
- **Novos eventos:** `orderPhase`, `orderRoll`. **`orderResult` mudou:** agora traz `rounds`
  (todas as rodadas, com desempates) além de `rolls` (1ª rodada, mantido por compat).
- **`gameState` ganha o campo `ordering`** (≠ null só em `status:'ordering'`).
- **Início da partida:** após `startGame`, o jogo entra em `ordering` (não vai direto para
  `playing`); o `turnChanged` inicial vem só após o `orderResult`.
- **Novos `ErrorCode`:** `ORDER_NOT_ACTIVE`, `NOT_ROLLING_FOR_ORDER`, `ALREADY_ROLLED_FOR_ORDER`,
  `INVALID_PAYLOAD`.
