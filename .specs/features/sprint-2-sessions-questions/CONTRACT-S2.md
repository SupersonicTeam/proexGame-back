# Contrato WebSocket — Sprint 2 (congelado)

> Estende `CONTRACT-S1.md`. Tudo da S1 continua valendo; aqui só o que a Sprint 2
> **adiciona ou altera**. Transporte: Socket.IO, namespace `/`, CORS `origin: true`.
> Sala = `code` (5 dígitos). Identidade = `playerId` (UUIDv4 gerado pelo servidor).

## Mudanças de comportamento (S1 → S2)

- **Tabuleiro agora é procedural** (RF-06): `gameStarted.board.size` varia em **[20, 30]**
  (na S1 era fixo 25). O `board` traz `tileTypeBySquare` (`start|normal|question|prison|finish`)
  e `subjectBySquare` (matéria de cada casa-pergunta).
- **Casas especiais**: ao aterrissar via **dado** numa casa-pergunta, o servidor emite
  `questionPrompt` **só para o jogador** e o turno **não passa** até o `submitAnswer`. Ao aterrissar
  em presídio, o jogador perde a próxima jogada.
- **Balanceamento completo** ativo (RF-10/11/13): avanço por tier/dificuldade, recuo proximal/total,
  nudge anti-encadeamento, encadeamento e clamp. Já refletido em `answerResult`/`diceResult`.

---

## client → server (novos)

| Evento         | Payload                                  | Observações |
| -------------- | ---------------------------------------- | ----------- |
| `submitAnswer` | `{ questionId: string, optionIndex: number }` | Só quando há pergunta pendente para o remetente. `optionIndex` é o índice na lista `options` recebida em `questionPrompt`. |
| `reconnect`    | `{ code: string, playerId: string }`     | Revincula o socket dentro da janela de 5 min. `playerId` é o portador da identidade — guarde-o ao criar/entrar. |

> Validação estrita no servidor: `optionIndex` precisa ser inteiro; `code` precisa ter 5 dígitos.
> A correção da resposta é decidida **exclusivamente no servidor** (RF-16).

---

## server → client (novos)

| Evento              | Payload | Quando |
| ------------------- | ------- | ------ |
| `questionPrompt`    | `{ questionId: string, statement: string, options: string[] }` | Ao cair em casa-pergunta (dado) ou ao encadear após um acerto. **Enviado só ao jogador da pergunta.** NUNCA contém a resposta correta. |
| `answerResult`      | `{ playerId, correct: boolean, errorType: 'none'\|'proximal'\|'wrong', movement: number, fromSquare: number, toSquare: number }` | Após `submitAnswer`. `movement` é o delta de casas (negativo no recuo). |
| `turnSkipped`       | `{ playerId: string, remaining: number }` | No início do turno de um jogador preso: ele perde a vez. `remaining` = turnos de prisão restantes. |
| `playerReconnected` | `{ playerId: string }` | Broadcast quando um jogador reconecta com sucesso. |
| `sessionClosed`     | `{ reason: string }` | A sessão foi encerrada (ex.: `reason: 'inactivity'` quando todos saem e o grace expira). |

### Sequência de uma pergunta

```
(jogador da vez) → rollDice
                                   sala ← diceResult{playerId,value,fromSquare,toSquare}
  (se toSquare é casa-pergunta)    jogador ← questionPrompt{questionId,statement,options}
jogador → submitAnswer{questionId,optionIndex}
                                   sala ← answerResult{correct,errorType,movement,...}
  (acerto que cai em casa-pergunta) jogador ← questionPrompt{...}   (encadeamento; turno não passa)
  (senão)                          sala ← turnChanged{próximo}   (ou gameOver)
```

### Presídio

```
(jogador da vez) → rollDice
                                   sala ← diceResult{... toSquare = casa de presídio}
                                   sala ← turnChanged{próximo}      (turno passa; nada de pergunta)
... quando voltar a vez do preso:
                                   sala ← turnSkipped{playerId, remaining}
                                   sala ← turnChanged{próximo}
```

### Reconexão (RF-14/15)

- Ao cair, o servidor emite `playerDisconnected{playerId}` e arma um **grace de 5 min**.
- Dentro da janela: `reconnect{code, playerId}` → `playerReconnected` + `lobbyState` (e `turnChanged`
  com o turno atual, se a partida está em andamento).
- Se o grace expira e a sessão fica sem jogadores, ela é apagada e a sala recebe `sessionClosed`.
- Backstop: a chave de sessão no Redis tem TTL deslizante (renovado a cada ação).

---

## ErrorCode (adições da Sprint 2)

| code                    | Significado |
| ----------------------- | ----------- |
| `NO_PENDING_QUESTION`   | `submitAnswer` sem pergunta pendente para o jogador. |
| `QUESTION_MISMATCH`     | `questionId` enviado não corresponde à pergunta pendente (ou ausente/vazio). |
| `INVALID_OPTION`        | `optionIndex` ausente, não-inteiro ou fora do intervalo das opções. |
| `RECONNECT_FAILED`      | `reconnect` com `code`/`playerId` inválidos ou sessão inexistente. |

Todos os erros são emitidos como `error{code, message}` **só ao remetente**, sem alterar o estado.

---

## Notas de segurança (RF-16)

- `questionPrompt` carrega apenas `questionId`, `statement` e `options` embaralhadas. A correta é
  indistinguível; índices internos (`correctIndex`/`proximalIndex`) nunca trafegam.
- O client envia só `optionIndex`; a classificação (acerto/proximal/erro) é feita no servidor.
- `playerId` é um UUIDv4 não-adivinhável e é o único portador de reconexão.
- Nenhum evento expõe `socketId` de terceiros.
