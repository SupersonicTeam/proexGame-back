import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

// Cria o cliente ioredis a partir de variáveis de ambiente.
// O mesmo binário roda local (127.0.0.1) e em Docker/VPS (host do serviço `redis`)
// apenas trocando REDIS_HOST/REDIS_PORT — sem recompilar.
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    const client = new Redis({
      host,
      port,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    // ioredis EMITE 'error' de forma assíncrona; sem um listener a falha vira
    // unhandled e some sem rastro. Logamos para o operador enxergar quedas do
    // Redis (achado #5 do code-review). O reconnect automático do ioredis cuida
    // da recuperação — aqui só observabilidade, não relançamos.
    const logger = new Logger('RedisClient');
    client.on('error', (err: Error) => {
      logger.error(`Erro na conexão com o Redis: ${err.message}`);
    });
    return client;
  },
};
