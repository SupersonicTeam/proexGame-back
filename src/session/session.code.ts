import { RandomSource } from '../common/random/random.source';
import { SessionRepository } from './session.repository';

const CODE_LENGTH = 5;

// Gera um código de 5 dígitos único entre as sessões ativas (RF-01).
// Em colisão com uma sessão existente, re-gera até obter um inédito.
export async function generateUniqueCode(
  repo: SessionRepository,
  rng: RandomSource,
): Promise<string> {
  // Limite defensivo: o espaço é 100k códigos e o pico é ~5 sessões,
  // então colisão é raríssima; o teto evita laço infinito teórico.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const digits = Array.from({ length: CODE_LENGTH }, () => rng.int(0, 9));
    const code = digits.join('');
    if (!(await repo.exists(code))) {
      return code;
    }
  }
  throw new Error('Não foi possível gerar um código de sessão único');
}
