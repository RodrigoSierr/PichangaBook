import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppConfig } from '../config/app.config';

interface OtpChallenge {
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * Proveedor de OTP por SMS.
 *
 * Producción: el SMS lo envía Firebase Auth (signInWithPhoneNumber desde la app
 * Flutter, con reCAPTCHA/App Check). El backend sólo verifica el ID token
 * resultante con firebase-admin (ver `verifyFirebaseIdToken`). Supabase Auth
 * (`signInWithOtp({ phone })`) es la alternativa equivalente.
 *
 * Demo: genera el código en el servidor, aplica las mismas reglas antifraude
 * (expiración, intentos, rate-limit) y lo devuelve en la respuesta / consola.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly challenges = new Map<string, OtpChallenge>();
  private readonly requestsLog = new Map<string, number[]>();

  static readonly TTL_MS = 5 * 60_000;
  static readonly MAX_ATTEMPTS = 5;
  static readonly MAX_REQUESTS_PER_10_MIN = 5;

  constructor(private readonly cfg: AppConfig) {}

  request(phoneE164: string): { expiresInSeconds: number; devCode?: string; provider: string } {
    const now = Date.now();
    const recent = (this.requestsLog.get(phoneE164) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= OtpService.MAX_REQUESTS_PER_10_MIN) {
      throw new HttpException('Demasiados intentos. Espera unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.requestsLog.set(phoneE164, [...recent, now]);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.challenges.set(phoneE164, { code, expiresAt: now + OtpService.TTL_MS, attempts: 0 });
    this.logger.log(`[SMS-DEMO] OTP para ${phoneE164.slice(0, 6)}***: ${code}`);
    return {
      expiresInSeconds: OtpService.TTL_MS / 1000,
      provider: this.cfg.authProvider,
      devCode: this.cfg.authProvider === 'DEMO' ? code : undefined,
    };
  }

  verify(phoneE164: string, code: string): void {
    const ch = this.challenges.get(phoneE164);
    if (!ch || ch.expiresAt < Date.now()) throw new UnauthorizedException('Código expirado. Solicita uno nuevo.');
    ch.attempts += 1;
    if (ch.attempts > OtpService.MAX_ATTEMPTS) {
      this.challenges.delete(phoneE164);
      throw new HttpException('Código bloqueado por intentos fallidos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (ch.code !== code) throw new UnauthorizedException('Código incorrecto');
    this.challenges.delete(phoneE164);
  }

  /**
   * Verifica un ID token de Firebase (teléfono ya validado por SMS en el cliente).
   * firebase-admin se carga de forma diferida para no pesar en modo demo:
   *   npm i firebase-admin
   */
  async verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; phone: string }> {
    let admin: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      admin = require('firebase-admin');
    } catch {
      throw new UnauthorizedException('firebase-admin no instalado (AUTH_PROVIDER=FIREBASE requiere `npm i firebase-admin`).');
    }
    if (!admin.apps.length) {
      const { projectId, clientEmail, privateKey } = this.cfg.firebase;
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
    }
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    if (!decoded.phone_number) throw new UnauthorizedException('El token no contiene un teléfono verificado');
    return { uid: decoded.uid, phone: decoded.phone_number };
  }
}
