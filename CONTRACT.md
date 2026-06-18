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
  color?: string; // S5: hex "#rrggbb" escolhido pelo jogador (ausente = sem escolha)
  emoji?: string; // S5: 1 emoji escolhido pelo jogador (ausente = sem escolha)
}

interface Board {
  size: number;                                // N por dificuldade: easy[30,45] normal[60,70] hard[65,85]
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
| `leaveSession` | _(nenhum)_ | — | Depende do `status`: **lobby** → `lobbyState`; **ordering** → reinício da ordem (`orderPhase` round 1) ou volta ao lobby se sobrar <2; **playing** → `gameState`+`turnChanged` (a vez pode mudar de dono) **ou** `gameOver` se sobrar só 1 (abandono); sala vazia → `sessionClosed{host_left}`. |
| `reconnect` | `{ code: string, playerId: string }` | `{ code, playerId }` | `playerReconnected` + `lobbyState` + [`turnChanged`/`orderPhase`] + `gameState` (ao autor). |
| `requestState` | _(nenhum)_ | — | `gameState` (só ao autor). Resync sob demanda (pós-refresh). |
| `setAppearance` | `{ color: string, emoji: string }` | — | `lobbyState` (no lobby) **ou** `gameState` (em ordering/playing). **S5 — cosmético.** |

> **Identificação:** `startGame`, `rollForOrder`, `rollDice`, `submitAnswer`, `leaveSession`,
> `requestState`, `setAppearance` **não** levam `code`/`playerId` no payload — o servidor os lê
> do `socket.data` (vinculado em create/join/reconnect). Isso evita IDOR. Socket sem sessão →
> `error{NOT_IN_SESSION}`.

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
| `gameOver` | `{ winner: string, ranking: RankingEntry[] }` | Fim de jogo. Duas origens: **vitória** (chega-ou-passa, RF-12) **ou** **abandono** — em `playing`, se o nº de jogadores cai para 1 (via `leaveSession` ou expiração de grace), o restante é declarado vencedor. Sempre precedido de um `gameState{status:'finished'}`. |

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

> `INVALID_PAYLOAD` (S4): payload malformado de `submitAnswer`/`reconnect`/`setAppearance` (erro de
> transporte), separado dos códigos de regra de jogo.
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

---

## Mudanças da Sprint 5 (aparência do peão — CONTRACT-S5)

Aditivo e **retrocompatível**: clientes antigos ignoram os campos novos. **Puramente cosmético** —
não afeta movimento, ordem, perguntas nem prisão (sem impacto em RF-16).

- **`PlayerView` ganha `color?` e `emoji?`** (opcionais). Propagados em `lobbyState`, `playerJoined`
  e `gameState`. Ausentes = "sem escolha" → o front aplica o fallback determinístico por índice.
- **Novo evento `setAppearance{color,emoji}`** (client→server): define a aparência do próprio peão
  (lê o `playerId` do `socket.data`) e faz **rebroadcast** — `lobbyState` no lobby, `gameState` em
  `ordering`/`playing`. Aceito em qualquer status.
- **Validação (transporte):** `color` casa `^#[0-9a-fA-F]{6}$`; `emoji` é **1 grafema** (clusters
  compostos com ZWJ/tom de pele/bandeira contam como 1, via `Intl.Segmenter`) com teto de 64 bytes.
  Payload malformado → `error{INVALID_PAYLOAD}`. Sem paleta fixa no servidor (curadoria visual no front).
- **Prisão:** nenhuma mudança de backend — a animação de "grade/preso" é 100% front, derivada de
  `diceResult` (casa `prison` via `tileTypeBySquare`) + `turnSkipped{playerId,remaining}` já emitidos.
- **Novos `ErrorCode`:** `ORDER_NOT_ACTIVE`, `NOT_ROLLING_FOR_ORDER`, `ALREADY_ROLLED_FOR_ORDER`,
  `INVALID_PAYLOAD`.

---

## Mudanças pós-S5 — review-fixes-s4 (PRs #16–#17)

> **Sem novos eventos nem mudança de shape.** São ajustes de **comportamento** do servidor que o
> front precisa tratar. Nenhuma ação altera RF-16. Tudo aqui é retrocompatível com os tipos acima.

### 1. `gameOver` agora também dispara por abandono (achado #3)

Antes, `gameOver` só vinha pela chegada (chega-ou-passa). Agora, **durante `playing`**, se a sala cai
para **1 jogador** — porque alguém deu `leaveSession` ou teve o grace de reconexão expirado — a partida
**termina imediatamente** e o último restante é declarado `winner`.

- Ordem de emissão: `gameState{status:'finished', winner}` → `gameOver{winner, ranking}`.
- **No lobby e em `ordering` isso NÃO acontece**: lá a saída só reinicia a ordem ou volta ao lobby.
- **Ação no front:** a tela de fim de jogo não pode assumir que o vencedor chegou ao fim do tabuleiro;
  trate `gameOver` como "partida encerrada" e use `ranking` (já ordenado) para a tela final. O `winner`
  pode estar em qualquer casa.

### 2. `leaveSession`/expiração em `playing` reconciliam o turno (achados #3/#6)

Quando um jogador sai (ou expira) e a partida **continua** (≥2 jogadores), o dono da vez pode mudar
porque o `turnOrder` é recompactado. O servidor reemite **`gameState` + `turnChanged`** para a sala.

- **Ação no front:** sempre derive "de quem é a vez" do último `turnChanged`/`gameState.currentTurnPlayerId`
  — nunca de um índice local. Após qualquer `playerDisconnected`/saída, espere um `turnChanged` novo.
- Detalhe de regra (sem impacto de UI): o cálculo de avanço por acerto (tiers) passou a **ignorar
  jogadores desconectados** ao definir leader/middle/last. O front não calcula movimento, então só
  reflete o `movement`/`toSquare` que vier no `answerResult`.

### 3. Reconciliação pós-restart do backend (achado #2)

No boot, o servidor marca **todos** os jogadores das sessões ativas como **desconectados** e rearma o
grace de 5 min (os timers e sockets não sobrevivem a um restart). Consequência para o front:

- Após uma queda/redeploy do backend, o socket cai e, ao reconectar o transporte, o cliente **deve
  disparar `reconnect{code,playerId}`** (com os valores guardados em `localStorage`) para retomar a vez.
- Quem **não** reenviar `reconnect` dentro do grace é expirado normalmente (e pode disparar o `gameOver`
  por abandono do item 1). **Recomendação:** auto-`reconnect` no evento `connect` do socket sempre que
  houver `code`+`playerId` salvos.

### 4. Banco de perguntas: 8 matérias (PR #17)

`subject` (em `questionPrompt` e em `board.subjectBySquare`) agora pode assumir **qualquer uma das 8**
chaves abaixo. O front deve ter rótulo/ícone para cada uma, com **fallback genérico** para chaves novas:

```
conhecimentos-gerais · desenvolvimento-web · fisica · logica
matematica · matematica-financeira · portugues · quimica
```

- São identificadores estáveis (slug em inglês/kebab, sem acento) — use-os como chave de i18n/ícone,
  não para exibição direta. Ex.: `matematica-financeira` → "Matemática Financeira".
- ⚠️ **Conteúdo de nível `hard`:** hoje só `matematica` tem perguntas de dificuldade alta; cobrir as
  outras 7 matérias no nível `hard` é trabalho pendente. Sem impacto no contrato — apenas evite assumir
  paridade de volume entre matérias na UI.
