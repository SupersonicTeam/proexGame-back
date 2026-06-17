import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { resolveCorsOrigin } from './common/config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS restrito à origem do frontend (FRONTEND_ORIGIN) em produção.
  app.enableCors({ origin: resolveCorsOrigin() });
  // Ativa os lifecycle hooks (onModuleDestroy) em SIGTERM/SIGINT: sem isto o
  // RedisModule.onModuleDestroy (client.quit) nunca roda e a conexão é abortada
  // bruscamente no shutdown do container/pm2 (achado #4 do code-review).
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
