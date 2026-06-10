import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { resolveCorsOrigin } from './common/config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS restrito à origem do frontend (FRONTEND_ORIGIN) em produção.
  app.enableCors({ origin: resolveCorsOrigin() });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
