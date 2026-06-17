# Feature: Escalonamento por dificuldade (tabuleiro + perguntas)

**Status:** aguardando aprovação
**Autor:** Murilo Weiss (via dev-workflow)
**Data:** 2026-06-17

## 1. Objetivo

A dificuldade da partida (`easy | normal | hard`) passa a escalar **três eixos**:

1. **Tamanho do tabuleiro** varia por dificuldade (hoje é fixo em `[20,30]` para todos).
2. **Dificuldade das perguntas** servidas casa com a dificuldade da sessão (hoje o pool é plano).
3. **Pontuação** (avanço no acerto / recuo no erro) — **sem mudança**: a tabela atual já
   premia menos e pune mais no difícil (decisão do Murilo: manter `game.rules.ts`).

## 2. Decisões aprovadas (brainstorming)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Modelo de dificuldade da pergunta | **Campo `difficulty` por pergunta**; a sessão sorteia só do nível dela |
| 2 | Esgotamento do pool em tabuleiros grandes | **Expandir o banco agora** (gerar conteúdo novo; Murilo revisa corretude) |
| 3 | Magnitude da pontuação | **Manter a tabela atual** (`game.rules.ts` intocado) |
| 4 | Escala de presídios (default proposto) | `prisonCount(n) = max(1, round(n / 25))` — **ajustável na aprovação** |

## 3. Requisitos

### RF-NEW-01 — Tamanho do tabuleiro por dificuldade

`generateBoard` sorteia N na faixa da dificuldade:

| Dificuldade | Faixa de N |
|---|---|
| `easy`   | [30, 45] |
| `normal` | [60, 70] |
| `hard`   | [65, 85] |

Substitui o `rng.int(20, 30)` fixo em [board.rules.ts:86](../../../src/game/board.rules.ts).
A primeira chamada ao rng continua sendo o sorteio de N (mantém o contrato de
determinismo dos testes), mudando apenas os limites por dificuldade.

### RF-NEW-02 — Presídios escalam com o tamanho

`prisonCount(n)` deixa de ser `n<=24 ? 1 : 2` e passa a `max(1, round(n / 25))`:

| N | 30 | 45 | 60 | 65 | 70 | 85 |
|---|---|---|---|---|---|---|
| presídios | 1 | 2 | 2 | 3 | 3 | 3 |

> Knob de balanceamento. Se preferir mais/menos presídios, troca-se o divisor `25`.

### RF-NEW-03 — Perguntas têm dificuldade

- `Question` ganha campo obrigatório `difficulty: 'easy' | 'normal' | 'hard'`.
- `validateFile` (boot, fail-fast) passa a exigir e validar o campo.
- **Todas** as 96 perguntas existentes recebem o campo (senão o boot quebra).

### RF-NEW-04 — Sorteio filtra por dificuldade da sessão

- `pickQuestion(subject, excludedIds, rng, difficulty)` passa a filtrar o pool
  pela `difficulty` **além** de `excludedIds`.
- A `difficulty` vem de `state.difficulty` no call site ([game.service.ts:440](../../../src/game/game.service.ts)).
- **Fallback existente preservado:** se o pool filtrado esgotar, `pickQuestion`
  retorna `null` e o serviço já trata a casa como `normal` (sem softlock). Mantido.

### RF-NEW-05 — Banco expandido

Meta: **~12 perguntas por matéria por dificuldade** (8 matérias × 3 níveis ≈ 288).
- Existentes são reclassificadas no nível adequado (a maioria é `easy`/`normal`).
- Conteúdo novo gerado em lotes por matéria/nível; **Murilo revisa a corretude**
  (enunciado, `correct`, `proximal` plausível, 2 `wrong` claramente erradas — ver
  [questions/README.md](../../../questions/README.md)).
- O `proximal` continua sendo o distrator "quase-certo"; perguntas `hard` devem ter
  enunciado e distratores genuinamente mais difíceis.

## 4. Arquivos afetados

**Código:**
- `src/game/board.rules.ts` — faixa de N por dificuldade; `prisonCount` novo.
- `src/questions/question.types.ts` — campo `difficulty` em `Question` (e auditoria em `PendingQuestion`).
- `src/questions/question-bank.service.ts` — validação do campo + filtro no `pickQuestion`.
- `src/game/game.service.ts` — passar `state.difficulty` ao `pickQuestion`.

**Conteúdo:**
- `questions/*.json` (8 arquivos) — campo `difficulty` em todas + perguntas novas.

**Testes (TDD — escrever/atualizar antes):**
- `board.rules.spec.ts` — faixas por dificuldade, novo `prisonCount`.
- `question-bank.service.spec.ts` — validação do campo, filtro por dificuldade, esgotamento.
- `game.service.spec.ts` — call site com difficulty; reprodutibilidade do rng.
- `test/e2e/game-loop.e2e-spec.ts` — assert de tamanho `[20,30]` → faixas novas.

**Docs:**
- `CLAUDE.md` (tabelas de geração + faixas), `questions/README.md` (schema + volume),
  `CONTRACT.md` / `.specs/.../CONTRACT-*.md` (comentário `N ∈ [20,30]`).

## 5. Fora de escopo

- Pontuação (`game.rules.ts` advance/recoil) — mantida.
- Frontend SVG (consome `board.size` dinâmico; sem trabalho de back aqui).
- Mudança no contrato WebSocket (eventos/payloads inalterados).

## 6. Riscos

- **Volume de conteúdo:** ~190 perguntas novas com corretude pedagógica é a maior
  fatia de esforço e o maior risco de erro factual → revisão humana obrigatória.
- **Migração:** adicionar `difficulty` obrigatório quebra o boot até todas as 96
  serem taggeadas → fazer num único passo atômico (campo + tag) por arquivo.

## 7. Plano de sprint (proposto)

1. **Núcleo de regras** (puro, TDD): board size + prisonCount + filtro de pergunta.
2. **Schema + migração**: campo `difficulty`, validação, tag das 96 existentes.
3. **Expansão de conteúdo**: gerar perguntas novas por matéria/nível (lotes p/ revisão).
4. **Docs + e2e + verificação final.**
