# Contrato WebSocket — Sprint 1 (congelado)

> Transporte: **Socket.IO** (default namespace `/`). CORS liberado (`origin: true`).
> Porta padrão: `3000` (env `PORT`). Conecte em `ws(s)://<host>:<port>`.
> Este contrato cobre **apenas a Sprint 1** (núcleo jogável, sem perguntas).
> Eventos de pergunta, reconexão e presídio entram nas próximas sprints.

## Identidade

- Não há login. A identidade do jogador é o `playerId` (UUID) gerado pelo servidor.
- O cliente deve **guardar** o `playerId` recebido — será usado para reconexão (Sprint 2).
- A sala é o `code` da sessão; todos os eventos de jogo são emitidos para a sala.

---

## client → server

Cada `emit` pode passar uma **callback de ack** opcional (3º argumento do `socket.emit`).
Quando indicado, o servidor responde via ack além de emitir os eventos broadcast.

| Evento          | Payload                          | Ack (retorno)                     | Observações |
| --------------- | -------------------------------- | --------------------------------- | ----------- |
| `createSession` | `{ name: string, difficulty }`   | `{ code, playerId }`              | `difficulty`: `easy\|normal\|hard` (sem efeito de cálculo na S1). Também emite `sessionCreated`. |
| `joinSession`   | `{ code: string, name: string }` | `{ code, playerId }`              | Use o ack para obter o seu `playerId`. |
| `startGame`     | — (nenhum)                       | —                                 | Apenas o host. Usa a sessão vinculada ao socket. |
| `rollForOrder`  | — (nenhum)                       | `{ ok: true }`                    | No-op na S1 (ordem é resolvida no `startGame`). |
| `rollDice`      | — (nenhum)                       | —                                 | Apenas o jogador da vez. |
| `leaveSession`  | — (nenhum)                       | —                                 | Sai da sala e atualiza o lobby. |

> `difficulty` aceita `easy \| normal \| hard`. Na Sprint 1 é persistida mas não altera o jogo.

---

## server → client

| Evento               | Payload                                                            | Quando |
| -------------------- | ----------------------------------------------------------------- | ------ |
| `sessionCreated`     | `{ code: string, playerId: string }`                              | Após `createSession` (só para o criador). |
| `playerJoined`       | `{ player: { id, name, connected, isHost } }`                     | Quando alguém entra (broadcast na sala). |
| `lobbyState`         | `{ code, status, hostId, players: PlayerView[] }`                 | Em qualquer mudança no lobby. |
| `gameStarted`        | `{ board: { size: number, tileTypeBySquare } }`                   | Quando o host inicia. |
| `orderResult`        | `{ rolls: { playerId, value }[], turnOrder: string[] }`           | Logo após `gameStarted`. |
| `turnChanged`        | `{ playerId: string }`                                            | A cada troca de turno (inclui o 1º). |
| `diceResult`         | `{ playerId, value, fromSquare, toSquare }`                       | Após cada `rollDice` válido. |
| `gameOver`           | `{ winner: string, ranking: RankingEntry[] }`                     | Quando alguém chega/ultrapassa N. |
| `playerDisconnected` | `{ playerId: string }`                                            | Quando um socket cai. |
| `sessionClosed`      | `{ reason: string }`                                              | (Reservado — uso amplo na Sprint 2.) |
| `error`              | `{ code: ErrorCode, message: string }`                            | Em qualquer ação inválida (só ao remetente). |

### Tipos auxiliares

```ts
type PlayerView = { id: string; name: string; connected: boolean; isHost: boolean };
type RankingEntry = { playerId: string; name: string; square: number; position: number };
type TileType = 'start' | 'normal' | 'finish'; // S1: só 0='start' e N='finish'; resto normal
```

---

## ErrorCode (Sprint 1)

| code                      | Significado |
| ------------------------- | ----------- |
| `SESSION_NOT_FOUND`       | Código de sessão inexistente/expirado. |
| `SESSION_FULL`            | Lobby com 4 jogadores. |
| `SESSION_ALREADY_STARTED` | Tentou entrar/iniciar uma sessão fora do lobby. |
| `INVALID_NAME`            | Nome vazio ou só espaços. |
| `NOT_HOST`                | `startGame` por quem não é host. |
| `NOT_ENOUGH_PLAYERS`      | `startGame` com menos de 2 jogadores. |
| `NOT_YOUR_TURN`           | `rollDice` fora da vez. |
| `GAME_NOT_ACTIVE`         | Ação de jogo com a partida não em andamento. |
| `NOT_IN_SESSION`          | Ação sem sessão vinculada ao socket. |

---

## Fluxo típico (happy path)

```
c1 → createSession{name,difficulty}      c1 ← sessionCreated{code, playerId}
                                          sala ← lobbyState{...}
c2 → joinSession{code,name}  (ack)       c2 ← ack{code, playerId}
                                          sala ← playerJoined / lobbyState
c1 → startGame                            sala ← gameStarted{board}
                                          sala ← orderResult{rolls, turnOrder}
                                          sala ← turnChanged{playerId}
(jogador da vez) → rollDice               sala ← diceResult{playerId,value,from,to}
                                          sala ← turnChanged{próximo}   (ou)
                                          sala ← gameOver{winner, ranking}
```

**Regra de driver do cliente:** ao receber `turnChanged{playerId}`, se `playerId` é o seu,
habilite o botão de rolar; ao clicar, `emit('rollDice')`. Repita até `gameOver`.
