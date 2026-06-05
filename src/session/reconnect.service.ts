import { Injectable } from '@nestjs/common';

// Janela de reconexão (RF-14): 5 minutos a partir da desconexão.
export const GRACE_PERIOD_MS = 5 * 60 * 1000;

// Gerencia os timers in-process do grace period de reconexão (decisão D2).
// Mantém um timer por (code, playerId); a reconexão cancela o timer e a
// expiração dispara o callback fornecido pelo chamador (gateway), que remove o
// jogador / encerra a sessão. Single-node — sem dependência de Redis keyspace.
@Injectable()
export class ReconnectService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private key(code: string, playerId: string): string {
    return `${code}:${playerId}`;
  }

  // Agenda a expiração do grace de um jogador desconectado. Substitui qualquer
  // timer anterior do mesmo jogador (evita timers órfãos em flaps de conexão).
  arm(
    code: string,
    playerId: string,
    onExpire: () => void | Promise<void>,
  ): void {
    this.cancel(code, playerId);
    const timer = setTimeout(() => {
      this.timers.delete(this.key(code, playerId));
      void onExpire();
    }, GRACE_PERIOD_MS);
    // Não segura o event loop (permite shutdown limpo e não trava testes).
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(this.key(code, playerId), timer);
  }

  // Cancela o timer de um jogador (chamado na reconexão dentro da janela).
  cancel(code: string, playerId: string): void {
    const k = this.key(code, playerId);
    const timer = this.timers.get(k);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(k);
    }
  }

  // Há um grace ativo para este jogador?
  has(code: string, playerId: string): boolean {
    return this.timers.has(this.key(code, playerId));
  }
}
