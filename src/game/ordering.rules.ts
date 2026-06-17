// ---------------------------------------------------------------------------
// Fase de ordenação INTERATIVA (RF-04). Cada jogador rola o d6 para definir a
// ordem de turnos: maior valor começa; empate → os empatados rolam de novo,
// apenas entre si, em rodadas sucessivas, até não restar empate.
//
// Funções PURAS (sem I/O, sem rng): o GameService rola o dado e chama
// `recordOrderRoll`/`resolveRound`. `groups` é uma partição ORDENADA dos
// jogadores — grupos mais à frente na lista ficam à frente na ordem final.
// Um grupo com >1 jogador ainda está empatado (precisa rolar); um grupo de 1
// já está resolvido. A ordenação termina quando TODOS os grupos têm tamanho 1.
// ---------------------------------------------------------------------------

import { OrderingState, Roll } from '../session/session.types';

// Inicia a ordenação: todos no mesmo grupo (empatados em "desconhecido"), rodada 1.
export function startOrdering(playerIds: string[]): OrderingState {
  return {
    groups: [[...playerIds]],
    currentRolls: {},
    round: 1,
    history: [],
  };
}

// Jogadores que ainda precisam rolar nesta rodada (estão em grupos empatados).
export function playersToRoll(ordering: OrderingState): string[] {
  return ordering.groups.filter((group) => group.length > 1).flat();
}

// Este jogador já rolou na rodada atual?
export function hasRolled(ordering: OrderingState, playerId: string): boolean {
  return playerId in ordering.currentRolls;
}

// Registra a rolagem de um jogador na rodada atual (imutável).
export function recordOrderRoll(
  ordering: OrderingState,
  playerId: string,
  value: number,
): OrderingState {
  return {
    ...ordering,
    currentRolls: { ...ordering.currentRolls, [playerId]: value },
  };
}

// Todos os jogadores que precisavam rolar nesta rodada já rolaram?
export function isRoundComplete(ordering: OrderingState): boolean {
  const need = playersToRoll(ordering);
  return need.length > 0 && need.every((id) => id in ordering.currentRolls);
}

// A ordenação está totalmente resolvida (nenhum grupo empatado)?
export function isOrderingResolved(ordering: OrderingState): boolean {
  return ordering.groups.every((group) => group.length === 1);
}

/**
 * Aplica a rodada completa: sub-particiona cada grupo empatado pelos valores
 * rolados (do maior para o menor); grupos de 1 mantêm a posição. Arquiva as
 * rolagens da rodada em `history`, zera `currentRolls` e incrementa `round`.
 * Pré-condição: `isRoundComplete(ordering)`.
 */
export function resolveRound(ordering: OrderingState): OrderingState {
  // Rolagens desta rodada, na ordem dos grupos (para animação/orderResult).
  const roundRolls: Roll[] = playersToRoll(ordering).map((playerId) => ({
    playerId,
    value: ordering.currentRolls[playerId],
  }));

  const newGroups: string[][] = [];
  for (const group of ordering.groups) {
    if (group.length === 1) {
      newGroups.push(group);
      continue;
    }
    // Sub-particiona o grupo empatado pelos valores rolados, desc.
    const byValue = new Map<number, string[]>();
    for (const id of group) {
      const value = ordering.currentRolls[id];
      const bucket = byValue.get(value) ?? [];
      bucket.push(id);
      byValue.set(value, bucket);
    }
    for (const value of [...byValue.keys()].sort((a, b) => b - a)) {
      newGroups.push(byValue.get(value) as string[]);
    }
  }

  return {
    groups: newGroups,
    currentRolls: {},
    round: ordering.round + 1,
    history: [...ordering.history, roundRolls],
  };
}

// Ordem de turnos final — válida apenas quando `isOrderingResolved`.
export function orderingTurnOrder(ordering: OrderingState): string[] {
  return ordering.groups.flat();
}
