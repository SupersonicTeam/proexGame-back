import { resolveCorsOrigin } from './cors';

describe('resolveCorsOrigin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isola o ambiente por teste para não vazar FRONTEND_ORIGIN/NODE_ENV.
    process.env = { ...originalEnv };
    delete process.env.FRONTEND_ORIGIN;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('retorna a origem única quando FRONTEND_ORIGIN tem uma URL', () => {
    process.env.FRONTEND_ORIGIN = 'https://jogo.exemplo.com';
    expect(resolveCorsOrigin()).toBe('https://jogo.exemplo.com');
  });

  it('retorna lista quando FRONTEND_ORIGIN tem várias origens separadas por vírgula', () => {
    process.env.FRONTEND_ORIGIN =
      'https://jogo.exemplo.com, https://staging.exemplo.com';
    expect(resolveCorsOrigin()).toEqual([
      'https://jogo.exemplo.com',
      'https://staging.exemplo.com',
    ]);
  });

  it('ignora entradas vazias e espaços na lista', () => {
    process.env.FRONTEND_ORIGIN = 'https://a.com,, , https://b.com,';
    expect(resolveCorsOrigin()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('remove a barra final para casar com o header Origin do browser', () => {
    process.env.FRONTEND_ORIGIN = 'https://jogo.exemplo.com/';
    expect(resolveCorsOrigin()).toBe('https://jogo.exemplo.com');
  });

  it('normaliza a barra final em cada origem da lista', () => {
    process.env.FRONTEND_ORIGIN =
      'https://jogo.exemplo.com/, https://staging.exemplo.com//';
    expect(resolveCorsOrigin()).toEqual([
      'https://jogo.exemplo.com',
      'https://staging.exemplo.com',
    ]);
  });

  it('libera qualquer origem (true) em dev quando FRONTEND_ORIGIN está ausente', () => {
    expect(resolveCorsOrigin()).toBe(true);
  });

  it('trata FRONTEND_ORIGIN só com vírgulas/espaços como ausente (dev: true)', () => {
    process.env.FRONTEND_ORIGIN = ', ,  ,';
    expect(resolveCorsOrigin()).toBe(true);
  });

  it('aplica fail-safe em produção quando FRONTEND_ORIGIN só tem vírgulas/espaços', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGIN = ', ,  ,';
    expect(() => resolveCorsOrigin()).toThrow(/FRONTEND_ORIGIN/);
  });

  it('falha (fail-safe) em produção quando FRONTEND_ORIGIN está ausente', () => {
    process.env.NODE_ENV = 'production';
    expect(() => resolveCorsOrigin()).toThrow(/FRONTEND_ORIGIN/);
  });

  it('aceita FRONTEND_ORIGIN em produção quando definida', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGIN = 'https://jogo.exemplo.com';
    expect(resolveCorsOrigin()).toBe('https://jogo.exemplo.com');
  });
});
