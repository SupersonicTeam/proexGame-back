// Fonte de aleatoriedade injetável. Abstrair o RNG permite testes
// determinísticos das regras de jogo (injetando uma fonte fake) e mantém
// toda geração aleatória sob autoridade do servidor (RF-16).
export interface RandomSource {
  // Inteiro uniforme em [minInclusive, maxInclusive].
  int(minInclusive: number, maxInclusive: number): number;
  // Rolagem de um dado de 6 faces — açúcar para int(1, 6).
  rollD6(): number;
}

// Token de injeção do Nest para a RandomSource.
export const RANDOM_SOURCE = Symbol('RANDOM_SOURCE');
