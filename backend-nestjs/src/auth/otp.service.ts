import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createVerify, randomInt } from 'node:crypto';
import { AppConfig } from '../config/app.config';
import { normalizePhone } from '../common/utils/phone.util';

interface OtpChallenge {
  code: string;
  expiresAt: number;
  attempts: number;
}

/**
 * Proveedor de OTP por SMS y verificador de tokens de Firebase Authentication.
 *
 *  - Modo productivo (`allowDemoFallback = false` o `NODE_ENV = production`):
 *    nunca registra el código OTP en logs ni lo incluye en la respuesta HTTP.
 *  - Modo demo local opt-in (`ALLOW_DEMO_FALLBACK = true` fuera de producción):
 *    incluye `devCode` / `demoOtp` para pruebas automatizadas y desarrollo local.
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

  request(phoneE164: string): { expiresInSeconds: number; devCode?: string; demoOtp?: string; provider: string } {
    const now = Date.now();
    const recent = (this.requestsLog.get(phoneE164) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= OtpService.MAX_REQUESTS_PER_10_MIN) {
      throw new HttpException('Demasiados intentos. Espera unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.requestsLog.set(phoneE164, [...recent, now]);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.challenges.set(phoneE164, { code, expiresAt: now + OtpService.TTL_MS, attempts: 0 });

    const exposeDemoOtp = this.cfg.demoMode && !this.cfg.isProduction && this.cfg.authProvider === 'DEMO';
    if (exposeDemoOtp) {
      this.logger.log(`[SMS-DEMO] OTP para ${phoneE164.slice(0, 6)}***: ${code}`);
      return {
        expiresInSeconds: OtpService.TTL_MS / 1000,
        provider: this.cfg.authProvider,
        devCode: code,
        demoOtp: code,
      };
    }

    return {
      expiresInSeconds: OtpService.TTL_MS / 1000,
      provider: this.cfg.authProvider,
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
   * Verifica criptográficamente un ID token de Firebase (RS256) validando:
   *  1. Que la integración Firebase esté configurada (`FIREBASE_PROJECT_ID` + clave pública/certificado o `firebase-admin`).
   *  2. Firma criptográfica RS256, `aud` (`projectId`), `iss` (`https://securetoken.google.com/<projectId>`) y expiración (`exp`).
   *  3. Que el token contenga un número telefónico verificado (`phone_number` en formato E.164).
   */
  async verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; phone: string }> {
    const { projectId, clientEmail, privateKey, publicKey } = this.cfg.firebase;
    if (!projectId) {
      throw new UnauthorizedException({
        code: 'FIREBASE_NOT_CONFIGURED',
        message: 'La autenticación con Firebase no está configurada en este entorno (falta FIREBASE_PROJECT_ID).',
      });
    }

    // 1. Si se dispone de clave pública / certificado PEM configurado externamente (o para verificación RS256 directa)
    if (publicKey) {
      return this.verifyRs256FirebaseJwt(idToken, projectId, publicKey);
    }

    // 2. Si se dispone de credenciales de cuenta de servicio para firebase-admin
    if (clientEmail && privateKey) {
      let admin: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        admin = require('firebase-admin');
      } catch {
        // Si firebase-admin no está instalado, intentamos verificar contra los certificados públicos X.509 de Google
        return this.verifyWithGooglePublicCerts(idToken, projectId);
      }
      if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
      }
      try {
        const decoded = await admin.auth().verifyIdToken(idToken, true);
        const normalized = decoded?.phone_number ? normalizePhone(decoded.phone_number) : null;
        if (!normalized) {
          throw new UnauthorizedException({
            code: 'FIREBASE_PHONE_UNVERIFIED',
            message: 'El token no contiene un teléfono verificado',
          });
        }
        return { uid: decoded.uid, phone: normalized };
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        throw new UnauthorizedException({
          code: 'FIREBASE_TOKEN_INVALID',
          message: `Token de Firebase inválido o expirado: ${(err as Error).message}`,
        });
      }
    }

    // 3. Verificación contra certificados X.509 públicos de Google SecureToken
    return this.verifyWithGooglePublicCerts(idToken, projectId);
  }

  private verifyRs256FirebaseJwt(idToken: string, projectId: string, pemPublicKey: string): { uid: string; phone: string } {
    const parts = (idToken ?? '').split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException({
        code: 'FIREBASE_TOKEN_MALFORMED',
        message: 'Formato de ID token de Firebase inválido.',
      });
    }
    const [rawHeader, rawPayload, rawSignature] = parts;
    let header: { alg?: string; kid?: string };
    let payload: {
      iss?: string;
      aud?: string;
      sub?: string;
      user_id?: string;
      exp?: number;
      iat?: number;
      phone_number?: string;
    };
    try {
      header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException({
        code: 'FIREBASE_TOKEN_MALFORMED',
        message: 'No se pudo decodificar el ID token de Firebase.',
      });
    }

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException({
        code: 'FIREBASE_INVALID_ALG',
        message: 'El token de Firebase debe estar firmado con RS256.',
      });
    }

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${rawHeader}.${rawPayload}`);
    verifier.end();
    const signatureValid = verifier.verify(pemPublicKey, Buffer.from(rawSignature, 'base64url'));
    if (!signatureValid) {
      throw new UnauthorizedException({
        code: 'FIREBASE_INVALID_SIGNATURE',
        message: 'La firma criptográfica del token de Firebase es inválida.',
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSeconds) {
      throw new UnauthorizedException({
        code: 'FIREBASE_TOKEN_EXPIRED',
        message: 'El token de Firebase ha expirado.',
      });
    }

    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.aud !== projectId || payload.iss !== expectedIssuer) {
      throw new UnauthorizedException({
        code: 'FIREBASE_TOKEN_AUDIENCE_MISMATCH',
        message: 'El token de Firebase no pertenece al proyecto configurado.',
      });
    }

    const uid = (payload.sub || payload.user_id || '').trim();
    if (!uid) {
      throw new UnauthorizedException({
        code: 'FIREBASE_UID_MISSING',
        message: 'El token de Firebase no incluye identificador de usuario (sub).',
      });
    }

    const normalizedPhone = payload.phone_number ? normalizePhone(payload.phone_number) : null;
    if (!normalizedPhone) {
      throw new UnauthorizedException({
        code: 'FIREBASE_PHONE_UNVERIFIED',
        message: 'El token no contiene un teléfono verificado',
      });
    }

    return { uid, phone: normalizedPhone };
  }

  private async verifyWithGooglePublicCerts(idToken: string, projectId: string): Promise<{ uid: string; phone: string }> {
    const parts = (idToken ?? '').split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Formato de ID token de Firebase inválido.');
    }
    let header: { kid?: string };
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Cabecera de token de Firebase inválida.');
    }
    if (!header.kid) {
      throw new UnauthorizedException('El token de Firebase no incluye identificador de clave (kid).');
    }
    let certs: Record<string, string>;
    try {
      const res = await fetch(
        'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      certs = (await res.json()) as Record<string, string>;
    } catch {
      throw new UnauthorizedException(
        'No se pudieron obtener los certificados públicos de Firebase y no se configuró FIREBASE_PUBLIC_KEY.',
      );
    }
    const pem = certs[header.kid];
    if (!pem) {
      throw new UnauthorizedException('Certificado público de Firebase no encontrado para el kid proporcionado.');
    }
    return this.verifyRs256FirebaseJwt(idToken, projectId, pem);
  }
}
