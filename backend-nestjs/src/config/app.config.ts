import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuración tipada de la aplicación.
 * Cada integración externa se activa sólo si sus credenciales existen; en caso
 * contrario el servicio correspondiente opera en MODO DEMO (simulado) para que
 * la presentación del MVP sea 100 % ejecutable sin cuentas de terceros.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  private str(key: string, fallback = ''): string {
    return (this.config.get<string>(key) ?? fallback).toString().trim();
  }

  get port(): number {
    return Number(this.str('PORT', '3000'));
  }
  get publicUrl(): string {
    return this.str('PUBLIC_URL', `http://localhost:${this.port}`).replace(/\/$/, '');
  }
  get jwtSecret(): string {
    return this.str('JWT_SECRET', 'pichangabook-dev-secret');
  }
  get jwtExpiresIn(): string {
    return this.str('JWT_EXPIRES_IN', '7d');
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
  get pgliteDataDir(): string {
    return this.str('PGLITE_DATA_DIR');
  }

  // --- Auth ----------------------------------------------------------------
  get authProvider(): 'DEMO' | 'FIREBASE' | 'SUPABASE' {
    const v = this.str('AUTH_PROVIDER', 'DEMO').toUpperCase();
    return v === 'FIREBASE' || v === 'SUPABASE' ? v : 'DEMO';
  }
  get firebase() {
    return {
      projectId: this.str('FIREBASE_PROJECT_ID'),
      clientEmail: this.str('FIREBASE_CLIENT_EMAIL'),
      privateKey: this.str('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    };
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
  get culqi() {
    return {
      publicKey: this.str('CULQI_PUBLIC_KEY'),
      secretKey: this.str('CULQI_SECRET_KEY'),
      webhookSecret: this.str('CULQI_WEBHOOK_SECRET', 'pichangabook-webhook-demo'),
    };
  }
  get mercadoPagoAccessToken(): string {
    return this.str('MERCADOPAGO_ACCESS_TOKEN');
  }
  get demoAutoVerifySeconds(): number {
    return Number(this.str('DEMO_AUTO_VERIFY_SECONDS', '8'));
  }

  /** true cuando ninguna pasarela/autenticación real está configurada. */
  get demoMode(): boolean {
    return this.authProvider === 'DEMO' || !this.culqi.secretKey;
  }
}
