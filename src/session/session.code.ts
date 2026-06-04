import { RandomSource } from '../common/random/random.source';

const CODE_LENGTH = 5;

// Gera um código de 5 dígitos (com zero-padding). A UNICIDADE não é garantida aqui:
// é assegurada na escrita atômica (SessionRepository.createIfAbsent via SET NX),
// que elimina a corrida entre `exists` e `create` sob concorrência.
//
// Nota de contrato: o valor do código é só os 5 dígitos (ex.: "12345"). O prefixo
// "#" usado na documentação (`#NNNNN`) é apenas apresentação na UI — não faz parte
// do `code` trafegado nos eventos WS nem da chave no Redis.
export function generateCode(rng: RandomSource): string {
  const digits = Array.from({ length: CODE_LENGTH }, () => rng.int(0, 9));
  return digits.join('');
}
