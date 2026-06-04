# Sprint 2 — Sessão robusta + perguntas + balanceamento (Backend)

**Spec base:** `SPEC.mc` (RF-06..RF-20)
**Decisões:** `context.md`
**Escopo:** Backend-only. O frontend é desenvolvido em paralelo; a entrega é o
**contrato WS estendido (`CONTRACT-S2.md`)** + testes (unit das regras puras, e2e via
`socket.io-client`) como verificação enquanto o front não conecta.
**Status:** Specify

---

## 1. Objetivo

Sair do núcleo "só dado" da Sprint 1 para a partida educativa completa no servidor:
tabuleiro procedural com casas especiais, banco de perguntas, fluxo de pergunta com autoridade
total do servidor, balanceamento completo (tiers/nudge/recuo/clamp/encadeamento), casa de
presídio, e robustez de sessão (reconexão com grace period + expiração por inatividade).

Por decisão **D1**, a tabela de balanceamento (§4 da SPEC) é puxada para esta sprint.

---

## 2. Requisitos cobertos

Já entregues na S1: RF-01..RF-05, RF-12, RF-16 (parcial). Esta sprint cobre:

| RF | Descrição | Onde |
|----|-----------|------|
| RF-06 | Tabuleiro procedural [20,30]; 0=início, N=chegada | geração de tabuleiro |
| RF-07 | Casas-pergunta por densidade sobre `(não-terminais − presídios)` | geração de tabuleiro |
| RF-08 | Pergunta dispara só ao **cair** (dado ou avanço de acerto); recuo NÃO dispara | resolução de aterrissagem |
| RF-09 | 4 alternativas embaralhadas (1 correta, 1 proximal, 2 erradas); sem repetir na sessão (global, **D3**) | seleção de pergunta |
| RF-10 | Acerto avança; erro proximal recua pouco; erro total recua mais; clamp ≥1 | tabela de movimento |
| RF-11 | Encadeamento: avanço que cai em casa-pergunta dispara de novo; nudge reduz a chance | resolução de acerto |
| RF-13 | Dificuldade altera densidade e valores de avanço/recuo | tabela de movimento |
| RF-14 | Sessão sobrevive a refresh/queda por grace period (5 min); reconexão restaura | reconexão (**D2**) |
| RF-15 | Sem jogadores ativos por 5 min → sessão apagada do Redis | expiração (**D2**) |
| RF-16 | Autoridade total: `correct` NUNCA enviado antes da submissão | transversal (segurança) |
| RF-17 | Tipo de casa `prison`, mutuamente exclusivo com pergunta/início/fim | geração de tabuleiro |
| RF-18 | N∈[20,24]→1 presídio; N∈[25,30]→2 | geração de tabuleiro |
| RF-19 | Presídio dispara **só** via dado; avanço/recuo NÃO prendem | resolução de aterrissagem |
| RF-20 | Efeito: `skipTurns += 1`; no turno, se >0 decrementa, emite `turnSkipped`, passa a vez | turno de presídio |

---

## 3. Regras detalhadas (resolvidas)

### 3.1 Geração procedural do tabuleiro (ordem obrigatória — RF-06/07/17/18)

1. Sortear `N ∈ [20, 30]`.
2. Reservar casa `0` (`start`) e casa `N` (`finish`).
3. Alocar presídios no pool `[1, N-1]`: `N∈[20,24]→1`, `N∈[25,30]→2`. Casas distintas, aleatórias.
4. Alocar casas-pergunta por densidade sobre `(N-1) − qtdPresídios` casas (pool restante),
   arredondando para inteiro. Densidade: Fácil 40%, Normal 60%, Difícil 80%.
5. Atribuir uma `subject` (matéria) a cada casa-pergunta, sorteada entre as matérias disponíveis
   no banco. Demais casas do pool são `normal`.

`tileTypeBySquare`: `start | normal | question | prison | finish` (mutuamente exclusivos).
`subjectBySquare`: só para casas `question`.

### 3.2 Tiers de posição (RF-13 / SPEC §3 — recalculados no início de cada turno)

- `leader` = jogador(es) mais à frente (maior `square`); empate → todos leader.
- `last` = mais atrás (menor `square`); empate → todos last.
- demais = `middle`. Em partida de 2, só leader/last.

### 3.3 Movimento de acerto (RF-10/11/13 — tabela §4)

`advance = C_d + T_p`:

| | Fácil (C_d=3) | Normal (C_d=2) | Difícil (C_d=1) |
|---|---|---|---|
| leader (T_p=0) | 3 | 2 | 1 |
| middle (T_p=1) | 4 | 3 | 2 |
| last (T_p=2) | 5 | 4 | 3 |

**Ordem de cálculo:** (1) `target = square + advance`; (2) **nudge**: se `target` for
`question` ou `prison`, com `P=0.7` desloca para a casa não-especial mais próxima em `±1`
(preferir `+1`; se inviável, `−1`); (3) clamp: se `target ≥ N` → vitória; senão `target`.

**Encadeamento (RF-11):** se, após nudge+clamp, a casa final for `question`, dispara nova
pergunta (sem trocar de turno). O nudge reduz, mas não zera, essa chance.

### 3.4 Movimento de erro (RF-08/10 — recuo)

| Tipo | Fácil | Normal | Difícil |
|---|---|---|---|
| Proximal | 1 | 2 | 3 |
| Total | 2 | 3 | 4 |

`target = max(1, square − recuo)` (clamp inferior na casa 1). **Recuo NÃO dispara pergunta nem
presídio** (RF-08/19), mesmo caindo numa casa especial. Turno passa para o próximo.

### 3.5 Classificação da resposta

A pergunta servida tem 4 opções embaralhadas mapeadas internamente a `correct | proximal | wrong | wrong`.
- `optionIndex` aponta para `correct` → **acerto** (`errorType: 'none'`).
- aponta para `proximal` → **erro proximal** (`errorType: 'proximal'`).
- aponta para `wrong` → **erro total** (`errorType: 'wrong'`).

### 3.6 Aterrissagem (RF-08/19)

Ao mover via **dado**, classificar a casa de destino:
- `question` → dispara `questionPrompt` (não passa o turno; aguarda `submitAnswer`).
- `prison` → `skipTurns += 1`; passa o turno (RF-20).
- `normal`/`finish` → vitória ou troca de turno normal (como S1).

### 3.7 Turno de presídio (RF-20)

No início do turno do jogador, se `skipTurns > 0`: decrementa, emite
`turnSkipped{playerId, remaining}`, passa a vez **sem rolar**.

### 3.8 Reconexão e expiração (RF-14/15 — D2)

- Desconexão marca `connected=false` e arma timer de 5 min.
- `reconnect{code, playerId}` dentro da janela: revincula socket, `connected=true`, cancela timer,
  emite `playerReconnected` + estado atual; se era a vez dele e o turno foi passado, segue o turno corrente.
- Timer expira **ou** todos desconectados por 5 min → remove jogador/sessão; se a sessão esvazia,
  apaga do Redis e emite `sessionClosed` (RF-15).
- TTL deslizante na chave Redis como backstop a restart do processo.

---

## 4. Contrato WS — adições da Sprint 2

**client→server (novos):**
- `submitAnswer{questionId: string, optionIndex: number}`
- `reconnect{code: string, playerId: string}`

**server→client (novos):**
- `questionPrompt{questionId, statement, options: string[]}` — **sem `correct`** (RF-16)
- `answerResult{correct: boolean, errorType: 'none'|'proximal'|'wrong', movement: number, fromSquare, toSquare}`
- `turnSkipped{playerId, remaining}`
- `playerReconnected{playerId}`
- `sessionClosed{reason}` (passa a ser efetivamente emitido)

**Novos ErrorCode:** `NO_PENDING_QUESTION`, `INVALID_OPTION`, `QUESTION_MISMATCH`,
`RECONNECT_FAILED`, `NO_QUESTIONS_AVAILABLE`.

---

## 5. Modelo de dados — adições

```ts
type TileType = 'start' | 'normal' | 'question' | 'prison' | 'finish';
type Subject = string; // matéria (ex.: 'matematica')

interface Question {              // JSON em /questions/<subject>.json
  id: string; subject: Subject; statement: string;
  correct: string; proximal: string; wrong: [string, string];
}

// Estado autoritativo da pergunta servida — NUNCA serializado ao client por inteiro.
interface PendingQuestion {
  questionId: string; subject: Subject;
  options: string[];        // embaralhadas (4)
  correctIndex: number;     // segredo do servidor (RF-16)
  proximalIndex: number;    // segredo do servidor
}

interface Player {           // + campos da S2
  // ...S1: id, name, socketId, square, connected, isHost
  usedQuestionIds: string[]; // auditoria (checagem real é global — D3)
  skipTurns: number;         // RF-20
  pendingQuestion: PendingQuestion | null;
}

interface Board {
  size: number;                                // N ∈ [20,30]
  tileTypeBySquare: Record<number, TileType>;
  subjectBySquare: Record<number, Subject>;    // só casas 'question'
}

interface SessionState {     // + campo da S2
  // ...S1
  servedQuestionIds: string[]; // união global de perguntas servidas (D3 / RF-09)
}
```

---

## 6. Critérios de aceite

1. **Funcional:** e2e com 2 clientes joga uma partida completa que inclui ao menos uma
   `questionPrompt` → `submitAnswer` → `answerResult` e termina em `gameOver`.
2. **Presídio:** e2e/teste com RNG forçado: jogador cai em `prison` via dado, perde exatamente
   um turno (`turnSkipped{remaining}`), volta a jogar.
3. **Reconexão:** e2e: cliente desconecta, reconecta dentro de 5 min via `reconnect{code,playerId}`,
   recebe `playerReconnected` + estado; após expiração com sessão vazia, chave some do Redis.
4. **Segurança (RF-16) — bloqueante:** nenhum payload `questionPrompt` contém o texto `correct`,
   `correctIndex` nem `proximal`; teste afirma a ausência explicitamente. `submitAnswer` com
   `optionIndex` fora de `[0,3]`, sem pergunta pendente, ou `questionId` divergente é rejeitado
   com o `ErrorCode` correspondente, sem alterar estado.
5. **Balanceamento:** unit cobre a tabela §4 (avanço por tier×dificuldade, recuo proximal/total),
   nudge (com RNG determinístico nos dois ramos de P=0.7), encadeamento, clamp (≥1 e vitória).
6. **Gates:** `npm run build` ✅, `npm run lint` ✅, `npm run test` ✅, `npm run test:e2e` ✅.

---

## 7. Fora do escopo (S2)

- Frontend (SVG, telas de pergunta) — Sprint 3.
- Conteúdo final do banco (dezenas × 10 matérias) — Sprint 4. Na S2, fixtures mínimas por matéria
  suficientes para os testes e para não esgotar o banco numa partida.
- Multi-instância / escala. Timers são in-process (single-node, por D2).
