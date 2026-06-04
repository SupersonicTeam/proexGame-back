# Sprint 1 — Núcleo Jogável (Backend) Specification

> **Escopo:** Backend-only. Fatia vertical do loop de jogo **sem perguntas**.
> **Objetivo:** entregar um backend autoritativo e um contrato WebSocket estável
> que o frontend (desenvolvido em paralelo por outra pessoa) consiga consumir para
> a primeira apresentação (front + back integrados).
> **Fora desta spec:** qualquer tarefa visual/React/SVG, perguntas, reconexão completa,
> tabuleiro procedural variável, tiers/nudge, presídio, deploy.

## Problem Statement

O jogo precisa de um esqueleto jogável de ponta a ponta antes de qualquer mecânica
educativa. O risco principal do projeto está aqui: sincronizar estado real-time entre
2–4 clientes via WebSocket com toda a autoridade no servidor. Sem esse núcleo provado,
nenhuma regra de jogo posterior tem onde se apoiar. Esta sprint entrega o backend desse
núcleo e um contrato WS estável para a integração com o front.

## Goals

- [ ] Backend autoritativo onde 2–4 jogadores criam/entram numa sessão por código e completam uma partida usando **apenas o dado** (sem perguntas).
- [ ] Contrato WebSocket congelado e documentado para a Sprint 1, consumível pelo front sem retrabalho.
- [ ] Estado de sessão persistido em Redis, sobrevivendo a um restart do processo Node no meio da partida.
- [ ] Critério de aceite verificável por teste e2e: 2 clientes (`socket.io-client`) jogam uma partida completa com turnos sincronizados.

## Out of Scope

Explicitamente excluído para evitar scope creep. Cada item aponta o destino correto.

| Feature                                              | Razão / destino                                              |
| --------------------------------------------------- | ----------------------------------------------------------- |
| Qualquer UI / React / SVG / telas                   | Frontend em paralelo (outra pessoa). Nada visual aqui.      |
| Casas-pergunta, banco JSON, fluxo de pergunta       | Sprint 2 (RF-07, RF-08, RF-09)                              |
| Reconexão com grace period 5 min                    | Sprint 2 (RF-14, RF-15) — aqui só desconexão básica         |
| Tabuleiro procedural variável 20–30                 | Sprint 2 (RF-06) — Sprint 1 usa tamanho **fixo**, casas normais |
| Casas de presídio                                   | Sprint 2/3 (RF-17–RF-20)                                    |
| Tiers de catch-up, nudge anti-encadeamento, clamp avançado | Sprint 3 (§4, RF-10, RF-11, RF-13)                   |
| Tabela de dificuldade afetando movimento            | Sprint 3 (RF-13) — Sprint 1 usa avanço = valor do dado      |
| Nginx, TLS/wss, provisionamento da VPS, CI/CD remoto | Sprint 4 — Sprint 1 entrega só os artefatos Docker locais   |
| Banco de perguntas / conteúdo                        | Sprint 4                                                    |

> **Nota sobre Docker:** a Sprint 1 entrega os **artefatos de containerização** (Dockerfile do
> backend, `docker-compose.yml` com backend + Redis, `.dockerignore`, `.env.example`) para que a
> conexão à VPS seja trivial depois. O **deploy de fato** (Nginx como reverse proxy, TLS/wss,
> provisionamento do servidor) permanece na Sprint 4 — aqui só garantimos que `docker compose up`
> sobe backend + Redis localmente.

> **Nota sobre dificuldade:** `createSession{difficulty}` é aceito e persistido no estado
> (o contrato já o prevê), mas na Sprint 1 a dificuldade **não altera nenhum cálculo** —
> movimento é sempre `advance = valor do dado`. A semântica de dificuldade entra na Sprint 3.

---

## User Stories

### P1: Fundação — Gateway, Redis e estado de sessão ⭐ MVP

**User Story**: Como desenvolvedor do jogo, quero um gateway Socket.IO conectado a um Redis single-node com um repositório de estado de sessão, para que toda mecânica posterior tenha onde ler/gravar estado autoritativo.

**Why P1**: É a base de tudo. Sem gateway + persistência, nenhuma outra story existe.

**Acceptance Criteria**:

1. WHEN o servidor sobe THEN o sistema SHALL expor um gateway Socket.IO e estabelecer conexão com Redis via `ioredis`.
2. WHEN um `SessionState` é criado/alterado THEN o sistema SHALL persistir o estado serializado em Redis sob a chave da sessão.
3. WHEN o processo Node reinicia com uma partida em andamento THEN o sistema SHALL recuperar o `SessionState` do Redis ao receber o próximo evento daquela sessão (estado não se perde no restart).
4. WHEN qualquer escrita de estado ocorre THEN o sistema SHALL atualizar `lastActivityAt`.
5. WHEN um evento inválido/malformado chega THEN o sistema SHALL emitir `error` ao remetente e NÃO corromper o estado.

**Independent Test**: Subir o servidor, criar uma sessão, inspecionar a chave no Redis (`redis-cli`), reiniciar o processo e confirmar que um evento subsequente ainda enxerga a sessão.

---

### P1: Criar e entrar em sessão (lobby) ⭐ MVP

**User Story**: Como jogador, quero criar uma sessão e receber um código, ou entrar numa sessão existente pelo código, para que um grupo de 2–4 pessoas se reúna antes de jogar.

**Why P1**: Ponto de entrada do jogo; sem lobby não há partida.

**Cobre**: RF-01, RF-02, RF-03.

**Acceptance Criteria**:

1. WHEN um jogador envia `createSession{name,difficulty}` THEN o sistema SHALL gerar um código `#NNNNN` (5 dígitos, único entre sessões ativas), criar a sessão em `status=lobby`, registrar o jogador como **host**, e responder `sessionCreated{code,playerId}`.
2. WHEN um jogador envia `joinSession{code,name}` para uma sessão em `lobby` com < 4 jogadores THEN o sistema SHALL adicioná-lo e emitir `playerJoined` + `lobbyState` a todos da sala.
3. WHEN um jogador entra ou sai do lobby THEN o sistema SHALL emitir `lobbyState` com a lista atual de jogadores (id, name, connected, isHost).
4. WHEN `joinSession` referencia um código inexistente THEN o sistema SHALL responder `error` com motivo `SESSION_NOT_FOUND`.
5. WHEN `joinSession` chega numa sessão com 4 jogadores THEN o sistema SHALL responder `error` com motivo `SESSION_FULL`.
6. WHEN `joinSession` chega numa sessão com `status != lobby` THEN o sistema SHALL responder `error` com motivo `SESSION_ALREADY_STARTED`.
7. WHEN o nome enviado é vazio ou só espaços THEN o sistema SHALL responder `error` com motivo `INVALID_NAME`.

**Independent Test**: Dois clientes — um cria (recebe código), outro entra com o código; ambos recebem `lobbyState` com 2 jogadores.

---

### P1: Iniciar partida e definir ordem de turnos ⭐ MVP

**User Story**: Como host, quero iniciar a partida e ter a ordem dos jogadores definida por rolagem de dado, para que todos joguem numa sequência justa e acordada.

**Why P1**: Transição lobby→jogo e ordem são pré-requisito do loop de turnos.

**Cobre**: RF-03, RF-04, RF-12 (tabuleiro base).

**Acceptance Criteria**:

1. WHEN o **host** envia `startGame` com ≥ 2 jogadores THEN o sistema SHALL mudar `status` para `playing`, inicializar o tabuleiro (tamanho fixo, todas casas `normal`, casa 0 = início, casa N = chegada), posicionar todos os tokens na casa 0, e emitir `gameStarted{board}`.
2. WHEN `startGame` é enviado por quem **não é o host** THEN o sistema SHALL responder `error` com motivo `NOT_HOST`.
3. WHEN `startGame` é enviado com < 2 jogadores THEN o sistema SHALL responder `error` com motivo `NOT_ENOUGH_PLAYERS`.
4. WHEN a partida inicia THEN o sistema SHALL conduzir a rolagem de ordem: cada jogador rola d6 (RNG no servidor); o maior valor começa; o resultado é emitido em `orderResult`.
5. WHEN há empate no maior valor da rolagem de ordem THEN o sistema SHALL re-rolar **apenas** entre os empatados, repetindo até desempatar.
6. WHEN a ordem é resolvida THEN o sistema SHALL definir `turnOrder` e `currentTurnIndex=0` e emitir `turnChanged{playerId}` para o primeiro jogador.

**Independent Test**: Com 2 clientes no lobby, o host envia `startGame`; ambos recebem `gameStarted` e, ao fim, `orderResult` + `turnChanged` consistentes (mesmo `playerId` inicial nos dois clientes).

---

### P1: Loop de turno e movimento por dado ⭐ MVP

**User Story**: Como jogador, no meu turno quero rolar o dado e avançar esse número de casas, para que a partida progrida turno a turno de forma sincronizada entre todos.

**Why P1**: É o coração jogável da sprint.

**Cobre**: RF-05, RF-16.

**Acceptance Criteria**:

1. WHEN o jogador **da vez** envia `rollDice` THEN o sistema SHALL gerar um d6 justo no servidor, calcular `toSquare = fromSquare + valor` e emitir `diceResult{value,fromSquare,toSquare}` a todos.
2. WHEN `rollDice` é enviado por um jogador que **não é o da vez** THEN o sistema SHALL responder `error` com motivo `NOT_YOUR_TURN` e NÃO alterar estado.
3. WHEN o movimento resolve sem vitória THEN o sistema SHALL avançar `currentTurnIndex` para o próximo jogador (pulando desconectados, ver P2) e emitir `turnChanged{playerId}`.
4. WHEN `rollDice` chega numa sessão com `status != playing` THEN o sistema SHALL responder `error` com motivo `GAME_NOT_ACTIVE`.
5. WHEN qualquer rolagem ocorre THEN o RNG SHALL residir exclusivamente no servidor; nenhum valor de dado é aceito do client (RF-16).

**Independent Test**: Dois clientes alternam `rollDice`; cada `diceResult` move o token no estado e o `turnChanged` sempre aponta para o outro jogador. Tentar `rollDice` fora da vez retorna `NOT_YOUR_TURN`.

---

### P1: Vitória chega-ou-passa e fim de partida ⭐ MVP

**User Story**: Como jogador, quero que quem alcançar ou ultrapassar a casa final vença imediatamente, para que a partida tenha um término claro com ranking.

**Why P1**: Fecha a fatia vertical; sem condição de fim a partida não "completa".

**Cobre**: RF-12.

**Acceptance Criteria**:

1. WHEN um movimento resulta em `toSquare >= N` THEN o sistema SHALL declarar esse jogador vencedor, mudar `status` para `finished` e emitir `gameOver{winner,ranking}` — sem exigir valor exato (chega-ou-passa).
2. WHEN a partida termina THEN o `ranking` SHALL ordenar os demais jogadores pela casa atual (maior `square` primeiro).
3. WHEN a partida está `finished` THEN o sistema SHALL rejeitar `rollDice` subsequentes com `error` motivo `GAME_NOT_ACTIVE`.

**Independent Test**: Forçar (em teste) um jogador próximo de N; uma rolagem que ultrapassa N emite `gameOver` com esse jogador como `winner` e os demais ranqueados por posição.

---

### P2: Desconexão básica e saída de sessão

**User Story**: Como jogador, se eu cair ou sair, quero que a partida não trave para os demais, para que o jogo continue.

**Why P2**: Robustez mínima para a demo não congelar. **Reconexão com grace period é Sprint 2** — aqui apenas marcação e skip.

**Cobre**: parte de RF-14 (apenas detecção; restauração fica na Sprint 2).

**Acceptance Criteria**:

1. WHEN um socket desconecta THEN o sistema SHALL marcar o jogador como `connected=false` e emitir `playerDisconnected{playerId}` à sala.
2. WHEN é a vez de um jogador `connected=false` THEN o sistema SHALL pular sua vez e emitir `turnChanged` para o próximo conectado (evita partida travada).
3. WHEN um jogador envia `leaveSession` THEN o sistema SHALL removê-lo/marcá-lo e atualizar a sala (`lobbyState` se em lobby).
4. WHEN todos os jogadores estão desconectados THEN o sistema SHALL deixar a sessão expirar por inatividade (TTL — detalhamento completo na Sprint 2).

**Independent Test**: Com 2 clientes jogando, desconectar um; o outro recebe `playerDisconnected` e o turno não fica preso no jogador ausente.

---

### P2: Containerização Docker (backend + Redis)

**User Story**: Como dev de deploy, quero o backend e o Redis containerizados com Docker, para que a conexão à VPS na Sprint 4 seja só `docker compose up` sem reconfigurar ambiente.

**Why P2**: Não é mecânica de jogo, mas prepara o terreno do deploy cedo e evita "funciona na minha máquina". O deploy completo (Nginx/TLS) fica na Sprint 4.

**Cobre**: preparação de infra para RF (deploy) — sem provisionamento de VPS.

**Acceptance Criteria**:

1. WHEN um `Dockerfile` multi-stage do backend é construído THEN o sistema SHALL produzir uma imagem que roda o build de produção do NestJS (`node dist/main`).
2. WHEN `docker compose up` é executado THEN o sistema SHALL subir dois serviços — `backend` e `redis` — com o backend conectando ao Redis pelo hostname do serviço (`redis:6379`).
3. WHEN a configuração de conexão é lida THEN o sistema SHALL obter host/porta do Redis de variáveis de ambiente (`REDIS_HOST`, `REDIS_PORT`), com defaults para dev local, documentadas em `.env.example`.
4. WHEN a imagem é construída THEN o `.dockerignore` SHALL excluir `node_modules`, `.git`, `dist` e arquivos de ambiente, mantendo a imagem enxuta.
5. WHEN o container do backend sobe THEN ele SHALL expor a porta do gateway e responder a conexões Socket.IO de fora do container.

**Independent Test**: `docker compose up --build` sobe backend + redis; um cliente `socket.io-client` externo conecta e cria uma sessão com sucesso.

---

### P2: Contrato WebSocket congelado e documentado

**User Story**: Como desenvolvedor do frontend, quero o contrato WS da Sprint 1 documentado e estável, para que eu integre o cliente sem adivinhar payloads nem sofrer breaking changes.

**Why P2**: Habilita o trabalho paralelo do front e a apresentação integrada. Não é código de feature, mas é entregável da sprint.

**Acceptance Criteria**:

1. WHEN a Sprint 1 fecha THEN o sistema SHALL ter um documento de contrato listando, para cada evento da Sprint 1, payload de entrada e saída e os motivos de `error`.
2. WHEN o front consome um evento listado THEN o formato em runtime SHALL bater com o documentado (validável por teste e2e).

**Independent Test**: Um teste e2e exercita cada evento da Sprint 1 e valida o shape do payload contra o contrato.

---

## Edge Cases

- WHEN dois `createSession` geram colisão de código THEN o sistema SHALL re-gerar até obter código único entre sessões ativas.
- WHEN o mesmo nome entra duas vezes na mesma sessão THEN o sistema SHALL permitir (identidade real é `playerId`), mas o `lobbyState` SHALL deixar os dois distinguíveis por id.
- WHEN `startGame` é chamado duas vezes THEN a segunda chamada SHALL retornar `error` (`SESSION_ALREADY_STARTED`) sem reiniciar a partida.
- WHEN `rollDice` chega antes de a ordem estar resolvida THEN o sistema SHALL responder `error` (`GAME_NOT_ACTIVE`).
- WHEN um evento chega para uma sessão inexistente/expirada THEN o sistema SHALL responder `error` (`SESSION_NOT_FOUND`).
- WHEN o avanço excede N por muitas casas (ex.: estava em N-1 e rolou 6) THEN o sistema SHALL tratar como vitória (chega-ou-passa), sem overflow de índice.
- WHEN um jogador tenta agir numa sessão da qual não faz parte THEN o sistema SHALL responder `error` (`NOT_IN_SESSION`).

---

## Requirement Traceability

IDs locais da Sprint 1 (`S1-*`), com o RF de origem da SPEC.mc.

| Requirement ID | RF origem | Story                                   | Phase | Status  |
| -------------- | --------- | --------------------------------------- | ----- | ------- |
| S1-01          | —         | Fundação: Gateway Socket.IO + Redis     | Tasks | Pending |
| S1-02          | —         | Fundação: persistência de SessionState  | Tasks | Pending |
| S1-03          | RF-01     | Criar sessão + código único             | Tasks | Pending |
| S1-04          | RF-02     | Entrar em sessão (máx 4 / mín 2)        | Tasks | Pending |
| S1-05          | RF-03     | Host inicia partida                     | Tasks | Pending |
| S1-06          | RF-04     | Rolagem de ordem + desempate            | Tasks | Pending |
| S1-07          | RF-05     | Rolar d6 e mover                        | Tasks | Pending |
| S1-08          | RF-12     | Vitória chega-ou-passa + ranking        | Tasks | Pending |
| S1-09          | RF-16     | Autoridade do servidor (RNG no back)    | Tasks | Pending |
| S1-10          | RF-14*    | Desconexão básica + skip de turno       | Tasks | Pending |
| S1-11          | —         | Contrato WS documentado                 | Tasks | Pending |
| S1-12          | —         | Containerização Docker (backend+Redis)  | Tasks | Pending |

\* Apenas detecção de desconexão; restauração com grace period é Sprint 2.

**Coverage:** 12 requisitos. Mapeamento para tasks ocorre na fase Tasks.

---

## Contrato WebSocket — Sprint 1 (escopo congelado)

Subconjunto do contrato global (CLAUDE.md) ativo nesta sprint. Eventos de pergunta,
reconexão e presídio **não** entram aqui.

**client → server**

| Evento          | Payload                       | Notas                          |
| --------------- | ----------------------------- | ------------------------------ |
| `createSession` | `{ name, difficulty }`        | `difficulty` persistida, sem efeito de cálculo na S1 |
| `joinSession`   | `{ code, name }`              |                                |
| `startGame`     | `{}`                          | Só host                        |
| `rollForOrder`  | `{}`                          | Se o fluxo de ordem exigir ação do jogador; pode ser automático |
| `rollDice`      | `{}`                          | Só jogador da vez              |
| `leaveSession`  | `{}`                          |                                |

**server → client**

| Evento               | Payload                                  |
| -------------------- | ---------------------------------------- |
| `sessionCreated`     | `{ code, playerId }`                     |
| `playerJoined`       | `{ player }`                             |
| `lobbyState`         | `{ code, players[], hostId, status }`    |
| `gameStarted`        | `{ board }`                              |
| `orderResult`        | `{ rolls[], turnOrder[] }`               |
| `turnChanged`        | `{ playerId }`                           |
| `diceResult`         | `{ playerId, value, fromSquare, toSquare }` |
| `gameOver`           | `{ winner, ranking[] }`                  |
| `playerDisconnected` | `{ playerId }`                           |
| `sessionClosed`      | `{ reason }`                             |
| `error`              | `{ code, message }`                      |

**Motivos de `error` (S1):** `SESSION_NOT_FOUND`, `SESSION_FULL`, `SESSION_ALREADY_STARTED`,
`INVALID_NAME`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `NOT_YOUR_TURN`, `GAME_NOT_ACTIVE`,
`NOT_IN_SESSION`.

---

## SessionState — recorte da Sprint 1

Campos efetivamente usados nesta sprint (demais campos do modelo global ficam `null`/default
e são preenchidos em sprints futuras).

```jsonc
{
  "code": "12345",
  "status": "lobby | playing | finished",
  "difficulty": "easy | normal | hard",   // persistida, sem efeito de cálculo na S1
  "board": {
    "size": 25,                            // FIXO na S1
    "tileTypeBySquare": { "0": "start" }   // todas as demais = normal; sem question/prison
  },
  "players": [
    { "id": "...", "name": "...", "socketId": "...", "square": 0, "connected": true, "isHost": false }
  ],
  "turnOrder": [],
  "currentTurnIndex": 0,
  "winner": null,
  "createdAt": "...",
  "lastActivityAt": "..."
}
```

> `usedQuestionIds` e `skipTurns` existem no modelo global mas **não são exercitados** na Sprint 1.

---

## Success Criteria

Como sabemos que a Sprint 1 está pronta:

- [ ] **Critério de aceite oficial:** 2 jogadores em conexões distintas completam uma partida só com dado, turnos sincronizados, com um vencedor por chega-ou-passa — verificado por teste e2e (`socket.io-client`).
- [ ] Toda rolagem (ordem e movimento) é gerada no servidor; nenhum valor de dado é aceito do client.
- [ ] `SessionState` persiste em Redis e sobrevive a um restart do processo no meio da partida.
- [ ] Contrato WS da Sprint 1 documentado e validado por e2e; front consegue integrar sem ajustes de payload.
- [ ] Testes unitários cobrindo: cálculo de movimento, vitória/clamp em N, resolução de ordem com empate, troca de turno pulando desconectado.
- [ ] Eventos inválidos (fora de turno, não-host, sessão inexistente, lobby cheio) retornam `error` com o motivo correto, sem corromper estado.
- [ ] Tabuleiro com tamanho fixo e todas as casas `normal` (sem casas especiais).

---

## Notas para as fases seguintes (Design / Tasks)

- **Design provável:** módulos `session` (lobby/estado), `game` (turnos/movimento/vitória), `gateway` (Socket.IO), `redis` (repositório de estado). Lógica de jogo em serviços puros e testáveis, isolada do gateway.
- **Pontos de extensão já previstos para não refatorar depois:** `board.size` fixo agora mas atrás de um gerador (Sprint 2 troca por procedural); cálculo de avanço isolado numa função `computeAdvance` (Sprint 3 injeta tiers/dificuldade); hook de "aterrissou na casa" isolado (Sprint 2 pluga disparo de pergunta).
- **Testes:** unit nas regras puras + e2e no loop via `socket.io-client`. Esses testes são o substituto do harness de demo enquanto o front não conecta — não são tarefa de frontend.
