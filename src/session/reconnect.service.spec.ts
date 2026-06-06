import { GRACE_PERIOD_MS, ReconnectService } from './reconnect.service';

describe('ReconnectService', () => {
  let service: ReconnectService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new ReconnectService();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('não dispara onExpire antes do fim do grace period', () => {
    const onExpire = jest.fn();
    service.arm('12345', 'a', onExpire);
    jest.advanceTimersByTime(GRACE_PERIOD_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(service.has('12345', 'a')).toBe(true);
  });

  it('dispara onExpire ao fim do grace period e limpa o timer', () => {
    const onExpire = jest.fn();
    service.arm('12345', 'a', onExpire);
    jest.advanceTimersByTime(GRACE_PERIOD_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(service.has('12345', 'a')).toBe(false);
  });

  it('cancel impede a expiração (reconexão dentro da janela)', () => {
    const onExpire = jest.fn();
    service.arm('12345', 'a', onExpire);
    jest.advanceTimersByTime(GRACE_PERIOD_MS / 2);
    service.cancel('12345', 'a');
    jest.advanceTimersByTime(GRACE_PERIOD_MS);
    expect(onExpire).not.toHaveBeenCalled();
    expect(service.has('12345', 'a')).toBe(false);
  });

  it('arm duplicado substitui o timer anterior (sem disparo duplo)', () => {
    const first = jest.fn();
    const second = jest.fn();
    service.arm('12345', 'a', first);
    service.arm('12345', 'a', second);
    jest.advanceTimersByTime(GRACE_PERIOD_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('isola timers por jogador', () => {
    const onA = jest.fn();
    const onB = jest.fn();
    service.arm('12345', 'a', onA);
    service.arm('12345', 'b', onB);
    service.cancel('12345', 'a');
    jest.advanceTimersByTime(GRACE_PERIOD_MS);
    expect(onA).not.toHaveBeenCalled();
    expect(onB).toHaveBeenCalledTimes(1);
  });
});
