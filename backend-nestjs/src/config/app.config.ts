import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_DEV_JWT_SECRET = 'pichangabook-dev-secret';
const DEFAULT_DEMO_WEBHOOK_SECRET = 'pichangabook-webhook-demo';

/**
 * Resuelve los orígenes permitidos para CORS a partir de variables de entorno.
 * En producción jamás permite comodín `*`: exige `CORS_ORIGINS` o restringe a `PUBLIC_URL`.
 */
export function resolveCorsOriginFromEnv(): string[] | boolean {
  const isProd = (process.env.NODE_ENV ?? 'development').trim().toLowerCase() === 'production';
  const raw = (process.env.CORS_ORIGINS ?? '').trim();
  const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`)
    .trim()
    .replace(/\/$/, '');

  if (!raw || raw === '*') {
    return isProd ? [publicUrl] : true;
  }
  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return origins.length > 0 ? origins : isProd ? [publicUrl] : true;
}

/**
 * Determina automáticamente si `pg.Pool` debe habilitar `ssl: { rejectUnauthorized: false }`
 * cuando `DATABASE_URL` pertenece a proveedores cloud serverless (`neon.tech`, `supabase.co`, `render.com`),
 * incluye `sslmode=require`, o cuando `DB_SSL` / `DATABASE_SSL` es `true`.
 */
export function shouldEnableDatabaseSsl(databaseUrl: string, explicitFlag?: string): boolean {
  const flag = (explicitFlag ?? process.env.DB_SSL ?? process.env.DATABASE_SSL ?? '').trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;

  const url = (databaseUrl ?? '').trim().toLowerCase();
  if (!url) return false;

  return (
    url.includes('sslmode=require') ||
    url.includes('sslmode=verify-') ||
    url.includes('ssl=true') ||
    url.includes('neon.tech') ||
    url.includes('supabase.co') ||
    url.includes('supabase.com') ||
    url.includes('render.com')
  );
}

/**
 * Configuración tipada de la aplicación.
 *  - Por defecto `allowDemoFallback` está DESACTIVADO (`false`): el modo demo es
 *    estrictamente opt-in (`ALLOW_DEMO_FALLBACK=true`) y sólo local (nunca en `production`).
 *  - Al iniciar en `NODE_ENV=production`, `validateStartupConfig()` exige configuración
 *    productiva válida y rechaza secretos por defecto o proveedores de demostración.
 */
@Injectable()
export class AppConfig implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.validateStartupConfig();
  }

  private str(key: string, fallback = ''): string {
    return (this.config.get<string>(key) ?? fallback).toString().trim();
  }

  get nodeEnv(): string {
    return this.str('NODE_ENV', 'development').toLowerCase();
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return Number(this.str('PORT', '3000'));
  }

  get publicUrl(): string {
    return this.str('PUBLIC_URL', `http://localhost:${this.port}`).replace(/\/$/, '');
  }

  get jwtSecret(): string {
    return this.str('JWT_SECRET', DEFAULT_DEV_JWT_SECRET);
  }

  get jwtExpiresIn(): string {
    return this.str('JWT_EXPIRES_IN', '7d');
  }

  get mediaSigningSecret(): string {
    const explicit = this.str('MEDIA_SIGNING_SECRET');
    return explicit || this.jwtSecret;
  }

  get corsOrigins(): string[] | boolean {
    const raw = this.str('CORS_ORIGINS');
    if (!raw || raw === '*') {
      return this.isProduction ? [this.publicUrl] : true;
    }
    const list = raw
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);
    return list.length > 0 ? list : this.isProduction ? [this.publicUrl] : true;
  }

  /**
   * Opt-in explícito y exclusivamente fuera de producción (`ALLOW_DEMO_FALLBACK=true` o `DEMO_MODE=true`).
   * Por defecto es `false`.
   */
  get allowDemoFallback(): boolean {
    if (this.isProduction) return false;
    const raw = this.str('ALLOW_DEMO_FALLBACK', this.str('DEMO_MODE', 'false')).toLowerCase();
    return raw === 'true' || raw === '1';
  }

  /**
   * Valida que un entorno marcado como `NODE_ENV=production` no arranque con
   * parámetros de demostración ni secretos inseguros.
   */
  validateStartupConfig(): void {
    if (!this.isProduction) return;

    const rawDemo = this.str('ALLOW_DEMO_FALLBACK', this.str('DEMO_MODE', 'false')).toLowerCase();
    if (rawDemo === 'true' || rawDemo === '1') {
      throw new Error('Configuración de producción inválida: ALLOW_DEMO_FALLBACK/DEMO_MODE no está permitido en producción.');
    }

    const secret = this.str('JWT_SECRET');
    if (!secret || secret === DEFAULT_DEV_JWT_SECRET || secret.length < 16) {
      throw new Error('Configuración de producción inválida: JWT_SECRET debe definirse con al menos 16 caracteres.');
    }

    if (this.authProvider === 'DEMO') {
      throw new Error('Configuración de producción inválida: AUTH_PROVIDER no puede ser DEMO en producción.');
    }

    if (!this.databaseUrl) {
      throw new Error('Configuración de producción inválida: DATABASE_URL es obligatorio en producción.');
    }

    const webhookSecret = this.str('CULQI_WEBHOOK_SECRET');
    if (!webhookSecret || webhookSecret === DEFAULT_DEMO_WEBHOOK_SECRET || webhookSecret.length < 16) {
      throw new Error(
        'Configuración de producción inválida: CULQI_WEBHOOK_SECRET debe definirse con un secreto seguro de al menos 16 caracteres.',
      );
    }
  }

  // --- Base de datos -------------------------------------------------------
  get databaseUrl(): string {
    return this.str('DATABASE_URL');
  }

  get databaseSsl(): boolean {
    const explicit = this.str('DB_SSL') || this.str('DATABASE_SSL');
    return shouldEnableDatabaseSsl(this.databaseUrl, explicit);
  }

  get dbAutoMigrate(): boolean {
    return this.str('DB_AUTO_MIGRATE', 'true') !== 'false';
  }

  /**
   * `seed.sql` se carga únicamente en entornos demo opt-in (o si se solicita explícitamente
   * `DB_SEED_DEMO=true` fuera de producción).
   */
  get shouldSeedDemoData(): boolean {
    if (this.isProduction) return false;
    const explicitSeed = this.str('DB_SEED_DEMO').toLowerCase();
    if (explicitSeed === 'false' || explicitSeed === '0') return false;
    if (explicitSeed === 'true' || explicitSeed === '1') return true;
    return this.allowDemoFallback;
  }

  get pgliteDataDir(): string {
    return this.str('PGLITE_DATA_DIR');
  }

  // --- Auth ----------------------------------------------------------------
  get authProvider(): 'DEMO' | 'FIREBASE' | 'SUPABASE' {
    const fallback = this.allowDemoFallback ? 'DEMO' : 'FIREBASE';
    const v = this.str('AUTH_PROVIDER', fallback).toUpperCase();
    return v === 'FIREBASE' || v === 'SUPABASE' ? v : 'DEMO';
  }

  get firebase() {
    return {
      projectId: this.str('FIREBASE_PROJECT_ID'),
      clientEmail: this.str('FIREBASE_CLIENT_EMAIL'),
      privateKey: this.str('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      publicKey: this.str('FIREBASE_PUBLIC_KEY').replace(/\\n/g, '\n'),
    };
  }

  get firebaseConfigured(): boolean {
    const f = this.firebase;
    return Boolean(f.projectId && ((f.clientEmail && f.privateKey) || f.publicKey));
  }

  // --- Integraciones -------------------------------------------------------
  get googleMapsApiKey(): string {
    return this.str('GOOGLE_MAPS_API_KEY');
  }

  get cloudinary() {
    return {
      cloudName: this.str('CLOUDINARY_CLOUD_NAME'),
      apiKey: this.str('CLOUDINARY_API_KEY'),
      apiSecret: this.str('CLOUDINARY_API_SECRET'),
    };
  }

  get cloudinaryConfigured(): boolean {
    const c = this.cloudinary;
    return Boolean(c.cloudName && c.apiKey && c.apiSecret);
  }

  get culqi() {
    return {
      publicKey: this.str('CULQI_PUBLIC_KEY'),
      secretKey: this.str('CULQI_SECRET_KEY'),
      webhookSecret: this.str('CULQI_WEBHOOK_SECRET', 'pichangabook-webhook-demo'),
    };
  }

  get culqiLive(): boolean {
    return Boolean(this.culqi.secretKey);
  }

  get mercadoPagoAccessToken(): string {
    return this.str('MERCADOPAGO_ACCESS_TOKEN');
  }

  get smsGateway() {
    return {
      url: this.str('SMS_GATEWAY_URL'),
      token: this.str('SMS_GATEWAY_TOKEN'),
      senderId: this.str('SMS_SENDER_ID', 'PichangaBook'),
    };
  }

  get smsGatewayConfigured(): boolean {
    return Boolean(this.smsGateway.url);
  }

  get demoAutoVerifySeconds(): number {
    return Number(this.str('DEMO_AUTO_VERIFY_SECONDS', '0'));
  }

  /** true sólo cuando el modo demo opt-in está activo fuera de producción. */
  get demoMode(): boolean {
    return this.allowDemoFallback && !this.isProduction;
  }

  /** Resumen transparente del modo en que opera cada subsistema. */
  get integrationStatus() {
    return {
      database: this.databaseUrl ? 'POSTGRES_SERVER' : 'PGLITE_EMBEDDED',
      auth:
        this.authProvider === 'FIREBASE' && this.firebaseConfigured
          ? 'FIREBASE_LIVE'
          : this.allowDemoFallback
            ? 'OTP_CHALLENGE_SANDBOX'
            : this.smsGatewayConfigured
              ? 'OTP_SMS_GATEWAY'
              : 'OTP_CHALLENGE_STRICT',
      firebaseEnabled: this.firebaseConfigured,
      smsGatewayEnabled: this.smsGatewayConfigured,
      payments: this.culqiLive
        ? 'CULQI_API_LIVE'
        : this.allowDemoFallback
          ? 'CULQI_SANDBOX_SIMULATOR'
          : 'DISABLED',
      media: this.cloudinaryConfigured ? 'CLOUDINARY_SIGNED' : 'PRIVATE_LOCAL_STORAGE',
      maps: this.googleMapsApiKey ? 'GOOGLE_MAPS_API' : 'HAVERSINE_OSM_FALLBACK',
    };
  }
}
