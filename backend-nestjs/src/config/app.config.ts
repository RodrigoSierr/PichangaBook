import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_DEV_JWT_SECRET = 'pichangabook-dev-secret';

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
  }

  // --- Base de datos -------------------------------------------------------
  get databaseUrl(): string {
    return this.str('DATABASE_URL');
  }

  get databaseSsl(): boolean {
    return this.str('DATABASE_SSL') === 'true';
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
            : 'OTP_CHALLENGE_STRICT',
      firebaseEnabled: this.firebaseConfigured,
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
