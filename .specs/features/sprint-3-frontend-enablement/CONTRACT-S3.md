# Contrato WebSocket — Sprint 3 (congelado)

> Estende `CONTRACT-S2.md` (issue #7). Tudo da S1/S2 continua valendo; aqui só o que a
> Sprint 3 **adiciona**. Transporte: Socket.IO, namespace `/`, CORS `origin: true` (hardening
> de origem explícita fica para a S4). Sala = `code` (5 dígitos). Identidade = `playerId` (UUIDv4).
>
> **Tema da Sprint 3 (backend): habilitação do frontend.** O balanceamento (tiers/nudge/
> dificuldade) e o fluxo de pergunta já vieram na S2. Esta sprint só adiciona o que o frontend
> precisa para **renderizar o tabuleiro SVG, posicionar peões e montar as telas de pergunta/
> resultado** — inclusive **após um refresh/reconexão**. Todas as mudanças são **aditivas e
> retrocompatíveis**: nenhum campo da S2 foi removido ou renomeado.

---

## Mudanças de comportamento (S2 → S3)

- **Projeções enriquecidas (aditivo):**
  - `playerView` (usado em `lobbyState`, `playerJoined`, `gameState`) agora inclui **`square`**
    (posição atual do peão).
  - `lobbyState` agora inclui **`difficulty`**.
- **Novo evento `gameState`**: snapshot completo e canônico da partida, emitido na sala logo após
  `gameStarted`/`orderResult`, e **só ao remetente** após `reconnect` e em resposta a `requestState`.
  Permite (re)render total do tabuleiro e posições — substitui a necessidade de reenviar `gameStarted`.
- **`questionPrompt` agora inclui `subject`** (matéria) — para tematizar a tela de pergunta.
  Continua **sem** qualquer pista da correta (RF-16).
- **`answerResult` revela a correta — só ao autor**: o jogador que respondeu recebe
  `correctIndex` (índice da alternativa correta na lista `options` que ele recebeu); o restante da
  sala recebe o `answerResult` **sem** `correctIndex`. A revelação é **pós-submissão** (RF-16 intacto).

---

## client → server (novos)

| Evento         | Payload | Observações |
| -------------- | ------- | ----------- |
| `requestState` | _(nenhum)_ | Pede o snapshot completo da sessão à qual o socket pertence. A sessão é determinada pelo `socket.data` (vinculado pelo servidor em create/join/reconnect) — o cliente **não** envia `code`. Responde com `gameState` **só ao remetente**. Socket sem sessão vinculada → `error{NOT_IN_SESSION}`. |

---

## server → client (novos / alterados)

| Evento | Payload | Quando |
| ------ | ------- | ------ |
| `gameState` | `{ code, status, difficulty, board, players, currentTurnPlayerId, winner, ranking }` | Após `gameStarted` (sala); após `reconnect` (só ao remetente); em resposta a `requestState` (só ao remetente). |
| `questionPrompt` *(alterado)* | `{ questionId, subject, statement, options: string[] }` | **+`subject`**. Continua sem a correta (RF-16). |
| `lobbyState` *(alterado)* | `{ code, status, difficulty, hostId, players }` | **+`difficulty`**. |
| `playerJoined` / `playerView` *(alterado)* | `player: { id, name, connected, isHost, square }` | **+`square`**. |
| `answerResult` *(alterado)* | autor: `{ playerId, correct, errorType, movement, fromSquare, toSquare, correctIndex }` · sala (demais): **sem** `correctIndex` | Após `submitAnswer`. `correctIndex` vai **só** ao autor. |

### Shape do `gameState`

```ts
{
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  difficulty: 'easy' | 'normal' | 'hard';
  board: {
    size: number;                                // N ∈ [20,30]
    tileTypeBySquare: Record<number, TileType>;  // start|normal|question|prison|finish
    subjectBySquare: Record<number, string>;     // matéria das casas 'question'
  };
  players: { id: string; name: string; connected: boolean; isHost: boolean; square: number }[];
  currentTurnPlayerId: string | null;            // null fora de 'playing'
  winner: string | null;                         // playerId
  ranking: { playerId: string; name: string; square: number; position: number }[] | null;
                                                 // preenchido só em 'finished'
}
```

**Nunca vaza:** `socketId`, `pendingQuestion`, `correctIndex`/`proximalIndex`,
`servedQuestionIds`, `usedQuestionIds`. Garantido por construção (`toGameState` reusa
`toPlayerView`) e por teste e2e que afirma a ausência via `JSON.stringify`.

### Ordem de emissão no início da partida

```
startGame → gameStarted{board} → gameState{snapshot} → orderResult{rolls,turnOrder} → turnChanged{playerId}
```

### Reconexão (RF-14) — adição

```
reconnect{code,playerId} → playerReconnected → lobbyState → [turnChanged se playing] → gameState{snapshot ao remetente}
```

---

## Notas de segurança (RF-16)

- `questionPrompt` carrega apenas `questionId`, `subject`, `statement` e `options` embaralhadas.
  `subject` é a matéria, não a resposta; a correta permanece indistinguível.
- `correctIndex` só existe **após** o `submitAnswer`, e é entregue **exclusivamente ao jogador que
  respondeu** (`client.emit`); a sala recebe o `answerResult` sem ele (`client.broadcast`).
  Adversários nunca recebem a correta de perguntas alheias.
- `gameState` é montado campo a campo e não serializa estado interno autoritativo.
- `requestState` lê o `code` apenas do `socket.data` (vinculado pelo servidor) — não há como um
  socket pedir o estado de uma sessão à qual não pertence (sem IDOR).

---

## ErrorCode

Sem novos códigos na S3. `requestState` reusa `NOT_IN_SESSION` (já existente).
