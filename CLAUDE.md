# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

Jogo de tabuleiro educativo multiplayer (até 4 jogadores, mobile + desktop), turnos alternados, competitivo. Evento único — ≤ 20 usuários simultâneos no pico. Prazo: 4 sprints (1 mês). Dev principal: Murilo Weiss.

**Regra fundamental:** toda lógica autoritativa é no servidor. A alternativa correta NUNCA é enviada ao client antes da submissão (RF-16).

## Stack

- **Backend:** NestJS + `@nestjs/websockets` (Socket.IO gateway). Toda lógica de jogo aqui.
- **Estado:** Redis single-node via `ioredis` — chave por sessão, TTL por inatividade (5 min).
- **Banco de perguntas:** arquivos JSON por matéria em `/questions`, carregados em memória no boot. Sem banco relacional.
- **Frontend:** React (Vite) — tabuleiro em SVG procedural responsivo. Estado via React state + eventos socket.
- **Deploy:** VPS Ubuntu 24.04, Nginx (reverse proxy + TLS/wss), pm2 ou Docker, Redis via Docker.
- **Sem auth.** Identidade = nome + `playerId` gerado pelo servidor.

## Comandos

```bash
# Backend (NestJS)
npm run start:dev      # dev com watch
npm run build          # compilar
npm run test           # unit tests
npm run test:e2e       # testes end-to-end

# Frontend (React Vite)
npm run dev            # dev server
npm run build          # build de produção
npm run preview        # preview do build

# Redis local
docker run -d -p 6379:6379 redis:alpine
```

## Modelo de dados

**Question (JSON — em `/questions/<materia>.json`):**
```json
{ "id": "mat-0001", "subject": "matematica", "statement": "...",
  "correct": "...", "proximal": "...", "wrong": ["...", "..."] }
```

**SessionState (Redis):**
```json
{
  "code": "12345",
  "status": "lobby|playing|finished",
  "difficulty": "easy|normal|hard",
  "board": {
    "size": 25,
    "tileTypeBySquare": { "5": "question", "12": "prison", "0": "start" },
    "subjectBySquare": { "5": "matematica" }
  },
  "players": [{
    "id": "...", "name": "...", "socketId": "...",
    "square": 0, "connected": true,
    "usedQuestionIds": [], "skipTurns": 0
  }],
  "turnOrder": [], "currentTurnIndex": 0,
  "winner": null, "createdAt": "...", "lastActivityAt": "..."
}
```

## Contrato WebSocket

**client→server:** `createSession{name,difficulty}` · `joinSession{code,name}` · `startGame` · `rollForOrder` · `rollDice` · `submitAnswer{questionId,optionIndex}` · `leaveSession` · `reconnect{code,playerId}` · `setAppearance{color,emoji}` (S5 — cosmético: cor hex + 1 emoji; rebroadcast `lobbyState`/`gameState`)

**server→client:** `sessionCreated{code,playerId}` · `playerJoined` · `lobbyState` · `gameStarted{board}` · `orderResult` · `turnChanged{playerId}` · `diceResult{value,fromSquare,toSquare}` · `questionPrompt{questionId,statement,options}` · `answerResult{correct,errorType,movement,toSquare}` · `turnSkipped{playerId,remaining}` · `gameOver{winner,ranking}` · `playerDisconnected` · `playerReconnected` · `sessionClosed` · `error`

## Regras de jogo críticas

**Tipos de casa** (`tileTypeBySquare`): `normal | question | prison` — mutuamente exclusivos. Casa 0 = início, casa N = chegada.

**Geração do tabuleiro** (ordem obrigatória):
1. Reservar casa 0 (início) e N (chegada)
2. Alocar prisões: N∈[20,24]→1 presídio; N∈[25,30]→2 presídios
3. Alocar casas-pergunta por densidade no pool restante (excluindo presídios)

**Densidade de casas-pergunta** (% das casas não-terminais menos presídios):
| Dificuldade | Densidade |
|---|---|
| Fácil | 40% |
| Normal | 60% |
| Difícil | 80% |

**Avanço no acerto** = `C_d + T_p` onde tiers são recalculados a cada turno:
- `leader` = mais à frente; `last` = mais atrás; `middle` = demais
- `T_p`: leader=0, middle=1, last=2

| | Fácil (C_d=3) | Normal (C_d=2) | Difícil (C_d=1) |
|---|---|---|---|
| leader | 3 | 2 | 1 |
| middle | 4 | 3 | 2 |
| last | 5 | 4 | 3 |

**Recuo no erro:**
| Tipo | Fácil | Normal | Difícil |
|---|---|---|---|
| Proximal | 1 | 2 | 3 |
| Total | 2 | 3 | 4 |

**Nudge anti-encadeamento:** se casa-alvo de um avanço for `question` ou `prison`, com P=0.7 desloca para a casa não-especial mais próxima em ±1 (preferir +1).

**Clamp:** recuo nunca abaixo da casa 1; avanço ≥ N → vitória imediata.

**Disparo de pergunta:** só ao aterrissar via dado OU via avanço de acerto. Recuos NÃO disparam (RF-08). Avanços em `prison` NÃO prendem (RF-19).

**Presídio (RF-17–RF-20):** dispara apenas via rolagem de dado. Efeito: `skipTurns += 1`. No turno, se `skipTurns > 0`: decrementa, emite `turnSkipped{playerId, remaining}`, passa a vez.

## Sprints (estado atual)

- **Sprint 1:** Setup, Gateway + Redis, lobby, rolagem de ordem, movimento simples, chega-ou-passa.
- **Sprint 2:** Reconexão (5 min grace), tabuleiro procedural 20–30, casas de presídio, banco de perguntas JSON, fluxo de pergunta.
- **Sprint 3:** Tabela de dificuldade + tiers + nudge, tabuleiro SVG responsivo, telas de pergunta.
- **Sprint 4:** Conteúdo (10 matérias), testes unitários e e2e, hardening (RF-16), deploy VPS.

## Convenções

- Código e identificadores em **inglês**; comentários e documentação em **PT-BR**.
- Commits no estilo Conventional Commits (`feat:`, `fix:`, `test:`, etc.).
- Testes obrigatórios para: lógica de movimento, cálculo de tiers, nudge, vitória, clamp, turno de presídio, reconexão.
