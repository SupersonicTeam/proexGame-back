import { Provider } from '@nestjs/common';
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
    return new Redis({
      host,
      port,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  },
};
