import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';

async function bootstrap() {
  const logger = new Logger('PichangaBook');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: { origin: '*', credentials: true },
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  // Archivos estáticos: fotos de canchas, clips de 15-30s, documentos RUC y vistas frontend
  const backendRoot = resolve(__dirname, '..');
  const monorepoRoot = resolve(backendRoot, '..');

  app.useStaticAssets(resolve(backendRoot, 'public'), { prefix: '/' });
  app.useStaticAssets(resolve(backendRoot, 'uploads'), { prefix: '/uploads' });
  app.useStaticAssets(resolve(monorepoRoot, 'web-admin-tailwind'), { prefix: '/admin' });
  app.useStaticAssets(resolve(monorepoRoot, 'mobile-flutter'), {
    prefix: '/mobile',
    index: 'demo-app-mobile.html',
  });

  const cfg = app.get(AppConfig);
  await app.listen(cfg.port, '0.0.0.0');

  logger.log(`====================================================================`);
  logger.log(`⚽ PichangaBook Arequipa · Backend API + Socket.io en ${cfg.publicUrl}`);
  logger.log(`   • API Health        : ${cfg.publicUrl}/api/health`);
  logger.log(`   • Panel Web Dueños  : ${cfg.publicUrl}/admin/`);
  logger.log(`   • App Móvil Espejo  : ${cfg.publicUrl}/mobile/`);
  logger.log(`====================================================================`);
}

bootstrap();
