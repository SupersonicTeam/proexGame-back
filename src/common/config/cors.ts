// Resolve a origem permitida para CORS (HTTP + WebSocket) a partir do ambiente.
//
// Hardening (Sprint 4): em produção NUNCA espelhamos qualquer origem
// (`origin: true`), pois isso permitiria que qualquer site terceiro abrisse
// conexões WebSocket contra o gateway. A origem do frontend é declarada via
// FRONTEND_ORIGIN (uma URL, ou várias separadas por vírgula).
//
// - FRONTEND_ORIGIN definida  -> usa exatamente essa(s) origem(ns).
// - Sem FRONTEND_ORIGIN, em produção -> falha no boot (fail-safe).
// - Sem FRONTEND_ORIGIN, em dev/test -> espelha qualquer origem (`true`),
//   apenas para facilitar o desenvolvimento local.
export function resolveCorsOrigin(): string | string[] | boolean {
  const origins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    // Remove barra(s) final(is): o header `Origin` do browser nunca tem barra,
    // então `https://dominio/` não casaria com `https://dominio` e o WebSocket
    // seria rejeitado mesmo com a variável "definida corretamente".
    .map((origin) => origin.replace(/\/+$/, ''))
    .filter(Boolean);

  // Um valor só com vírgulas/espaços (origins vazio) é tratado como ausente,
  // caindo no fail-safe de produção em vez de retornar `[]`.
  if (origins.length > 0) {
    return origins.length === 1 ? origins[0] : origins;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FRONTEND_ORIGIN é obrigatória em produção (NODE_ENV=production) para configurar o CORS.',
    );
  }

  // Dev/test: sem domínio fixo, liberamos para o front em desenvolvimento.
  return true;
}
