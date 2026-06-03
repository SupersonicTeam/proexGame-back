
# SPEC — Jogo Educativo de Tabuleiro (Web)

> **Fase:** Specify + Design + Tasks (SDD). Pronta para feedar no pipeline (worktrees → sub-agents → review).
> **Prazo:** 1 mês (4 sprints). **Uso real:** evento único, 1 dia, poucos alunos (≤ ~5 sessões de 4 = ~20 usuários no pico).
> **Premissa:** Murillo como dev principal. Se houver delegação, o renderizador do tabuleiro é a peça mais isolável.
> Código/identificadores em inglês; documentação em PT-BR.

## 1. Objetivo e escopo

Jogo de tabuleiro educativo multiplayer (até 4 jogadores, mobile + desktop), turnos alternados, competitivo. Vence quem chega/ultrapassa a casa final. Perguntas de 10 matérias movem o jogador para frente (acerto) ou para trás (erro). Faixa: 13–17 anos.

**Dentro do escopo (MVP obrigatório):** sessão por código, lobby, loop de turno real-time, dado justo, tabuleiro variável procedural, banco de perguntas curado, pontuação com catch-up em tiers, reconexão com grace period, deploy na VPS sob domínio.

**Fora do escopo:** contas/login (só nome), persistência além da sessão, painel de professor, analytics, escala/multi-instância, dado adaptativo oculto (substituído por catch-up visível).

## 2. Requisitos funcionais (rastreáveis)

- **RF-01** Jogador cria sessão → recebe código `#NNNNN` (5 dígitos, único entre sessões ativas) e informa nome.
- **RF-02** Jogador entra em sessão existente via código + nome. Máx. 4 jogadores. Mín. 2 para iniciar.
- **RF-03** Host inicia a partida a partir do lobby.
- **RF-04** Ao iniciar, todos rolam d6 para definir ordem; maior valor começa; empate → rola de novo só entre empatados.
- **RF-05** No turno, jogador rola d6 e anda esse número de casas.
- **RF-06** Tabuleiro tem tamanho aleatório por partida em [20, 30] casas. Casa 0 = INÍCIO (posição inicial dos tokens), casa N = CHEGADA.
- **RF-07** Subconjunto das casas são casas-pergunta, marcadas na geração; densidade depende da dificuldade.
- **RF-08** Ao **cair** numa casa-pergunta (via dado ou via avanço de acerto), dispara pergunta. Retorno por erro NÃO dispara pergunta (evita loop punitivo).
- **RF-09** Pergunta tem 4 alternativas embaralhadas: 1 correta, 1 proximal, 2 erradas. Selecionada do banco, da matéria da casa, sem repetir na sessão; dois jogadores na mesma casa recebem perguntas diferentes.
- **RF-10** Acerto → avança (tabela §4). Erro proximal → recua pouco. Erro total → recua mais. Recuo nunca abaixo da casa 1 (clamp).
- **RF-11** Encadeamento permitido: se o avanço de um acerto cair em casa-pergunta, dispara de novo. O cálculo de avanço aplica nudge anti-encadeamento (§4) que reduz, mas não zera, essa chance.
- **RF-12** Vitória: chega-ou-passa. Primeiro jogador a alcançar/ultrapassar a casa N vence; partida encerra imediatamente; ranking final pelos demais por posição.
- **RF-13** Três dificuldades (Fácil/Normal/Difícil) alteram densidade de perguntas e valores de avanço/recuo (§4).
- **RF-14** Sessão sobrevive a refresh/queda por grace period (5 min); reconexão restaura o jogador no estado atual.
- **RF-15** Quando não há jogadores ativos por 5 min → sessão é apagada do Redis.
- **RF-16** Autoridade total do servidor: rolagens, seleção de pergunta, validação de resposta e cálculo de movimento no backend. A alternativa correta NUNCA é enviada ao client antes da submissão.

## 3. Regras de jogo (resolvidas)

- **Tiers de posição** (recalculados no início de cada turno, por casa atual): `leader` = jogador mais à frente (empate → todos leaders); `last` = mais atrás (empate → todos last); demais = `middle`. Em partida de 2, só leader/last.
- **Dado:** d6 justo, RNG no servidor. Sem manipulação.
- **Disparo de pergunta:** só ao aterrissar via dado ou via avanço de acerto. Recuos não disparam.
- **Vitória:** chega-ou-passa (sem exigência de valor exato).

## 4. Tabela de balanceamento (valores iniciais — tunáveis em playtest)

**Densidade de casas-pergunta** (% das casas não-terminais):
| Dificuldade | Densidade |
|---|---|
| Fácil | 40% |
| Normal | 60% |
| Difícil | 80% |

**Avanço no acerto** = `C_d + T_p`:
| | Fácil (C_d=3) | Normal (C_d=2) | Difícil (C_d=1) |
|---|---|---|---|
| leader (T_p=0) | 3 | 2 | 1 |
| middle (T_p=1) | 4 | 3 | 2 |
| last (T_p=2) | 5 | 4 | 3 |

**Recuo no erro** (sem ajuste de posição, para manter testável):
| Tipo de erro | Fácil | Normal | Difícil |
|---|---|---|---|
| Proximal | 1 | 2 | 3 |
| Totalmente errada | 2 | 3 | 4 |

**Ordem de cálculo do movimento de acerto:** (1) `advance = C_d + T_p`; (2) se a casa-alvo for casa-pergunta, com probabilidade **P = 0.7** desloca para a casa não-pergunta mais próxima dentro de ±1 (preferir +1 para não reduzir recompensa; se inviável, −1); (3) clamp aos limites (≥1; se ≥N → vitória).

## 5. Arquitetura

- **Backend:** NestJS + `@nestjs/websockets` com Socket.IO gateway. Toda lógica autoritativa no servidor.
- **Estado de sessão:** Redis single-node (ioredis), chave por sessão, com `lastActivityAt`. Grace/TTL controlado por timer + expiração. Justificativa: seguro contra crash do processo no meio do evento; NÃO é escolha de escala.
- **Banco de perguntas:** arquivos JSON versionados no repo (um por matéria), carregados em memória no boot. Sem Postgres.
- **Frontend:** React (Vite). Renderizador de tabuleiro em SVG com posicionamento procedural dos nós para N variável; responsivo mobile-portrait + desktop. Estado via React state + eventos de socket.
- **Deploy:** VPS Ubuntu 24.04, Nginx (reverse proxy + TLS, wss), processo Node via pm2 ou Docker, Redis via Docker. Domínio próprio.
- **Sem auth.** Identidade = nome digitado + playerId gerado.

## 6. Modelo de dados

**Question (JSON):**
```
{ "id": "mat-0001", "subject": "matematica", "statement": "...",
  "correct": "...", "proximal": "...", "wrong": ["...", "..."] }
```
Opções embaralhadas no momento de servir; `correct` nunca enviado antes da resposta.

**SessionState (Redis):**
```
{ code, status: lobby|playing|finished, difficulty,
  board: { size: N, questionSquares: number[], subjectBySquare: {square: subject} },
  players: [ { id, name, socketId, square, connected, usedQuestionIds: string[] } ],
  turnOrder: playerId[], currentTurnIndex, winner, createdAt, lastActivityAt }
```

## 7. Contrato de eventos WebSocket (alto nível)

**client→server:** `createSession{name,difficulty}` · `joinSession{code,name}` · `startGame` · `rollForOrder` · `rollDice` · `submitAnswer{questionId,optionIndex}` · `leaveSession` · `reconnect{code,playerId}`

**server→client:** `sessionCreated{code,playerId}` · `playerJoined` · `lobbyState` · `gameStarted{board}` · `orderResult` · `turnChanged{playerId}` · `diceResult{value,fromSquare,toSquare}` · `questionPrompt{questionId,statement,options}` · `answerResult{correct,errorType,movement,toSquare}` · `gameOver{winner,ranking}` · `playerDisconnected` · `playerReconnected` · `sessionClosed` · `error`

## 8. Plano de sprints (4 semanas)

### Sprint 1 — Núcleo jogável (fatia vertical, sem perguntas) — RISCO PRINCIPAL
- [ ] Setup repo (NestJS + React Vite), lint, conventional commits, CI básico.
- [ ] Gateway Socket.IO + Redis single-node conectado.
- [ ] `createSession`/`joinSession`/lobby/`startGame` com estado em Redis.
- [ ] Rolagem de ordem (RF-04) e máquina de turnos (RF-05).
- [ ] Movimento simples no tabuleiro (sem casas-pergunta) + chega-ou-passa (RF-12).
- [ ] React: telas criar/entrar/lobby + tabuleiro estático simples + sync de turno.
- **Critério de aceite:** 2 jogadores em máquinas diferentes completam uma partida só com dado, turnos sincronizados.

### Sprint 2 — Sessão robusta + perguntas
- [ ] Reconexão com grace period 5 min (RF-14) + delete por inatividade (RF-15).
- [ ] Geração procedural de tabuleiro variável 20–30 + marcação de casas-pergunta por densidade (RF-06, RF-07).
- [ ] Schema JSON do banco + loader em memória; seleção sem repetição por sessão; perguntas distintas na mesma casa (RF-09).
- [ ] Disparo de pergunta ao aterrissar (RF-08) + fluxo `questionPrompt`/`submitAnswer`/`answerResult`.

### Sprint 3 — Pontuação completa + tabuleiro final
- [ ] Tabela de dificuldade + tiers de catch-up + nudge anti-encadeamento + clamp (§4, RF-10, RF-11, RF-13).
- [ ] Regra de não-disparo em recuo; encadeamento em avanço.
- [ ] Tabuleiro sinuoso responsivo (SVG path, mobile portrait + desktop), visual vibrante teen.
- [ ] Telas de pergunta e de resultado de resposta.

### Sprint 4 — Conteúdo, hardening, deploy
- [ ] Conteúdo: dezenas de perguntas × 10 matérias (foco no distrator proximal).
- [ ] Testes: unit das regras de jogo (movimento, tiers, nudge, vitória, clamp); e2e do loop; reconexão.
- [ ] Hardening: autoridade do servidor, garantir que `correct` nunca vaza (RF-16).
- [ ] Deploy VPS (Nginx + wss + TLS, Redis, pm2/Docker).
- [ ] Playtest e calibração da tabela §4. Buffer.

## 9. Riscos
- **Reconexão WS** (correção é sutil) → endereçada cedo (Sprint 2), testada explicitamente.
- **Tabuleiro procedural responsivo no portrait** → Sprint 3, mas prototipar layout antes se sobrar tempo na Sprint 2.
- **Tempo de autoria do banco** → MVP exige só dezenas; centenas é pós-MVP.
- **Sem tempo de calibrar rubber-band** → catch-up em tiers fixos, não contínuo.
- **Ponto único de falha (1 processo na VPS)** → Redis como seguro + pm2 auto-restart.

## 10. Decisões fechadas
Ver `00-captura-inicial.md` (histórico completo das decisões e conflitos resolvidos).
