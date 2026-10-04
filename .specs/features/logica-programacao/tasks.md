# Logica de Programacao — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/logica-programacao/design.md`
**Status**: Done

Repos: **BACK** = `D:\Trilha do Saber\back\proexGame-back` · **FRONT** = `D:\Trilha do Saber\Front\proexGame-front`.
Branch de trabalho em cada repo: `feat/logica-programacao` (a partir de `main`). Commits Conventional, um por task, no repo da task.

**Pré-requisito (não é task, sem commit):** `npm ci` em BACK e em FRONT (nenhum dos dois tem `node_modules`).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `back/CLAUDE.md` (testes obrigatórios p/ regras de jogo; Conventional Commits), `back/.github/workflows/ci.yml` (lint + build + unit + e2e), `front/.github/workflows/ci.yml` (lint + test:run + build), `front/README.md` (Vitest + Testing Library).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| BACK loader/validação (`question-bank.service`) | unit | Todos os ramos novos: cada limite de `code` (vazio, `\t`, 16 linhas, 45 chars, `\r\n` normalizado, ausente = válido) + alternativas repetidas | `src/**/*.spec.ts` | `npm test` |
| BACK regras puras (`question.rules`) | unit | `code` copiado p/ Pending; prompt inclui `code` só quando existe; prompt nunca contém `correctIndex`/`proximalIndex`; rng consome os mesmos 3 valores | `src/**/*.spec.ts` | `npm test` |
| BACK conteúdo (`questions/*.json`) | unit (content spec sobre o banco real) | ≥ 12/nível, prefixo, ids únicos, boot válido; ao final, conjunto exato das 8 | `src/questions/question-bank.content.spec.ts` | `npm test` |
| BACK fluxo WS | e2e (existente) | Regressão: suítes atuais verdes com o banco novo | `test/e2e/*.e2e-spec.ts` | `npm run test:e2e` |
| FRONT client socket | unit | `code` repassado quando presente; ausente quando não vem | `src/**/*.test.ts` | `npm run test:run` |
| FRONT theme | unit | 8 slugs com meta explícita (não fallback), label ≤ 6; slug desconhecido → fallback | `src/**/*.test.ts` | `npm run test:run` |
| FRONT `QuestionModal` | component (Testing Library) | Com `code`: `<pre>` com texto exato (quebras/espaços preservados), classe de rolagem; sem `code`: nenhum `<pre>` | `src/**/*.test.tsx` | `npm run test:run` |
| FRONT demo bank / engine | unit | 8 categorias, ≥ 3 cada; testes acoplados atualizados | `src/**/*.test.ts(x)` | `npm run test:run` |
| Docs / JSON de texto / Home / cenário | none | build gate | — | build gate |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --- | --- | --- | --- |
| BACK unit | Yes | Fixtures em dir temporário via `QUESTIONS_DIR` por suíte; jest isola processos por arquivo | `src/questions/question-bank.service.spec.ts:148-159` |
| BACK e2e | No | Banco real compartilhado em `<cwd>/questions`; app Nest + Redis por suíte | `test/e2e/*`, `test/jest-e2e.json` |
| FRONT unit/component | Yes | jsdom por arquivo, sem estado global compartilhado | `vite.config.ts` (Vitest) |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick (BACK) | Tasks só com unit | `npm test` |
| Full (BACK) | Tasks de conteúdo / arquivamento (afetam e2e) | `npm test && npm run test:e2e` |
| Build (BACK) | Fim de fase | `npm run lint && npm run build && npm test && npm run test:e2e` |
| Quick (FRONT) | Tasks com unit/component | `npm run test:run` |
| Build (FRONT) | Fim de fase / tasks sem teste | `npm run lint && npm run typecheck && npm run test:run && npm run build` |

---

## Execution Plan

```
Fase 1 (BACK núcleo)     T1 ─► T2 ─► T3
Fase 2 (BACK conteúdo)          T3 ─► [T4 T5 T6 T7 T8 T9 T10 T11]  (P)
Fase 3 (BACK fechamento)        T4..T11 ─► T12 ─► T13
Fase 4 (FRONT núcleo)    T14 ─► T15 [P] , T14 ─► T16
Fase 5 (FRONT conteúdo)  T14,T15,T4..T11 ─► T17 ─► T18 ─► T19 ─► T20 (P3)
```

Fase 4 independe das Fases 2–3 (só precisa do contrato do design); T17 precisa do conteúdo do back (copia perguntas).

---

## Tasks

### Fase 1 — BACK núcleo

**T1 ✅ — Validação de `code` e alternativas distintas no loader** · BACK · PROG-05, PROG-06, PROG-04
- What: `Question.code?`; em `validateFile`: normalizar `\r\n`; validar `code` (string, não-vazio, sem `\t`, ≤ 15 linhas, ≤ 44 chars/linha); validar 4 alternativas distintas (após `trim`). Exportar `CODE_MAX_LINES`/`CODE_MAX_LINE_LENGTH`.
- Where: `src/questions/question.types.ts`, `src/questions/question-bank.service.ts`
- Depends on: —
- Tests: unit em `question-bank.service.spec.ts` (fixtures temporárias) — um caso por limite + ausente válido + `\r\n` normalizado + repetida.
- Done when: casos novos e antigos verdes; quick gate BACK passa.
- Commit: `feat(questions): campo opcional code com limites e alternativas distintas`

**T2 ✅ — `code` em `PendingQuestion` e `questionPrompt`** · BACK · PROG-07, PROG-08
- What: copiar `code` em `buildPendingQuestion` (só se definido); `QuestionPromptView.code?`; `toQuestionPrompt` inclui a chave só quando existe.
- Where: `src/questions/question.types.ts`, `src/game/question.rules.ts`
- Depends on: T1
- Tests: unit em `question.rules.spec.ts` — com/sem `code`; `Object.keys` do prompt sem `code` quando ausente; serialização sem `correctIndex`/`proximalIndex`; mesmos índices para o mesmo rng roteirizado.
- Done when: quick gate BACK passa.
- Commit: `feat(questions): propaga code ate o questionPrompt (RF-16 intacto)`

**T3 ✅ — Content spec do banco real** · BACK · PROG-02, PROG-03
- What: novo `question-bank.content.spec.ts` que carrega `<cwd>/questions` via serviço e, para cada subject presente no mapa `CATEGORY_PREFIX` (8 categorias novas), checa ≥ 12 por nível, prefixo do id e unicidade global. Subjects fora do mapa (antigos) são ignorados até T12.
- Where: `src/questions/question-bank.content.spec.ts`
- Depends on: T1
- Tests: é o próprio teste (passa vacuamente enquanto nenhuma categoria nova existe; cada task de conteúdo passa a exercitá-lo).
- Done when: quick gate BACK passa.
- Commit: `test(questions): content spec para as categorias de logica de programacao`

### Fase 2 — BACK conteúdo (cada task: 1 arquivo, ≥ 12 easy / 12 normal / 12 hard, ids `<prefixo>-0001..`)

Regras comuns: dialeto Portugol/VisuAlg ASCII; `code` quando houver algoritmo; cada "qual a saída?" rastreado à mão pelo autor; `proximal` = erro clássico do iniciante; níveis segundo o critério da spec; linguagem acessível a 14+.
Tests (todas): content spec (T3) cobre o arquivo + boot do loader. Gate: **Full BACK** (e2e usam o banco real). `[P]` entre si (arquivos distintos; e2e sequencial no gate).

| Task | Arquivo | Prefixo | Commit |
| --- | --- | --- | --- |
| T4 [P] ✅ | `questions/algoritmos.json` | `alg` | `feat(questions): categoria algoritmos (36)` |
| T5 [P] ✅ | `questions/variaveis-e-tipos.json` | `var` | `feat(questions): categoria variaveis-e-tipos (36)` |
| T6 [P] ✅ | `questions/condicionais.json` | `cond` | `feat(questions): categoria condicionais (36)` |
| T7 [P] ✅ | `questions/operadores-logicos.json` | `oplog` | `feat(questions): categoria operadores-logicos (36)` |
| T8 [P] ✅ | `questions/lacos-de-repeticao.json` | `laco` | `feat(questions): categoria lacos-de-repeticao (36)` |
| T9 [P] ✅ | `questions/vetores.json` | `vet` | `feat(questions): categoria vetores (36)` |
| T10 [P] ✅ | `questions/funcoes.json` | `func` | `feat(questions): categoria funcoes (36)` |
| T11 [P] ✅ | `questions/busca-e-ordenacao.json` | `bus` | `feat(questions): categoria busca-e-ordenacao (36)` |

Depends on: T1, T3. Requirement: PROG-02, PROG-03 (+PROG-04/05 via boot).

### Fase 3 — BACK fechamento

**T12 ✅ — Arquivar matérias antigas + conjunto exato** · BACK · PROG-01
- What: `git mv` dos 8 JSON antigos para `questions/_arquivo/`; content spec ganha asserção `subjects()` = exatamente as 8 categorias; teste de que arquivo em subdiretório não é carregado.
- Depends on: T4–T11
- Tests: content spec + unit do loader (subdir ignorado). Gate: **Full BACK**.
- Commit: `feat(questions)!: substitui materias escolares por logica de programacao`

**T13 ✅ — Docs do back + AD-001** · BACK · PROG-13
- What: `questions/README.md` (categorias, prefixos, `code`, dialeto, níveis, público); `CONTRACT.md` (`questionPrompt.code?`); `CLAUDE.md` (modelo `code?`, público, "8 categorias"); `README.md`; `.specs/project/STATE.md` AD-001 + status da feature; commit dos arquivos da spec.
- Depends on: T12
- Tests: none. Gate: **Build BACK**.
- Commit: `docs: conteudo de logica de programacao e campo code`

### Fase 4 — FRONT núcleo

**T14 ✅ — Tipos + mapeamento do socket** · FRONT · PROG-07, PROG-10 (parcial)
- What: `Question.code?`, `QuestionPromptEvent.code?`, `RawQuestionPrompt.code?`; `BACKEND_SUBJECTS` = 8 slugs novos; `SocketGameClient` repassa `code`.
- Where: `src/game/types.ts`, `src/game/client/SocketGameClient.ts`
- Depends on: — (contrato do design)
- Tests: unit — prompt com `code` chega com `code`; sem `code`, chave ausente (seguir o padrão de mock de socket de `SocketGameClient.reconnect.test.ts`).
- Done when: quick gate FRONT passa.
- Commit: `feat(client): recebe code do questionPrompt e novas categorias`

**T15 ✅ [P] — `SUBJECT_META` das 8 categorias** · FRONT · PROG-10
- What: entradas da tabela do design; remove antigas e legadas.
- Where: `src/features/board/theme.ts`
- Depends on: T14
- Tests: novo `theme.test.ts` — cada slug de `BACKEND_SUBJECTS` tem nome ≠ `titleFromSlug`, label ≤ 6; slug desconhecido → fallback.
- Done when: quick gate FRONT passa.
- Commit: `feat(board): nomes, icones e cores das categorias de logica`

**T16 ✅ — `CodeBlock` no `QuestionModal`** · FRONT · PROG-09
- What: bloco `<pre><code>` monoespaçado com rolagem horizontal entre enunciado e alternativas.
- Where: `src/features/play/QuestionModal.tsx`
- Depends on: T14
- Tests: novo `QuestionModal.test.tsx` — texto exato preservado, classes `whitespace-pre`/`overflow-x-auto`; sem `code` → sem `<pre>`.
- Done when: quick gate FRONT passa.
- Commit: `feat(play): exibe pseudocodigo no modal de pergunta`

### Fase 5 — FRONT conteúdo e textos

**T17 ✅ — Banco da demo** · FRONT · PROG-11
- What: 8 JSON (≥ 3 cada, copiados do back com `code`); remove os 10 legados; `index.ts`; `engine/board.ts` `SUBJECTS`; `MockGameClient` envia `code`; atualizar `board.test.ts`, `questionPool.test.ts`, `PlayScreen.test.tsx`.
- Depends on: T14, T15, T4–T11
- Tests: unit — demo serve só as 8 categorias e propaga `code`. Gate: quick FRONT.
- Commit: `feat(demo): banco de demonstracao com logica de programacao`

**T18 ✅ — Subtítulo da Home** · FRONT · PROG-12
- What: "Treine lógica de programação — pense, resolva e avance!"
- Depends on: T17 · Tests: none · Gate: Build FRONT
- Commit: `feat(lobby): subtitulo para o novo publico`

**T19 ✅ — Docs do front** · FRONT · PROG-13
- What: `README.md` (público, conteúdo), `CONTRACT.md` (+ `Contratos/CONTRACT.md`) com `code?`.
- Depends on: T18 · Tests: none · Gate: Build FRONT
- Commit: `docs: logica de programacao e campo code`

**T20 ✅ (P3) — Cenário temático** · FRONT · PROG-14
- What: props de `BoardScenery` → `{ }`, `</>`, chip, terminal.
- Depends on: T19 · Tests: none · Gate: Build FRONT
- Commit: `feat(board): cenario com tema de programacao`

---

## Validation (pre-approval)

### Check 1 — Granularity

| Task | Deliverable único? | ✅/❌ |
| --- | --- | --- |
| T1 | validação no loader (1 função + tipo) | ✅ |
| T2 | propagação em question.rules | ✅ |
| T3 | 1 arquivo de teste | ✅ |
| T4–T11 | 1 arquivo JSON cada | ✅ |
| T12 | arquivamento + asserção | ✅ |
| T13 | docs back | ✅ |
| T14 | tipos + 1 mapeamento (mesmo contrato) | ✅ |
| T15 | theme.ts | ✅ |
| T16 | QuestionModal | ✅ |
| T17 | banco da demo (conjunto acoplado; separar quebraria o build) | ✅ |
| T18–T20 | 1 arquivo/área cada | ✅ |

### Check 2 — Diagram × Depends on

| Task | Depends on (definição) | No diagrama | ✅/❌ |
| --- | --- | --- | --- |
| T1 | — | início Fase 1 | ✅ |
| T2 | T1 | T1 ─► T2 | ✅ |
| T3 | T1 | após T1 (T2 ─► T3 é só ordem sugerida) | ✅ |
| T4–T11 | T1, T3 | T3 ─► [T4..T11] | ✅ |
| T12 | T4–T11 | T4..T11 ─► T12 | ✅ |
| T13 | T12 | T12 ─► T13 | ✅ |
| T14 | — | início Fase 4 | ✅ |
| T15 | T14 | T14 ─► T15 | ✅ |
| T16 | T14 | T14 ─► T16 | ✅ |
| T17 | T14, T15, T4–T11 | T14,T15,T4..T11 ─► T17 | ✅ |
| T18 | T17 | T17 ─► T18 | ✅ |
| T19 | T18 | T18 ─► T19 | ✅ |
| T20 | T19 | T19 ─► T20 | ✅ |

### Check 3 — Test co-location

| Task | Camada | Matriz exige | Task tem | ✅/❌ |
| --- | --- | --- | --- | --- |
| T1 | loader | unit | unit | ✅ |
| T2 | regras puras | unit | unit | ✅ |
| T3 | conteúdo | unit | unit | ✅ |
| T4–T11 | conteúdo | unit (content spec) + e2e regressão | content spec + Full gate | ✅ |
| T12 | conteúdo/loader | unit + e2e regressão | unit + Full gate | ✅ |
| T13 | docs | none | build gate | ✅ |
| T14 | client socket | unit | unit | ✅ |
| T15 | theme | unit | unit | ✅ |
| T16 | componente | component | component | ✅ |
| T17 | demo/engine | unit | unit | ✅ |
| T18–T20 | texto/cenário | none | build gate | ✅ |

## Requirement Coverage

| Req | Tasks |
| --- | --- |
| PROG-01 | T12 |
| PROG-02 | T3, T4–T11 |
| PROG-03 | T3, T4–T11 |
| PROG-04 | T1 |
| PROG-05 | T1 |
| PROG-06 | T1 |
| PROG-07 | T2, T14 |
| PROG-08 | T2 |
| PROG-09 | T16 |
| PROG-10 | T14, T15 |
| PROG-11 | T17 |
| PROG-12 | T18 |
| PROG-13 | T13, T19 |
| PROG-14 | T20 |

**Coverage:** 14 total, 14 mapped, 0 unmapped.
