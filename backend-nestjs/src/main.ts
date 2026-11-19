import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfig, resolveCorsOriginFromEnv } from './config/app.config';

async function bootstrap() {
  const logger = new Logger('PichangaBook');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    cors: {
      origin: resolveCorsOriginFromEnv(),
      credentials: true,
    },
  });

  // Cabeceras de seguridad HTTP estándar para producción
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
    next();
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // Archivos estáticos públicos: fotos de canchas, clips de 15-30s y vistas frontend.
  // NOTA DE SEGURIDAD: los documentos RUC/licencias se almacenan en almacenamiento privado
  // fuera de /public y NUNCA se exponen como archivos estáticos públicos.
  const backendRoot = resolve(__dirname, '..');
  const monorepoRoot = resolve(backendRoot, '..');
  const adminDir = existsSync(resolve(monorepoRoot, 'web-admin-tailwind'))
    ? resolve(monorepoRoot, 'web-admin-tailwind')
    : resolve(backendRoot, 'web-admin-tailwind');
  const mobileDir = existsSync(resolve(monorepoRoot, 'mobile-flutter'))
    ? resolve(monorepoRoot, 'mobile-flutter')
    : resolve(backendRoot, 'mobile-flutter');

  app.useStaticAssets(resolve(backendRoot, 'public'), { prefix: '/' });
  app.useStaticAssets(adminDir, { prefix: '/admin' });
  app.useStaticAssets(mobileDir, {
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
