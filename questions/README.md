# Banco de perguntas — guia de autoria

Este diretório é a **fonte única do conteúdo do jogo**. Cada arquivo `*.json` aqui
vira uma **matéria** (`subject`) carregada em memória no boot pelo
`QuestionBankService` (`src/questions/question-bank.service.ts`).

> **Template para começar uma matéria nova:** copie [`TEMPLATE.json.example`](./TEMPLATE.json.example)
> para `<materia>.json` e preencha. O loader **só carrega arquivos `*.json`**, então
> o `.json.example` e este `README.md` são ignorados (não viram matéria-fantasma).

---

## Como um arquivo vira matéria

- **1 arquivo = 1 matéria.** O nome do arquivo (sem `.json`) é o `subject`.
  Ex.: `vetores.json` → `subject: "vetores"`.
- O campo `subject` de **toda** pergunta dentro do arquivo **precisa ser idêntico**
  ao nome do arquivo, senão o boot falha (fail-fast).
- A geração do tabuleiro sorteia, para cada casa-pergunta, uma matéria **uniformemente
  entre todas as carregadas** (`board.rules.generateBoard`). Logo, **todas as
  matérias carregadas devem ter perguntas suficientes** — veja "Volume" abaixo.
- Só os `*.json` **da raiz** deste diretório são carregados. Subpastas (como
  `_arquivo/`) são ignoradas.

## Schema (validado no boot — `validateFile`)

O topo do arquivo é um **array JSON**. Cada item:

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | Não-vazio. **Único em todo o banco** (ids repetidos se sobrescrevem silenciosamente). Convenção: `<prefixo>-NNNN` (ex.: `his-0001`). |
| `subject` | string | Deve ser **igual ao nome do arquivo**. |
| `difficulty` | string | **Obrigatório.** Um de `easy` \| `normal` \| `hard`. A partida só serve perguntas do nível da sessão (RF-NEW-04). |
| `statement` | string | Não-vazio. O enunciado (texto público, vai no `questionPrompt`). |
| `code` | string | **Opcional.** Pseudocódigo exibido abaixo do enunciado, em bloco monoespaçado. `\n` quebra linha; **≤ 15 linhas**, **≤ 44 caracteres por linha**, **sem tabulação** (indente com 2 espaços). `\r\n` é normalizado. Vai no `questionPrompt` só quando presente. |
| `correct` | string | Não-vazio. A alternativa correta. |
| `proximal` | string | Não-vazio. O **distrator proximal** (ver abaixo). |
| `wrong` | array | **Exatamente 2 strings.** Distratores totais (claramente errados). |

As 4 alternativas (`correct`, `proximal`, `wrong[0]`, `wrong[1]`) devem ser
**distintas** (comparação após `trim`) — senão o boot falha.

> **Segurança (RF-16):** `correct`/`proximal`/`wrong` **nunca** são enviados juntos ao
> client. Ao servir, o servidor embaralha as 4 opções e só guarda os índices da correta
> e da proximal no Redis. A ordem em que você escreve os campos no JSON **não importa**
> para o jogador.

## O distrator proximal (foco do conteúdo)

A regra de jogo distingue dois tipos de erro (SPEC §4):

- **Erro proximal** = o jogador marcou a `proximal` → recua **pouco** (1–3 casas).
- **Erro total** = marcou uma das `wrong` → recua **mais** (2–4 casas).

Portanto a `proximal` deve ser a alternativa **plausível / quase-certa** — o erro
"de quem quase sabia" (confusão clássica, conta certa com sinal trocado, conceito
parecido). As duas `wrong` devem ser distratores **claramente errados**. Capricho aqui
é o que dá valor pedagógico ao jogo.

**Exemplo bom:** "O que este algoritmo mostra?" com `code` somando de 1 a 4 →
`correct: "10"`, `proximal: "6"` (esqueceu a última volta — off-by-one),
`wrong: ["4", "1234"]`.

Erros clássicos do iniciante que dão bons `proximal`: off-by-one em laços, `=` × `<-`,
`E` × `OU`, `>` × `>=`, esquecer de incrementar, divisão inteira × real, precedência
de operadores, trocar valores sem variável auxiliar.

## Volume recomendado

O banco **não repete perguntas dentro de uma sessão** (`servedQuestionIds`) e **filtra
pelo nível da sessão** (RF-NEW-04): só contam perguntas cuja `difficulty` bate com a
dificuldade da partida. Com tabuleiros maiores no difícil (até [65,85], densidade 80%),
um tabuleiro pode ter dezenas de casas-pergunta distribuídas entre as matérias.

Para uma matéria não "esgotar" um nível no meio da partida (`pickQuestion` retorna `null`
→ a casa vira `normal`, sem travar a partida), mire em **~12 perguntas por matéria por
nível** (`easy`/`normal`/`hard`). O fallback evita softlock, mas pools magros tornam o
modo afetado pobre em perguntas.

## As categorias (lógica de programação — iniciantes 14+)

O jogo treina **lógica de programação antes da linguagem**: o foco é pensar no passo a
passo e escolher o algoritmo. Todas as categorias têm **36 perguntas (12 easy / 12 normal
/ 12 hard)**, travadas pelo content spec `src/questions/question-bank.content.spec.ts`.

| Categoria (`subject` / arquivo) | Prefixo de `id` | Conteúdo |
|---|---|---|
| `algoritmos` | `alg` | sequência de passos, entrada → processamento → saída, teste de mesa, decomposição |
| `variaveis-e-tipos` | `var` | atribuição, tipos, `div`/`mod`, precedência, troca de valores |
| `condicionais` | `cond` | `se/senao`, aninhamento, `escolha/caso`, limites de faixa |
| `operadores-logicos` | `oplog` | relacionais, `E`/`OU`/`NAO`, intervalos, De Morgan, tabela-verdade |
| `lacos-de-repeticao` | `laco` | `para`/`enquanto`/`repita`, contador, acumulador, laços aninhados |
| `vetores` | `vet` | índices, percorrer, soma/média, maior/menor, deslocamento, matrizes |
| `funcoes` | `func` | parâmetros, retorno, função × procedimento, escopo, recursão |
| `busca-e-ordenacao` | `bus` | busca linear × binária, bubble/seleção/inserção, eficiência |

**Critério de nível:**

- **easy** — conceito ou trecho de até 4 linhas, sem laço.
- **normal** — rastrear 5–10 linhas, com 1 laço ou condição composta.
- **hard** — laço aninhado, vetor + laço, função/recursão, ou escolher o algoritmo
  adequado a um problema.

**Dialeto do pseudocódigo (Portugol estilo VisuAlg, só ASCII):** `<-` atribuição;
`escreva`/`leia`; `se ... entao ... senao ... fimse`; `escolha/caso/outrocaso/fimescolha`;
`para i de 1 ate n [passo k] faca ... fimpara`; `enquanto ... faca ... fimenquanto`;
`repita ... ate`; `funcao nome(p: tipo): tipo ... retorne ... fimfuncao`;
`procedimento ... fimprocedimento`; `E`/`OU`/`NAO`; `mod`/`div`; `VERDADEIRO`/`FALSO`.
Sem boilerplate (`algoritmo`/`var`/`inicio`) salvo quando a pergunta trata disso.
Vetores declaram o intervalo no enunciado (`v[1..5]`); se omitido, base 1.

**Respostas de rastreamento** ("o que o algoritmo mostra?") devem ser conferidas à mão
(teste de mesa) antes do commit — um gabarito errado ensina errado.

As antigas matérias escolares (`matematica`, `fisica`, `quimica`, `portugues`,
`desenvolvimento-web`, `logica`, `matematica-financeira`, `conhecimentos-gerais`) estão
preservadas em `_arquivo/` e **não são carregadas**.

## Como validar o que você escreveu

A validação acontece **no boot** (fail-fast com mensagem apontando arquivo + índice):

```bash
npm run start:dev   # se algum arquivo violar o schema, o app não sobe e diz onde
```

Para isolar um diretório de perguntas alternativo (ex.: testes), use a env
`QUESTIONS_DIR`. O padrão é `<raiz>/questions`.
