# Logica de Programacao — Validation

**Data**: 2026-10-04
**Spec**: `.specs/features/logica-programacao/spec.md` (PROG-01..PROG-14)
**Diff range**:
- BACK `proexGame-back`: `51fa306..c11ec2b` (`main...feat/logica-programacao`, 14 commits: `36151f7` … `c11ec2b`)
- FRONT `proexGame-front`: `3183349..8689a51` (`main...feat/logica-programacao`, 8 commits: `cb3f3b1` … `8689a51`)
**Verifier**: sub-agente independente (autor ≠ verificador), evidence-or-zero. Nenhum arquivo de código, teste ou pergunta foi alterado; as mutações foram aplicadas em estado temporário e restauradas com `git checkout -- <arquivo>`. `git status` ficou limpo nos dois repositórios no fim.

## Veredito: ❌ FAIL (gap pequeno; uma task de correção resolve)

Todos os gates passam e o conteúdo está correto: revisei as 288 perguntas e não achei nenhum gabarito errado. Mesmo assim o veredito é FAIL, porque **um mutante sobreviveu** (F7). O teste do modal não diferencia `whitespace-pre` de `whitespace-pre-wrap`. Com essa troca, o pseudocódigo passaria a quebrar linha e a indentação se perderia, o que viola o PROG-09 AC7. A regra do checklist é que todo mutante sobrevivente gera uma task de correção antes de a feature ser dada como concluída. Há também desvios (Minor) do critério de nível definido na spec, em 4 categorias.

---

## Task Completion

| Task | Status | Notas |
| --- | --- | --- |
| T1–T3 (BACK núcleo) | ✅ | commits `36151f7`, `82521f8`, `1e9c359` |
| T4–T11 (conteúdo, 8×36) | ✅ | 1 commit por categoria |
| T12–T13 (arquivamento + docs) | ✅ | `5eaebd9`, `aeab32e` |
| T14–T20 (FRONT) | ✅ | `cb3f3b1` … `8689a51` (T20 = P3) |

---

## Gate Check

| Repo | Comando | Exit | Resultado |
| --- | --- | --- | --- |
| BACK | `npm test` | 0 | **16 suites, 296/296** (aviso `MaxListenersExceededWarning`, que não afeta o resultado) |
| BACK | `npm run test:e2e` | 0 | **7 suites, 16/16** |
| BACK | `npm run lint` (`--max-warnings 0`) | 0 | limpo |
| BACK | `npm run build` | 0 | ok |
| FRONT | `npx vitest run` | 0 | **21 arquivos, 128/128** |
| FRONT | `npm run lint` | 0 | limpo |
| FRONT | `npm run typecheck` | 0 | ok |
| FRONT | `npm run build` | 0 | ok |

**Integridade dos testes:** nenhum `it(`/`test(` foi removido no diff dos dois repos (conferido com `git diff main...HEAD | grep '^-.*it('`). BACK: +29 testes (de cerca de 267 para 296). FRONT: +31 testes (de cerca de 97 para 128). Em `board.test.ts` só mudou a lista de matérias. Nenhum teste foi pulado.

---

## Spec-Anchored Acceptance Criteria

Legenda: ✅ coberto, com valor conforme a spec · ⚠️ gap de precisão ou coberto só parcialmente · 🔧 verificado só por build ou inspeção manual · ❌ gap

### P1 — Banco de perguntas (PROG-01..04)

| # | Critério | Resultado definido pela spec | `file:line` + asserção | Resultado |
| --- | --- | --- | --- | --- |
| 1 | boot → `subjects()` = exatamente 8 categorias | conjunto exato das 8 | `src/questions/question-bank.content.spec.ts:105` — `expect(service.subjects()).toEqual(Object.keys(CATEGORY_PREFIX).sort())` | ✅ |
| 1b | nenhuma matéria antiga carregada | antigas em `_arquivo/` | `question-bank.content.spec.ts:113` — `expect(archived).toEqual([...8 arquivos])` + o item 1 (igualdade exata) | ✅ |
| 2 | ≥ 12 easy / normal / hard por arquivo | ≥ 12 | `question-bank.content.spec.ts:72` — `expect({subject, level, ok: count >= MIN_PER_LEVEL}).toEqual({...ok:true})` (MIN=12). Real: 36 = 12/12/12 em todas | ✅ (nota: o teste itera só as categorias presentes; a ausência de uma categoria é pega pelo item 1) |
| 3 | id único + prefixo `-NNNN` | `^<prefixo>-\d{4}$`, único | `:60` — `expect(dupes).toEqual([])`; `:87` — `expect({subject, bad}).toEqual({subject, bad: []})` | ✅ |
| 4 | casas-pergunta só nas 8 categorias | `generateBoard` usa `questionBank.subjects()` | `src/game/board.rules.spec.ts:411-416` — `expect(subjects).toContain(subject)` + `game.service.ts:117-120` passa `this.questionBank.subjects()` + item 1 | ✅ (composição) |
| 5 | 4 alternativas distintas, fail-fast | erro de boot com índice | `src/questions/question-bank.service.spec.ts:656-684` — `rejects.toThrow(/\[0\].*alternativas.*distintas/)` em 5 casos (prox=correct, wrong=correct, wrong=wrong, wrong=prox, trim) | ✅ |

### P1 — Campo `code` (PROG-05..09)

| # | Critério | Resultado definido pela spec | `file:line` + asserção | Resultado |
| --- | --- | --- | --- | --- |
| 1 | `code` só é aceito se for string não-vazia, ≤ 15 linhas, ≤ 44 caracteres por linha e sem `\t`; senão falha com arquivo + índice | erro de boot apontando arquivo + `[idx]` | `question-bank.service.spec.ts:604` — `toThrow(/lacos\.json"\[0\].*"code".*15 linhas/)`; `:611` (45 chars); `:626` (tab); `:630,633` (vazio / só espaços); `:639` (não-string); `:647` — `toThrow(/\[1\].*"code"/)` (índice); limite exato aceito: `:595` — `toHaveLength(15)` com linha de 44 | ✅ (o arquivo só é afirmado no teste de 16 linhas; o prefixo `"<filepath>"[idx]` é compartilhado, `question-bank.service.ts:153`) |
| 2 | sem `code`, a pergunta continua válida | válida e sem a chave | `:569` — `expect('code' in q!).toBe(false)` | ✅ |
| 3 | `questionPrompt` traz `code` idêntico ao do banco; sem `code`, a chave é omitida | presença / ausência da chave | `src/game/question.rules.spec.ts:169-176` — `expect(view.code).toBe(CODE)` + chaves exatas; `:183` — `expect('code' in view).toBe(false)`; carregamento idêntico: `question-bank.service.spec.ts:575` | ✅ unit · ⚠️ nenhum e2e afirma `code` no payload WS real (risco baixo: `game.service.ts:448-452` é o único ponto de emissão e passa por `toQuestionPrompt`) |
| 4 | `PendingQuestion` guarda `code` no Redis | `pending.code` idêntico e sobrevive à serialização | `question.rules.spec.ts:137` — `expect(pending.code).toBe(CODE)`; `:154` — round-trip JSON `toQuestionPrompt(restored).code` | ✅ |
| 5 | RF-16 intacto | nada que identifique a correta ou a proximal | `question.rules.spec.ts:191-194` — `not.toContain('correctIndex')`, `not.toHaveProperty('correct'/'proximal')`; `:170` — chaves exatas `['code','options','questionId','statement','subject']` | ✅ |
| 6 | o modal renderiza `code` abaixo do `statement`, monoespaçado, preservando quebras de linha e espaços | `<pre><code>` com o texto exato | `src/features/play/QuestionModal.test.tsx:40` — `expect(code!.textContent).toBe(CODE)`; `:46` — `toContain('font-mono')`; `:57-63` — posição statement → pre → opções | ✅ |
| 7 | rolagem horizontal, sem quebrar linhas | `overflow-x-auto` + `white-space: pre` | `QuestionModal.test.tsx:47-49` — `toContain('whitespace-pre')`, `toContain('overflow-x-auto')`, `toContain('max-w-full')` | ❌ **não discriminante**: `toContain` sobre `className` aceita `whitespace-pre-wrap` (mutante F7 sobreviveu). O ajuste em 375 px é 🔧 manual |
| 8 | sem `code`, o modal fica igual ao atual | nenhum `<pre>` | `QuestionModal.test.tsx:68` — `expect(container.querySelector('pre')).toBeNull()` | ✅ |
| E | `\r\n` é normalizado antes de validar | `'x <- 1\nescreva(x)'` | `question-bank.service.spec.ts:585` — `toBe('x <- 1\nescreva(x)')`; `:618` (limite contado depois da normalização) | ✅ |

**Regra de conjunção do payload (`questionPrompt.code`):**

| Elo | Presente → chave com valor idêntico | Ausente → chave omitida |
| --- | --- | --- |
| Back: loader | `service.spec.ts:575` | `service.spec.ts:569` |
| Back: `buildPendingQuestion` | `question.rules.spec.ts:137` | `question.rules.spec.ts:145` |
| Back: `toQuestionPrompt` | `question.rules.spec.ts:169` | `question.rules.spec.ts:183` (mutante B8 `code: pending.code` foi morto) |
| Front: `SocketGameClient` | `SocketGameClient.questionPrompt.test.ts:63` | `:76` (mutante F2 `code: raw.code` foi morto) |
| Front: `MockGameClient` | `MockGameClient.questions.test.ts:47` | `:45` (os dois ramos são exercitados, `:51-52`) |

Todos os elos foram verificados nos dois sentidos ✅.

### P1 — Front reconhece as categorias (PROG-10)

| # | Critério | Resultado | Evidência | Resultado |
| --- | --- | --- | --- | --- |
| 1 | nome, rótulo, cor e ícone vêm de `SUBJECT_META` explícito | valores explícitos | `src/features/board/theme.test.ts:42-44` — `toBe(EXPECTED[slug].name/label/icon)`; `:56-57` — cor hex e 8 cores distintas (o fallback geraria cor por hash) | ✅ (mutante F8, que remove `vetores`, foi morto) |
| 2 | `BACKEND_SUBJECTS` = exatamente as 8 | lista exata | `src/game/client/SocketGameClient.questionPrompt.test.ts:82` — `toEqual([...8 ordenadas])` | ✅ |
| 3 | slug desconhecido → fallback | fallback atual | `theme.test.ts:61-63` — `'Estruturas De Dados'`, `'Est'`, `'📚'` | ✅ |
| 4 | rótulo ≤ 6 | ≤ 6 caracteres | `theme.test.ts:50` — `[...subjectLabel(slug)].length` `toBeLessThanOrEqual(6)` | ✅ |

### P2 — Demo e Home (PROG-11, PROG-12)

| # | Critério | Evidência | Resultado |
| --- | --- | --- | --- |
| 1 | o Mock serve só as 8 categorias, ≥ 3 por categoria, com `code` | `src/data/questions/questions.test.ts:11` (conjunto exato), `:20-21` (≥ 3 e subject próprio), `MockGameClient.questions.test.ts:47`. Conferi também os 32 itens da demo contra o banco do back: idênticos (subject, statement, code, alternativas) | ✅ |
| 2 | subtítulo da Home menciona lógica de programação | `src/features/lobby/HomeScreen.tsx:48`: "Treine lógica de programação — pense, resolva e avance!" | 🔧 inspeção/build (sem teste; a matriz aceita "none") |
| 3 | os 10 JSON legados foram removidos e as entradas legadas saíram de `SUBJECT_META` | diff: 10 arquivos removidos; `theme.test.ts:67-68` (antigas caem no fallback) | ✅ |

### P2 — Docs (PROG-13) — 🔧 inspeção

- `questions/README.md:35,83-109`: 8 categorias, prefixos, `code` (limites, `\r\n`, dialeto) e critério de nível ✅
- `CONTRACT.md:166` (back) e `CONTRACT.md:162` / `Contratos/CONTRACT.md:162` (front): `code?: string` ✅
- `CLAUDE.md:9,131` (back) e `README.md:4` (front) refletem o novo público ✅. O `README.md` do back está **vazio** (já estava antes da feature), então não há o que contradizer.

### P3 — Cenário (PROG-14) — 🔧 build/inspeção

`BoardScenery.tsx`: props `{ }`, `</>`, chip, terminal `>_`, losango `se?`. O balão foi mantido ✅.

### Edge Cases

| Edge case | Evidência | Resultado |
| --- | --- | --- |
| categoria esgota o nível → `null` → casa normal | `question-bank.service.spec.ts:374` `toBeNull()`; `src/game/game.service.spec.ts:440` ("trata casa-pergunta esgotada como normal") | ✅ (já existia) |
| `\r\n` normalizado | ver PROG-06 | ✅ |
| 45+ caracteres, 16+ linhas ou `\t` → fail-fast | ver PROG-05 | ✅ |
| `code` vazio ou só espaços → falha | `service.spec.ts:630,633` | ✅ |
| `questions/_arquivo/` não é carregado | `service.spec.ts:703-704` (subdiretório ignorado em fixture) + `content.spec.ts:105` no banco real | ✅ |
| client antigo ignora a chave extra | por construção: o `SocketGameClient` de `main` mapeia campo a campo (`questionId/subject/statement/options`), então `code` era descartado. Mudança aditiva documentada em `CONTRACT.md:166` | 🔧 inspeção (sem teste automatizado no client antigo) |

---

## Discrimination Sensor

Mutações aplicadas em estado temporário: o arquivo era alterado, os testes rodavam e em seguida havia `git checkout -- <arquivo>`. BACK: `npx jest src/questions src/game/question.rules.spec.ts` (58 testes). FRONT: `npx vitest run <pasta>`.

| # | Arquivo | Mutação | Resultado |
| --- | --- | --- | --- |
| B1 | `question-bank.service.ts` | `lines.length > CODE_MAX_LINES` → `>=` | ✅ Morto (5 falhas) |
| B2 | `question-bank.service.ts` | `l.length > MAX` → `> MAX + 1` (off-by-one) | ✅ Morto (1) |
| B3 | `question-bank.service.ts` | remove a normalização `\r\n` (`raw.replace(...)` → `raw`) | ✅ Morto (1) |
| B4 | `question-bank.service.ts` | desliga a checagem de alternativas distintas | ✅ Morto (5) |
| B5 | `question-bank.service.ts` | remove o `trim` da comparação de alternativas | ✅ Morto (1) |
| B6 | `question-bank.service.ts` | desliga a checagem de `\t` | ✅ Morto (2) |
| B7 | `question-bank.service.ts` | `raw.trim() === ''` → `raw === ''` | ✅ Morto (1) |
| B8 | `question.rules.ts` | `toQuestionPrompt` emite sempre `code: pending.code` (chave presente mesmo undefined) | ✅ Morto (2) |
| B9 | `question.rules.ts` | `toQuestionPrompt` descarta `code` | ✅ Morto (2) |
| B10 | `question.rules.ts` | `buildPendingQuestion` descarta `code` | ✅ Morto (3) |
| B11 | `question-bank.service.ts` | loader emite sempre `code` (chave undefined) | ✅ Morto (1) |
| F1 | `SocketGameClient.ts` | remove o spread de `code` | ✅ Morto (1) |
| F2 | `SocketGameClient.ts` | `code: raw.code` sempre | ✅ Morto (1) |
| F3 | `QuestionModal.tsx` | remove `overflow-x-auto` | ✅ Morto (1) |
| F4 | `QuestionModal.tsx` | troca `<pre><code>` por `<div>` | ✅ Morto (3) |
| F5 | `MockGameClient.ts` | remove o spread de `code` | ✅ Morto (1) |
| F6 | `QuestionModal.tsx` | renderiza o `CodeBlock` sempre (`code ?? ''`) | ✅ Morto (1) |
| F7 | `QuestionModal.tsx` | `whitespace-pre` → `whitespace-pre-wrap` (quebra linhas e perde a indentação) | ❌ **Sobreviveu** |
| F8 | `theme.ts` | remove a entrada `vetores` de `SUBJECT_META` (cai no fallback) | ✅ Morto (1) |

**Profundidade**: estendida (19 mutações). **Resultado: 18/19 mortos. FAIL por causa do F7.**

---

## Content spot-check (correção pedagógica)

**Escopo**: revisei à mão **as 288 perguntas** (8 categorias × 36), não só uma amostra. Para cada uma conferi o gabarito, que `proximal` e os dois `wrong` estão de fato errados e que as 4 alternativas são distintas (o boot também garante isso). Semântica usada: VisuAlg (`<-`, `div`, `mod`, `para` inclusivo, `repita…ate` roda ao menos uma vez e para quando a condição fica VERDADEIRA, `NAO` > `E` > `OU`, vetores com base 1 declarada).
**Resultado: 0 gabaritos errados, 0 distratores corretos, 0 alternativas repetidas.**

Amostra documentada (1 por categoria e nível):

| Categoria | Nível | id | Rastreamento | Gabarito | OK? |
| --- | --- | --- | --- | --- | --- |
| algoritmos | easy | alg-0012 | 3 + 4 | 7 | ✅ |
| algoritmos | normal | alg-0021 | 6 + 8/2 = 6 + 4 (precedência) | 10 | ✅ |
| algoritmos | hard | alg-0034 | (a,b) = (1,2),(2,3),(3,5),(5,8),(8,13) | 13 | ✅ |
| variaveis-e-tipos | easy | var-0008 | sobrescrita 4 → 9 | 9 | ✅ |
| variaveis-e-tipos | normal | var-0018 | 130 div 60 = 2; 130 mod 60 = 10 | 2min 10s | ✅ |
| variaveis-e-tipos | hard | var-0031 | 87 div 25 = 3; 87 mod 25 = 12; 12 div 10 = 1 | 3 1 | ✅ |
| condicionais | easy | cond-0011 | 25 > 25 é F → senao | frio | ✅ |
| condicionais | normal | cond-0016 | 4 < 5 → 7; 7 < 5 é F | 7 | ✅ |
| condicionais | hard | cond-0025 | 1900: mod 4 = 0 E mod 100 = 0 → F; mod 400 = 300 → comum | comum | ✅ |
| operadores-logicos | easy | oplog-0010 | (7 > 5) E (7 < 10) | VERDADEIRO | ✅ |
| operadores-logicos | normal | oplog-0018 | V E NAO F = V E V | VERDADEIRO | ✅ |
| operadores-logicos | hard | oplog-0036 | r = V E V = V; r = V E NAO(12 > 10) = F | FALSO | ✅ |
| lacos-de-repeticao | easy | laco-0012 | 3,2,1 (passo -1) | 321 | ✅ |
| lacos-de-repeticao | normal | laco-0019 | repita: x = 11; 11 > 5 → para | 11 | ✅ |
| lacos-de-repeticao | hard | laco-0027 | 6→3→10→5→16→8→4→2→1 = 8 passos | 8 | ✅ |
| vetores | easy | vet-0012 | v[2] <- 7 | 7 | ✅ |
| vetores | normal | vet-0022 | soma de prefixos: 8, 12, 16, 20 | 20 | ✅ |
| vetores | hard | vet-0032 | distintos de {5,3,5,2,3,5} = {5,3,2} | 3 | ✅ |
| funcoes | easy | func-0012 | maior(3,9) → 3 > 9 F → retorne b | 9 | ✅ |
| funcoes | normal | func-0018 | o primeiro `retorne` encerra | 6 | ✅ (ver obs. L2) |
| funcoes | hard | func-0036 | 40721 → 4072 → 407 → 40 → 4: 1+1+1+1+1 | 5 | ✅ |
| busca-e-ordenacao | easy | bus-0004 | 4 (≠), 9 (=) | 2 | ✅ |
| busca-e-ordenacao | normal | bus-0016 | 5,1,4,2 → 1,5,4,2 → 1,4,5,2 → 1,4,2,5 | 1, 4, 2, 5 | ✅ |
| busca-e-ordenacao | hard | bus-0035 | m = 4 (4 < 7), m = (5+8) div 2 = 6, m = (7+8) div 2 = 7 | 4, 6, 7 | ✅ |

Outras conferidas com rastreamento completo (todas ✅): alg-0013, 0015, 0018, 0019, 0025, 0026, 0028, 0031, 0032, 0036; var-0013..0036; cond-0013..0036; laco-0013..0036 (inclui 0023 = 7, 0026 = 36, 0033 = 55, 0036 = 14); vet-0013..0036 (inclui 0025 = 54321, 0030 = 1111, 0034 = 4, 0036 = 4); func-0013..0036 (inclui 0030 fib(6) = 8, 0034 mdc = 6, 0035 = "13 2"); oplog-0013..0036; bus-0013..0036 (inclui 0028 achou = 6, 0030 = 6 trocas). O maior `code` usa 41 caracteres por linha (limite 44).

### Achados de conteúdo

**C1 (Minor) — o critério de nível da spec não é cumprido ao pé da letra em 4 categorias.** A spec define hard como "laço aninhado, vetor + laço, função/recursão ou escolha de algoritmo" e easy como "≤ 4 linhas, sem laço".
- **hard sem laço/função/vetor** (pela regra seriam easy/normal): `var-0025..0031, var-0035, var-0036` (trocas e expressões sem laço; var-0032 e var-0034 são conceito ou precedência); `cond-0025, 0026, 0028..0034, 0036` (se aninhado ou condição composta, que a spec classifica como **normal**); `oplog-0032, oplog-0036` e os hard conceituais de De Morgan; `alg-0026` (maior de 3 com dois `se`) e `alg-0036` (troca aritmética).
- **hard com 1 laço simples** (pela regra seria normal): `alg-0028`, `alg-0032`, `laco-0029`, `laco-0031`.
- **easy com laço ou > 4 linhas**: `laco-0002, 0003, 0006, 0009, 0012` (têm laço); `cond-0004, 0008, 0011` (6 linhas); `func-0010` (5), `func-0012` (7).
- Pedagogicamente a progressão **relativa dentro de cada categoria** faz sentido (variáveis e condicionais não têm laço por natureza). O problema é a divergência em relação ao critério absoluto escrito na spec e em `questions/README.md:99-102`.

**Observações de baixa severidade (sem resposta errada):**
- **L1** `var-0033`: o proximal "toda variável começa valendo zero" é **verdade no próprio VisuAlg** (numéricas iniciam em 0), que é o dialeto adotado. O gabarito ("depende da linguagem") continua sendo a melhor resposta, mas um aluno que conheça VisuAlg pode se confundir. Sugestão: "Não é perigoso: em toda linguagem a variável começa valendo zero".
- **L2** `func-0018` (e, implicitamente, todas as funções com `retorne` antecipado e recursão): o banco assume que `retorne` encerra a função na hora. É a semântica comum. Basta deixar registrado no README do dialeto.
- **L3** `oplog-0008`: o distrator "Não, porque 1.50 é maior que 1.40" acerta a conclusão (Não) com a justificativa errada. É defensável, mas pode gerar contestação em sala. Sugestão: "Não, porque a altura é insuficiente".
- **L4** Saídas reais (`alg-0019` → 45, `var-0023` → 5, `vet-0017` → 7) seriam impressas como valor real no VisuAlg. Não há ambiguidade porque nenhuma alternativa disputa "45" com "45.0".

---

## Code Quality

| Princípio | Status |
| --- | --- |
| Código mínimo / mudanças cirúrgicas | ✅ (back: +51 linhas no service e +5 em rules; front: um spread por client e um `CodeBlock`) |
| Sem scope creep | ✅ (`max-h-full overflow-y-auto` + padding responsivo no modal, `8689a51`, servem diretamente ao objetivo de 375 px) |
| Segue os padrões do código | ✅ (mesmo padrão `...(x !== undefined && {...})` em todos os elos) |
| Asserções conferidas contra o resultado da spec | ⚠️ PROG-09 AC7 (F7) |
| Cobertura por camada (matriz de tasks.md) | ✅ (cobertura e2e de `code`: ⚠️ baixa, só regressão) |
| Todo teste mapeia para um AC | ✅ (`theme.test.ts:54` cores distintas e `question.rules.spec.ts:157` embaralhamento inalterado mapeiam para os Done-when de T15 e T2) |
| Diretrizes | `back/CLAUDE.md`, CIs; Conventional Commits seguidos ✅ |

---

## Gaps ranqueados e fix plans

1. **[Major — mutante sobrevivente] PROG-09 AC7: o teste não diferencia `whitespace-pre` de `whitespace-pre-wrap`.**
   - Onde: `Front/proexGame-front/src/features/play/QuestionModal.test.tsx:47`
   - Correção: trocar `expect(pre.className).toContain('whitespace-pre')` por `expect(pre.classList.contains('whitespace-pre')).toBe(true)` e acrescentar `expect(pre.classList.contains('whitespace-pre-wrap')).toBe(false)`. Fazer o mesmo, por token, com `font-mono`, `overflow-x-auto` e `max-w-full`.
   - Done when: o mutante F7 é morto e a suíte continua verde.
2. **[Minor] C1: critério de nível divergente em var, cond, oplog e laços (easy), mais casos pontuais em alg e func.**
   - Opção A (recomendada, sem mexer no conteúdo): emendar a spec (Assumptions → "Critério de nível") e `questions/README.md:99-102` com um critério **relativo por categoria**. Exemplos: em variáveis e condicionais, hard = rastrear ≥ 6 atribuições encadeadas ou condicionais aninhadas com 3+ ramos; em laços, easy = laço simples de até 3 linhas sem acumulador.
   - Opção B: reclassificar os ids listados em C1 e repor o mínimo de 12 por nível.
3. **[Minor] PROG-07 AC3 sem cobertura no nível WS.** Nenhum e2e afirma `code` no `questionPrompt` emitido pelo gateway. Sugestão: em um e2e já existente que provoca `questionPrompt` com o banco real, afirmar `typeof prompt.code === 'string' || !('code' in prompt)`. Melhor ainda: usar um fixture com `code` via `QUESTIONS_DIR` e afirmar a igualdade exata.
4. **[Low] Conteúdo L1/L3**: reescrever os distratores de `var-0033` e `oplog-0008`, como sugerido acima. **L2**: documentar no README que `retorne` encerra a função.
5. **[Low] Spec-precision**: PROG-09 AC7 ("em 375 px") e PROG-12/13/14 ficam em 🔧 manual/build. Recomendo uma checagem de UAT em 375 px com a pergunta de linha mais longa (41 caracteres, por exemplo `cond-0013`, `laco-0036` ou `bus-0028`).

---

## Requirement Traceability (proposta de atualização)

| Req | Novo status |
| --- | --- |
| PROG-01, 02, 03, 04, 05, 06, 08, 10, 11 | ✅ Verified |
| PROG-07 | ✅ Verified (unit). e2e ⚠️ baixo |
| PROG-09 | ❌ Needs Fix (teste de AC7 não discriminante) |
| PROG-12, 13, 14 | ✅ Verified (inspeção/build) |

> Lições (passo 10 do checklist) não foram registradas: este Verifier tinha permissão para gravar só este relatório. Lição candidata: "Ao afirmar classes CSS, use `classList.contains(token)` e não `className.toContain(substring)`, porque utilitários com prefixo comum (`whitespace-pre` / `whitespace-pre-wrap`) mascaram regressões."

## Summary

**Overall**: ⚠️ Quase pronto. Falta uma correção de teste para virar PASS.
**Spec-anchored**: 30 ACs + 6 edge cases. 1 AC com teste não discriminante (PROG-09.7). 6 itens verificados só por build/inspeção (Home, docs, cenário, client antigo, 375 px).
**Sensor**: 18/19 mutantes mortos.
**Gate**: BACK 296 + 16 e2e, lint e build ok · FRONT 128, lint, typecheck e build ok.
**Conteúdo**: 288/288 revisadas, 0 gabaritos errados. Desvio de critério de nível (Minor) e 3 observações de redação (Low).

---
---

# Iteração 2 — re-verificação (2026-10-04)

**Commits novos cobertos**: BACK `c11ec2b..f8996f0` (`7cc296d` test(e2e), `f8996f0` fix(questions)) · FRONT `8689a51..a6351b0` (`a6351b0` test(play)).
**Veredito: ✅ PASS**

## Gates (rodados de novo, todos com exit 0)

| Repo | Comando | Resultado |
| --- | --- | --- |
| BACK | `npm test` | 16 suites, **296/296** |
| BACK | `npm run test:e2e` | **8 suites, 17/17** (+1: `test/e2e/question-code.e2e-spec.ts`) |
| BACK | `npm run lint` / `npm run build` | ok / ok |
| FRONT | `npx vitest run` | 21 arquivos, **128/128** |
| FRONT | `npm run lint` / `typecheck` / `build` | ok / ok / ok |

## Fechamento dos gaps

| Gap (iteração 1) | Correção | Evidência | Status |
| --- | --- | --- | --- |
| 1 [Major] F7 / PROG-09 AC7 | asserções por token | `Front/proexGame-front/src/features/play/QuestionModal.test.tsx:48-53` — `expect(pre.classList.contains('whitespace-pre')).toBe(true)`, `...('whitespace-pre-wrap')).toBe(false)`, `...('whitespace-pre-line')).toBe(false)`, `font-mono` / `overflow-x-auto` / `max-w-full` `toBe(true)` | ✅ F7 e F7b mortos |
| 2 [Minor] C1 critério de nível | spec (Assumptions) e `questions/README.md:97-105` passam a usar um critério **relativo à categoria** | Reavaliei os ids listados em C1 com o critério novo. Os easy de laços e condicionais são "rastreio curto e direto" do conceito central. Os hard de variáveis, condicionais e operadores lógicos são "rastreio com armadilha (ordem/precedência/aninhamento)", por exemplo troca com `aux`, `div` com precedência, `se` aninhado na ordem errada e De Morgan. `alg-0028`/`alg-0032`/`laco-0029`/`laco-0031` são armadilhas de limite ou de `mod`/`div`. Todos se enquadram | ✅ resolvido por emenda da spec |
| 3 [Minor] `code` no WS (PROG-07 AC3) | novo e2e com banco-fixture | `test/e2e/question-code.e2e-spec.ts` — `expect(prompt.code).toBe(CODE)`, chaves exatas `['code','options','questionId','statement','subject']`, `not.toContain('correctIndex'/'proximalIndex')` | ✅ E1, E2 e E3 mortos |
| 4 [Low] L1/L2/L3 | redação | `var-0033` proximal = "Não é perigoso: em qualquer linguagem toda variável começa valendo zero" (agora falso sem ambiguidade, o VisuAlg não é "qualquer linguagem"); `oplog-0008` wrong[1] = "Só se ela estiver acompanhada de um adulto" (errado e não disputa a conclusão); README: "`retorne` encerra a função na hora". Alternativas continuam distintas (o boot e os gates passam) | ✅ |
| 5 [Low] 375 px | medição feita pelo coordenador | Conferi o dado que dá para checar: das **152** perguntas com `code`, exatamente **5** têm linha com mais de 37 caracteres (`bus-0028, cond-0025, cond-0026, func-0033, laco-0036`), o que bate com o relatado. A medição no navegador (37 caracteres/linha a 13px, a rolagem funciona) foi informada pelo coordenador e **não refeita** por este Verifier | 🔧 aceito (UAT manual) |

## Discrimination Sensor — iteração 2

Mutações aplicadas em estado temporário e restauradas com `git checkout -- <arquivo>`. As e2e rodaram em suíte única com `--forceExit`.

| # | Arquivo | Mutação | Testes | Resultado |
| --- | --- | --- | --- | --- |
| F7 | `QuestionModal.tsx` | `whitespace-pre` → `whitespace-pre-wrap` | vitest `src/features/play` | ✅ Morto (1 falha) |
| F7b | `QuestionModal.tsx` | `whitespace-pre` → `whitespace-pre-line` | vitest `src/features/play` | ✅ Morto (1) |
| E1 | `question.rules.ts` | `toQuestionPrompt` sem `code` | e2e `question-code` | ✅ Morto (1/1) |
| E2 | `question.rules.ts` | `buildPendingQuestion` sem `code` | e2e `question-code` | ✅ Morto (1/1) |
| E3 | `question.rules.ts` | `toQuestionPrompt` vaza `correctIndex` (por spread com cast, para compilar) | e2e `question-code` | ✅ Morto (1/1) |

**Acumulado**: iteração 1 teve 18/19; os 18 mortos não foram tocados pelas correções, que só mexeram em testes, docs e 2 strings de conteúdo. Iteração 2: **5/5**. Não sobra nenhum mutante sobrevivente.

## Observação residual (não bloqueia)

- O critério relativo é menos verificável mecanicamente do que o absoluto. Fica a cargo de quem revisa o conteúdo. É uma escolha consciente registrada na spec.

## Requirement Traceability (atualização)

| Req | Status |
| --- | --- |
| PROG-01..08, 10, 11 | ✅ Verified (PROG-07 agora também em e2e) |
| PROG-09 | ✅ Verified (unit discriminante; 375 px via UAT do coordenador) |
| PROG-12, 13, 14 | ✅ Verified (inspeção/build) |

## Summary (iteração 2)

**Overall**: ✅ Pronto.
**Gate**: BACK 296 + 17 e2e, lint e build ok · FRONT 128, lint, typecheck e build ok.
**Sensor**: 5/5 na iteração 2; nenhum sobrevivente no acumulado.
**Conteúdo**: 288/288 sem gabarito errado; as 2 perguntas alteradas foram reconferidas.
**Árvores**: os dois repositórios limpos (só `validation.md` não rastreado); nada commitado.
