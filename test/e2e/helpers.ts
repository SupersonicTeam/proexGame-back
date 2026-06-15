import { Socket } from 'socket.io-client';

// Aguarda um evento do socket (com timeout) e resolve com o payload.
export function once<T = any>(
  socket: Socket,
  event: string,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout aguardando '${event}'`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export interface OrderClient {
  socket: Socket;
  playerId: string;
}

/**
 * Inicia a partida e dirige a fase interativa de ordem (RF-04) até ela resolver.
 *
 * Os jogadores rolam SEQUENCIALMENTE, na ordem de `clients` — isso preserva o
 * determinismo dos testes com ScriptedRandom (o RNG é consumido nessa ordem,
 * idêntico ao antigo resolveOrder que rolava em ordem de jogador). Suporta
 * múltiplas rodadas de desempate.
 *
 * Os listeners são registrados ANTES de emitir `startGame`. Retorna o board e a
 * ordem final de turnos.
 */
export async function startMatch(
  host: Socket,
  clients: OrderClient[],
  timeoutMs = 10000,
): Promise<{ board: any; turnOrder: string[]; firstPlayerId: string }> {
  const boardP = once<{ board: any }>(host, 'gameStarted', timeoutMs);

  const orderP = new Promise<{ turnOrder: string[] }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout resolvendo a ordem (RF-04)')),
      timeoutMs,
    );
    const handledRounds = new Set<number>();

    const onPhase = (p: { round: number; playersToRoll: string[] }) => {
      if (handledRounds.has(p.round)) return;
      handledRounds.add(p.round);
      // Rola um jogador por vez (aguardando o orderRoll de cada), na ordem de
      // `clients`, para o consumo do RNG ser determinístico.
      void (async () => {
        for (const { socket, playerId } of clients) {
          if (!p.playersToRoll.includes(playerId)) continue;
          const rolled = once(host, 'orderRoll', timeoutMs);
          socket.emit('rollForOrder');
          await rolled;
        }
      })().catch(reject);
    };

    host.on('orderPhase', onPhase);
    host.once('orderResult', (r: { turnOrder: string[] }) => {
      clearTimeout(timer);
      host.off('orderPhase', onPhase);
      resolve(r);
    });
  });

  host.emit('startGame');
  const [boardEvt, order] = await Promise.all([boardP, orderP]);
  return {
    board: boardEvt.board,
    turnOrder: order.turnOrder,
    firstPlayerId: order.turnOrder[0],
  };
}
