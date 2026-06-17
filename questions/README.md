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
  Ex.: `historia.json` → `subject: "historia"`.
- O campo `subject` de **toda** pergunta dentro do arquivo **precisa ser idêntico**
  ao nome do arquivo, senão o boot falha (fail-fast).
- A geração do tabuleiro sorteia, para cada casa-pergunta, uma matéria **uniformemente
  entre todas as carregadas** (`board.rules.generateBoard`). Logo, **todas as 10
  matérias devem existir e ter perguntas suficientes** — veja "Volume" abaixo.

## Schema (validado no boot — `validateFile`)

O topo do arquivo é um **array JSON**. Cada item:

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | Não-vazio. **Único em todo o banco** (ids repetidos se sobrescrevem silenciosamente). Convenção: `<prefixo>-NNNN` (ex.: `his-0001`). |
| `subject` | string | Deve ser **igual ao nome do arquivo**. |
| `difficulty` | string | **Obrigatório.** Um de `easy` \| `normal` \| `hard`. A partida só serve perguntas do nível da sessão (RF-NEW-04). |
| `statement` | string | Não-vazio. O enunciado (texto público, vai no `questionPrompt`). |
| `correct` | string | Não-vazio. A alternativa correta. |
| `proximal` | string | Não-vazio. O **distrator proximal** (ver abaixo). |
| `wrong` | array | **Exatamente 2 strings.** Distratores totais (claramente errados). |

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

**Exemplo bom:** "Quanto é 7 × 8?" → `correct: "56"`, `proximal: "54"` (erro comum de
tabuada), `wrong: ["48", "63"]`.

## Volume recomendado

O banco **não repete perguntas dentro de uma sessão** (`servedQuestionIds`) e **filtra
pelo nível da sessão** (RF-NEW-04): só contam perguntas cuja `difficulty` bate com a
dificuldade da partida. Com tabuleiros maiores no difícil (até [65,85], densidade 80%),
um tabuleiro pode ter dezenas de casas-pergunta distribuídas entre as matérias.

Para uma matéria não "esgotar" um nível no meio da partida (`pickQuestion` retorna `null`
→ a casa vira `normal`, sem travar a partida), mire em **~12 perguntas por matéria por
nível** (`easy`/`normal`/`hard`). O fallback evita softlock, mas pools magros tornam o
modo afetado pobre em perguntas.

> **Status da expansão:** concluída — as 8 matérias têm os 3 níveis preenchidos
> (ver `.specs/features/difficulty-scaling/spec.md`).

## As matérias (turma do 2º ano — curso de programação)

Conjunto definido para o público (2º ano do ensino médio, curso de programação).
Meta por nível: **~12 perguntas por matéria por dificuldade**. Exceto `matematica`
(24 perguntas), todas têm 36 (12 easy / 12 normal / 12 hard).

| Matéria (`subject` / nome do arquivo) | Prefixo de `id` | Status |
|---|---|---|
| `matematica` | `mat` | ✅ 24 (8 / 8 / 8) |
| `desenvolvimento-web` (HTML + CSS + JS básico) | `web` | ✅ 36 (12 / 12 / 12) |
| `logica` | `log` | ✅ 36 (12 / 12 / 12) |
| `quimica` | `qui` | ✅ 36 (12 / 12 / 12) |
| `fisica` | `fis` | ✅ 36 (12 / 12 / 12) |
| `matematica-financeira` | `fin` | ✅ 36 (12 / 12 / 12) |
| `conhecimentos-gerais` | `ger` | ✅ 36 (12 / 12 / 12) |
| `portugues` | `por` | ✅ 36 (12 / 12 / 12) |

## Como validar o que você escreveu

A validação acontece **no boot** (fail-fast com mensagem apontando arquivo + índice):

```bash
npm run start:dev   # se algum arquivo violar o schema, o app não sobe e diz onde
```

Para isolar um diretório de perguntas alternativo (ex.: testes), use a env
`QUESTIONS_DIR`. O padrão é `<raiz>/questions`.
