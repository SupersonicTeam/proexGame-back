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

O banco **não repete perguntas dentro de uma sessão** (`servedQuestionIds`). Um tabuleiro
pode ter até ~24 casas-pergunta, distribuídas entre as 10 matérias. Para uma matéria não
"esgotar" no meio da partida (`pickQuestion` retorna `null`), mire em **~20 perguntas por
matéria** (mínimo confortável; "dezenas" do spec). Menos que isso funciona para o evento
único de ≤20 usuários, mas reduz a folga.

## As 10 matérias (a confirmar pelo Murilo)

Sugestão de conjunto + prefixo de `id` (ajuste à vontade ao decidir o conteúdo):

| Matéria (`subject` / nome do arquivo) | Prefixo de `id` | Status |
|---|---|---|
| `matematica` | `mat` | ✅ existe (5 perguntas — expandir) |
| `portugues` | `por` | ✅ existe (5 perguntas — expandir) |
| `historia` | `his` | ⬜ a criar |
| `geografia` | `geo` | ⬜ a criar |
| `biologia` | `bio` | ⬜ a criar |
| `fisica` | `fis` | ⬜ a criar |
| `quimica` | `qui` | ⬜ a criar |
| `ingles` | `ing` | ⬜ a criar |
| `artes` | `art` | ⬜ a criar |
| `filosofia` | `fil` | ⬜ a criar |

## Como validar o que você escreveu

A validação acontece **no boot** (fail-fast com mensagem apontando arquivo + índice):

```bash
npm run start:dev   # se algum arquivo violar o schema, o app não sobe e diz onde
```

Para isolar um diretório de perguntas alternativo (ex.: testes), use a env
`QUESTIONS_DIR`. O padrão é `<raiz>/questions`.
