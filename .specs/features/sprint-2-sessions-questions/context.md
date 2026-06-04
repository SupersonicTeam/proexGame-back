# Context — Sprint 2 (decisões do usuário)

Capturado em 2026-06-04 antes do design. Resolve as áreas cinzentas que mudam
materialmente o design e os testes.

## D1 — Movimento na resposta: **puxar a tabela §4 para a Sprint 2**

A tabela de balanceamento completa (avanço `C_d + T_p`, recuo proximal/total, tiers
de catch-up, nudge anti-encadeamento, encadeamento e clamp — RF-10/11/13) entra **agora**,
no backend da Sprint 2. A Sprint 3 fica responsável apenas pelo frontend (tabuleiro SVG
e telas de pergunta).

**Consequência:** `computeAdvance` deixa de ser o placeholder `from + value` e passa a
calcular `C_d + T_p` por dificuldade/tier. O ponto de extensão da S1 é consumido aqui.

## D2 — Reconexão/expiração: **timer in-process + TTL Redis como backstop**

- `setTimeout` de 5 min por desconexão de jogador (RF-14), cancelado na reconexão.
- TTL deslizante na chave `session:{code}` como rede de segurança caso o processo Node
  reinicie no meio do evento (alinha com a justificativa de Redis na SPEC §5).
- Adequado a single-node e ≤20 usuários simultâneos. Sem dependência de
  `notify-keyspace-events`.

## D3 — Não-repetição de perguntas (RF-09): **global por sessão**

Nenhuma pergunta é servida duas vezes na sessão inteira, para ninguém. Isso satisfaz
automaticamente "dois jogadores na mesma casa recebem perguntas diferentes" (RF-09) sem
guarda adicional. `usedQuestionIds` por jogador é mantido para auditoria/estado, mas a
**checagem de disponibilidade é a união global** dos servidos na sessão.

## Diretriz transversal — segurança ("bom padrão de segurança")

Pedido explícito do usuário. Vira critério de aceite, não item opcional:
- **RF-16 reforçado:** `correct` (e o índice correto) NUNCA saem do servidor. `questionPrompt`
  carrega só `{questionId, statement, options[]}` embaralhadas.
- Estado autoritativo da pergunta pendente (`pendingQuestion` com `correctIndex`) vive só no
  Redis/servidor; o client envia apenas `optionIndex`.
- Validação estrita de input nos DTOs (whitelist, bounds de `optionIndex`, tipos).
- `playerId` (UUIDv4 não-adivinhável) é o portador de reconexão; nunca vazar `playerId`/`socketId`
  de terceiros nos broadcasts.
- TTL no Redis limita uso de memória e remove sessões órfãs (RF-15).
- Anti-double-submit: `pendingQuestion` é limpo após processar a resposta.
