import { Injectable } from '@nestjs/common';

// Serialização in-process por chave (= código da sessão). Resolve o achado P2 do
// code-review da Sprint 4: o estado da sessão sofre read-modify-write
// (findByCode → mutação em memória → save) sem lock nem CAS, abrindo janela para
// lost-update e ações duplicadas sob eventos quase-simultâneos da MESMA sessão
// (ex.: double-click em rollDice, submitAnswer duplicado, disconnect concorrente).
//
// Estratégia (a) do achado: mutex in-process por `code`. Cada chave tem uma
// cadeia de Promises; uma operação só começa quando a anterior da MESMA chave
// termina (com sucesso OU erro). Sessões diferentes não se bloqueiam — uma
// cadeia independente por chave.
//
// LIMITAÇÃO DOCUMENTADA: serializa apenas DENTRO deste processo Node. Não cobre
// múltiplas instâncias do backend; para multi-instância seria necessário um lock
// distribuído (Redis) ou versão otimista (CAS por `version` no SessionState).
// Fora do escopo do projeto (evento único, single-node, ≤20 usuários — ver
// .specs/project/STATE.md). createSession permanece atômico via SET NX e não
// passa por aqui (não há estado prévio a proteger).
@Injectable()
export class SessionLock {
  // Cauda da fila por chave: a última operação enfileirada. Removida quando a
  // fila se esvazia, para o Map não crescer indefinidamente.
  private readonly tails = new Map<string, Promise<unknown>>();

  // Executa `fn` em exclusão mútua para `key`: enfileira após a operação
  // corrente da mesma chave e só roda quando ela terminar. Propaga o valor de
  // retorno (ou o erro) de `fn` ao chamador.
  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Encadeia tanto no sucesso quanto na falha da anterior, para um erro numa
    // operação não travar a fila das seguintes (só um dos callbacks roda → `fn`
    // executa exatamente uma vez).
    const run = previous.then(
      () => fn(),
      () => fn(),
    );
    this.tails.set(key, run);
    try {
      return await run;
    } finally {
      // Só limpa se ninguém enfileirou depois (a cauda ainda é esta operação);
      // caso contrário a entrada pertence à próxima operação da fila.
      if (this.tails.get(key) === run) {
        this.tails.delete(key);
      }
    }
  }
}
