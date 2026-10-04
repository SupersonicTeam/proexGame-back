# Logica de Programacao — Specification

> Escopo: **Large** (dois repositórios — `proexGame-back` e `proexGame-front` — + mudança
> de contrato WS + troca integral do banco de perguntas). Decisões do usuário em
> [context.md](./context.md).

## Problem Statement

O Trilha do Saber foi aplicado no 2º ano do Ensino Médio com 8 matérias escolares
(Matemática, Física, Química, Português, Web etc.). O próprio relatório final mostrou que
os alunos não tinham base para Desenvolvimento Web nos níveis normal/difícil: eles
tropeçavam na **ferramenta** (a linguagem) antes de dominar o **raciocínio**. O jogo passa
a treinar **lógica de programação** — pensar no passo a passo, escolher o algoritmo, prever
o que um programa faz — antes de qualquer linguagem, para **iniciantes a partir de 14 anos**
que querem começar a programar.

## Goals

- [ ] 100% das casas-pergunta servem perguntas de lógica de programação (8 categorias por
      conceito), nos 3 níveis, sem nenhuma matéria escolar antiga carregada.
- [ ] Perguntas com algoritmo exibem o pseudocódigo em bloco monoespaçado, legível em
      celular de 375 px de largura sem quebrar a indentação.
- [ ] Banco com **≥ 12 perguntas por categoria por nível** (≥ 288 no total), todas com
      distrator proximal pedagogicamente justificado.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Seleção de tema/modo no lobby ("Escolar" × "Programação") | Usuário optou por substituir integralmente (context D1). |
| Execução/edição de código pelo jogador | Foco é raciocínio; resposta continua sendo múltipla escolha. |
| Linguagens reais (Python, JS etc.) nos enunciados | Público iniciante; a proposta é pensar antes da ferramenta (context D3). |
| Destaque de sintaxe (syntax highlighting) | Monoespaçado + indentação preservada bastam; evita dependência nova. |
| Painel para professores cadastrarem perguntas | Melhoria futura citada no relatório; não é esta feature. |
| Atualizar o relatório PROEX (.docx) | Documento já entregue; fora do código. |
| Novo cenário visual do tabuleiro (props "tech" no lugar de "escolares") | Cosmético; registrado como P3 opcional. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Destino das matérias antigas | Movidas para `questions/_arquivo/` (fora do carregamento — o loader só lê `*.json` do diretório raiz) | Preserva o conteúdo sem afetar o jogo | y (D1) |
| As 8 categorias | `algoritmos`, `variaveis-e-tipos`, `condicionais`, `operadores-logicos`, `lacos-de-repeticao`, `vetores`, `funcoes`, `busca-e-ordenacao` | Cobre a progressão clássica de "Algoritmos e Lógica de Programação"; manter 8 preserva a densidade por matéria já calibrada | y (D2 — por conceito) |
| Dialeto do pseudocódigo | Portugol estilo VisuAlg, ASCII: `<-` para atribuição, `escreva`, `leia`, `se/entao/senao/fimse`, `para i de 1 ate n faca/fimpara`, `enquanto/faca/fimenquanto`, `repita/ate`, `funcao/retorne/fimfuncao`, `E`/`OU`/`NAO`, `mod`/`div`. Sem boilerplate (`algoritmo`/`var`/`inicio`) salvo quando a pergunta trata disso | É o padrão dos cursos brasileiros de introdução; ASCII evita problema de fonte/teclado | y (D3) |
| Índice de vetores | Sempre declarado no próprio trecho (`v: vetor[1..5] de inteiro`); quando omitido, **base 1** | Elimina ambiguidade sem depender de convenção implícita | n — default do agente |
| Onde vai o código | Campo opcional `code` na pergunta, separado de `statement` | Contrato explícito e validável no boot | y (D4) |
| Limites do `code` | Não-vazio, **≤ 15 linhas**, **≤ 44 caracteres por linha**, sem tabulação (indentação = 2 espaços) | Cabe no modal em 375 px sem rolagem horizontal na maioria dos casos | n — default do agente |
| Critério de nível | **easy**: conceito ou trecho ≤ 4 linhas, sem laço; **normal**: rastrear 5–10 linhas, 1 laço ou condicional composta; **hard**: laço aninhado, vetor+laço, função/recursão, ou escolher o algoritmo adequado a um problema | Torna o nível verificável por quem revisa | n — default do agente |
| Correção das respostas de "qual a saída?" | Todo trecho com saída numérica/textual é **rastreado manualmente pelo autor** e reconferido pelo Verifier por amostragem (≥ 1 por categoria/nível) | Executor automático de Portugol está fora de escopo | n — default do agente |
| Modo demonstração do front (MockGameClient) | Banco legado (10 matérias escolares) substituído por um subconjunto das perguntas novas (≥ 3 por categoria) | Demo deve refletir o jogo real | n — default do agente |
| Texto de apresentação | Home: subtítulo passa a falar de lógica de programação; nome "Trilha do Saber" mantido | Marca já conhecida pela escola parceira | n — default do agente |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Banco de perguntas de lógica de programação ⭐ MVP

**User Story**: Como iniciante que quer programar, quero que as casas-pergunta tragam
desafios de lógica de programação, para treinar o raciocínio algorítmico jogando.

**Why P1**: É a mudança central da feature.

**Acceptance Criteria**:

1. WHEN o backend sobe THEN `QuestionBankService.subjects()` SHALL retornar exatamente as 8
   categorias da tabela de assumptions (e nenhuma matéria antiga).
2. WHEN cada arquivo de categoria é carregado THEN ele SHALL conter ≥ 12 perguntas com
   `difficulty: "easy"`, ≥ 12 `"normal"` e ≥ 12 `"hard"`.
3. WHEN uma pergunta é carregada THEN seu `id` SHALL ser único no banco e seguir o prefixo
   da categoria (`alg`, `var`, `cond`, `oplog`, `laco`, `vet`, `func`, `bus`) + `-NNNN`.
4. WHEN uma partida é gerada THEN as casas-pergunta SHALL ser atribuídas apenas às 8
   categorias novas (comportamento atual de `generateBoard`, sem mudança de regra).
5. WHEN as 4 alternativas de uma pergunta são comparadas THEN elas SHALL ser distintas entre
   si (`correct`, `proximal`, `wrong[0]`, `wrong[1]`) — validado no boot (fail-fast).

**Independent Test**: Subir o backend com o banco real e checar `subjects()` + contagem por
nível; jogar uma partida e ver só categorias novas no tabuleiro.

---

### P1: Pseudocódigo no enunciado (campo `code`) ⭐ MVP

**User Story**: Como jogador, quero ver o algoritmo formatado como código, para conseguir
rastrear o que ele faz.

**Why P1**: Sem isso, perguntas de "qual a saída?"/"ache o erro" ficam ilegíveis.

**Acceptance Criteria**:

1. WHEN uma pergunta tem `code` THEN o boot SHALL aceitá-lo apenas se for string não-vazia,
   com ≤ 15 linhas, ≤ 44 caracteres por linha e sem caractere de tabulação; caso contrário
   SHALL falhar com mensagem apontando arquivo + índice.
2. WHEN uma pergunta não tem `code` THEN ela SHALL continuar válida (campo opcional).
3. WHEN o servidor emite `questionPrompt` para pergunta com `code` THEN o payload SHALL
   incluir `code` com o texto idêntico ao do banco; para pergunta sem `code`, o payload SHALL
   omitir a chave.
4. WHEN uma pergunta com `code` é servida THEN o `PendingQuestion` persistido no Redis SHALL
   guardar `code`, de modo que toda projeção via `toQuestionPrompt` (inclusive um eventual
   reenvio) o inclua. *(Nota: hoje a reconexão NÃO reenvia `questionPrompt` — lacuna
   pré-existente, fora do escopo; ver design → Risks.)*
5. WHEN o servidor emite `questionPrompt` THEN o payload SHALL continuar sem qualquer campo
   que identifique a correta ou a proximal (RF-16 inalterado).
6. WHEN o front recebe `questionPrompt` com `code` THEN o modal SHALL renderizá-lo abaixo do
   `statement`, em fonte monoespaçada, preservando quebras de linha e espaços.
7. WHEN o bloco não cabe na largura THEN o modal SHALL rolar o bloco horizontalmente (sem
   quebrar linhas e sem estourar a largura do modal).
8. WHEN `questionPrompt` chega sem `code` THEN o modal SHALL ficar idêntico ao atual.

**Independent Test**: Servir uma pergunta com `code` em 375 px e em desktop; reconectar com
a pergunta aberta e ver o mesmo código.

---

### P1: Front reconhece as novas categorias ⭐ MVP

**User Story**: Como jogador, quero ver nome, ícone e cor próprios de cada categoria no
tabuleiro e no modal.

**Why P1**: Sem o mapeamento, as casas caem no fallback genérico (rótulo derivado do slug).

**Acceptance Criteria**:

1. WHEN o tabuleiro tem uma casa de qualquer uma das 8 categorias THEN `subjectName`,
   `subjectLabel`, `subjectColor` e o ícone SHALL vir de entrada explícita em `SUBJECT_META`
   (nunca do fallback).
2. WHEN `BACKEND_SUBJECTS` é lido THEN ele SHALL listar exatamente as 8 categorias novas.
3. WHEN chega um slug desconhecido THEN o fallback atual SHALL continuar funcionando.
4. WHEN o rótulo curto é exibido dentro da casa THEN ele SHALL ter ≤ 6 caracteres.

**Independent Test**: `BoardPreview`/partida com as 8 categorias — nenhuma casa com rótulo
de fallback.

---

### P2: Modo demonstração e textos para o novo público

**User Story**: Como visitante sem backend, quero que a demo e a tela inicial reflitam o
jogo de lógica de programação.

**Why P2**: Coerência; não bloqueia o jogo online.

**Acceptance Criteria**:

1. WHEN o `MockGameClient` serve perguntas THEN elas SHALL vir só das 8 categorias novas
   (≥ 3 perguntas por categoria) e incluir `code` quando a pergunta tiver.
2. WHEN a Home é exibida THEN o subtítulo SHALL mencionar lógica de programação
   (ex.: "Treine lógica de programação — pense, resolva e avance!").
3. WHEN o build do front roda THEN os 10 JSON escolares legados SHALL ter sido removidos de
   `src/data/questions/` e as entradas legadas removidas de `SUBJECT_META`.

**Independent Test**: Rodar a demo, cair em casas-pergunta das 8 categorias.

---

### P2: Documentação alinhada

**User Story**: Como mantenedor, quero que a documentação descreva o novo conteúdo.

**Acceptance Criteria**:

1. WHEN `questions/README.md` é lido THEN ele SHALL descrever as 8 categorias, prefixos,
   o campo `code` (limites e dialeto Portugol) e o critério de nível.
2. WHEN `CONTRACT.md` (back e front) é lido THEN `questionPrompt` SHALL documentar `code?`.
3. WHEN `CLAUDE.md`/README do back e README do front são lidos THEN o público e as matérias
   SHALL refletir a feature (sem "10 matérias"/"2º ano").

---

### P3: Cenário do tabuleiro com tema de programação (opcional)

**User Story**: Como jogador, quero um cenário que remeta a programação.

**Acceptance Criteria**:

1. WHEN o tabuleiro é desenhado THEN os props decorativos de `BoardScenery` SHALL ser
   temáticos de programação (ex.: `{ }`, `</>`, chip, terminal) no lugar dos escolares.

---

## Edge Cases

- WHEN uma categoria esgota as perguntas do nível na partida THEN `pickQuestion` SHALL
  retornar `null` e a casa vira normal (comportamento atual, sem softlock).
- WHEN `code` contém `\r\n` THEN o boot SHALL normalizá-lo para `\n` antes de validar os
  limites e servir.
- WHEN `code` tem linha com 45+ caracteres, 16+ linhas ou `\t` THEN o boot SHALL falhar
  (fail-fast) com arquivo + índice.
- WHEN `code` está presente mas é string vazia/só espaços THEN o boot SHALL falhar.
- WHEN existe um arquivo em `questions/_arquivo/` THEN ele SHALL NÃO ser carregado.
- WHEN um client antigo (sem suporte a `code`) recebe o payload THEN ele SHALL continuar
  funcionando, ignorando a chave extra (mudança aditiva).

## Implicit-Requirement Dimensions

| Dimensão | Tratamento |
| --- | --- |
| Input validation & bounds | Limites do `code` + alternativas distintas, validados no boot (PROG-05, PROG-06). |
| Failure / partial-failure | Boot fail-fast já existente; esgotamento de nível → casa normal. |
| Idempotency / retry | N/A — conteúdo estático carregado no boot. |
| Auth / rate limits | N/A — sem mudança. |
| Concurrency / ordering | N/A — banco imutável após o boot. |
| Data lifecycle | Matérias antigas arquivadas em `questions/_arquivo/`, não carregadas. |
| Observability | N/A — sem mudança. |
| External-dependency failure | N/A — sem dependências novas. |
| State-transition integrity | `PendingQuestion` persiste `code` (PROG-08); reenvio na reconexão é lacuna pré-existente (design → Risks). |

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PROG-01 | P1 Banco — 8 categorias carregadas, antigas arquivadas | Design | Pending |
| PROG-02 | P1 Banco — ≥ 12 por categoria por nível | Design | Pending |
| PROG-03 | P1 Banco — ids únicos com prefixo | Design | Pending |
| PROG-04 | P1 Banco — alternativas distintas (validação de boot) | Design | Pending |
| PROG-05 | P1 Código — schema `code?` + limites no boot | Design | Pending |
| PROG-06 | P1 Código — normalização `\r\n` | Design | Pending |
| PROG-07 | P1 Código — `code` no `questionPrompt` (RF-16 intacto) | Design | Pending |
| PROG-08 | P1 Código — `code` persistido no `PendingQuestion` | Design | Pending |
| PROG-09 | P1 Código — renderização monoespaçada + rolagem no modal | Design | Pending |
| PROG-10 | P1 Front — `SUBJECT_META` + `BACKEND_SUBJECTS` das 8 categorias | Design | Pending |
| PROG-11 | P2 Demo — banco do Mock substituído | Design | Pending |
| PROG-12 | P2 Home — subtítulo para o novo público | Design | Pending |
| PROG-13 | P2 Docs — README de questions, CONTRACT, CLAUDE/README | Design | Pending |
| PROG-14 | P3 Cenário com tema de programação | - | Pending |

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped ⚠️ (tasks na fase Tasks)

---

## Success Criteria

- [ ] Backend sobe com o banco real e lista exatamente as 8 categorias; ≥ 288 perguntas.
- [ ] Suítes de teste do back e do front verdes (inclui novos testes de `code`).
- [ ] Partida completa (fácil, normal e difícil) jogável em celular de 375 px, com código
      legível em todas as perguntas que o têm.
- [ ] Amostra do Verifier (≥ 1 pergunta por categoria/nível) sem resposta incorreta.
