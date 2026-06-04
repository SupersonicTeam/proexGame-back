import { randomInt } from 'crypto';
import { RandomSource } from './random.source';

// Implementação padrão usando crypto.randomInt (uniforme, sem viés de módulo).
export class DefaultRandomSource implements RandomSource {
  int(minInclusive: number, maxInclusive: number): number {
    // randomInt é [min, max) — somamos 1 para tornar o limite superior inclusivo.
    return randomInt(minInclusive, maxInclusive + 1);
  }

  rollD6(): number {
    return this.int(1, 6);
  }
}
