import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app.config';

export type PaymentMethod = 'CARD' | 'YAPE' | 'PLIN';

export interface ChargeRequest {
  amountCents: number;
  email: string;
  method: PaymentMethod;
  /** Token generado por Culqi.js / Culqi Checkout / Yape Token en el cliente. */
  sourceId: string;
  description: string;
  metadata: Record<string, string>;
  /** Llave de idempotencia para evitar cargos duplicados ante reintentos. */
  idempotencyKey?: string;
}

export interface ChargeResult {
  id: string;
  provider: 'CULQI' | 'MERCADO_PAGO';
  status: 'succeeded' | 'pending' | 'failed';
  amountCents: number;
  currency: 'PEN';
  method: PaymentMethod;
  simulated: boolean;
  userMessage?: string;
  metadata: Record<string, string>;
}

export interface RefundRequest {
  chargeId: string;
  amountCents: number;
  reason?: 'duplicado' | 'fraudulento' | 'solicitud_comprador';
  idempotencyKey?: string;
}

export interface RefundResult {
  id: string | null;
  chargeId: string;
  amountCents: number;
  status: 'succeeded' | 'failed' | 'unverified_no_credentials';
  simulated: boolean;
  userMessage: string;
}

const VALID_SOURCE_ID_REGEX = /^(tok_|ype_|pln_)[a-zA-Z0-9_-]{4,64}$/;
const HEX_SHA256_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Pasarela Culqi (Perú): tarjetas + Yape (+ Plin vía billeteras interoperables).
 *  - Exige siempre un `sourceId` válido tokenizado en el cliente (`tok_*`, `ype_*`, `pln_*`).
 *  - Soporta llaves de idempotencia (`idempotencyKey`) tanto hacia la API de Culqi como en Sandbox.
 *  - Soporta anulación/reembolso (`refundCharge`) diferenciando entre reembolso real en Culqi
 *    (`CULQI_SECRET_KEY`), reembolso determinista en Sandbox local (`allowDemoFallback=true`)
 *    y estado no verificable (`unverified_no_credentials`) cuando no hay credenciales ni modo demo.
 */
@Injectable()
export class CulqiService {
  private readonly logger = new Logger(CulqiService.name);
  private readonly sandboxIdempotencyCache = new Map<string, ChargeResult>();
  private readonly sandboxRefundCache = new Map<string, RefundResult>();

  constructor(private readonly cfg: AppConfig) {}

  get live(): boolean {
    return this.cfg.culqiLive;
  }

  validateSourceId(sourceId: string | undefined): string {
    const trimmed = (sourceId ?? '').trim();
    if (!trimmed || !VALID_SOURCE_ID_REGEX.test(trimmed)) {
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_SOURCE',
        message: 'Se requiere un sourceId válido tokenizado por la pasarela (formato tok_*, ype_* o pln_*).',
      });
    }
    return trimmed;
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const sourceId = this.validateSourceId(req.sourceId);
    if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {
      throw new BadRequestException('Monto de cobro inválido');
    }

    if (req.idempotencyKey && !this.live) {
      const cached = this.sandboxIdempotencyCache.get(req.idempotencyKey);
      if (cached) {
        return { ...cached };
      }
    }

    const lowerSource = sourceId.toLowerCase();

    // Tokens de prueba deterministas para verificar rechazos y pagos pendientes en tests y UI
    if (
      lowerSource.includes('declined') ||
      lowerSource.includes('reject') ||
      lowerSource.includes('error') ||
      lowerSource.includes('insufficient')
    ) {
      const failedResult: ChargeResult = {
        id: `chr_declined_${randomBytes(5).toString('hex')}`,
        provider: 'CULQI',
        status: 'failed',
        amountCents: req.amountCents,
        currency: 'PEN',
        method: req.method,
        simulated: !this.live,
        userMessage: 'El pago fue rechazado por la entidad emisora o fondos insuficientes.',
        metadata: req.metadata,
      };
      if (req.idempotencyKey && !this.live) {
        this.sandboxIdempotencyCache.set(req.idempotencyKey, failedResult);
      }
      return failedResult;
    }

    if (lowerSource.includes('pending')) {
      const pendingResult: ChargeResult = {
        id: `chr_pending_${randomBytes(5).toString('hex')}`,
        provider: 'CULQI',
        status: 'pending',
        amountCents: req.amountCents,
        currency: 'PEN',
        method: req.method,
        simulated: !this.live,
        userMessage: 'El pago se encuentra pendiente de confirmación por la billetera.',
        metadata: req.metadata,
      };
      if (req.idempotencyKey && !this.live) {
        this.sandboxIdempotencyCache.set(req.idempotencyKey, pendingResult);
      }
      return pendingResult;
    }

    if (!this.live) {
      if (!this.cfg.allowDemoFallback) {
        return {
          id: 'rejected_unconfigured',
          provider: 'CULQI',
          status: 'failed',
          amountCents: req.amountCents,
          currency: 'PEN',
          method: req.method,
          simulated: false,
          userMessage: 'Pasarela de pagos no configurada (falta CULQI_SECRET_KEY).',
          metadata: req.metadata,
        };
      }
      const chargeIdPrefix = lowerSource.includes('refund_fail') ? 'chr_refund_fail_' : 'chr_sandbox_';
      const sandboxResult: ChargeResult = {
        id: `${chargeIdPrefix}${randomBytes(6).toString('hex')}`,
        provider: 'CULQI',
        status: 'succeeded',
        amountCents: req.amountCents,
        currency: 'PEN',
        method: req.method,
        simulated: true,
        userMessage: 'Cargo aprobado en entorno Sandbox de demostración.',
        metadata: req.metadata,
      };
      if (req.idempotencyKey) {
        this.sandboxIdempotencyCache.set(req.idempotencyKey, sandboxResult);
      }
      return sandboxResult;
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.cfg.culqi.secretKey}`,
        'Content-Type': 'application/json',
      };
      if (req.idempotencyKey) {
        headers['X-Culqi-Idempotency-Key'] = req.idempotencyKey;
      }

      const res = await fetch('https://api.culqi.com/v2/charges', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: req.amountCents,
          currency_code: 'PEN',
          email: req.email,
          source_id: sourceId,
          description: req.description.slice(0, 80),
          metadata: req.metadata,
        }),
      });
      const json = (await res.json()) as {
        id?: string;
        object?: string;
        outcome?: { type?: string; user_message?: string };
        user_message?: string;
      };
      const userMessage = json.outcome?.user_message ?? json.user_message;

      if (!res.ok || !json.id || json.object === 'error') {
        this.logger.warn(`Cargo rechazado por Culqi: ${userMessage ?? res.status}`);
        return {
          id: json.id ?? `chr_failed_${randomBytes(4).toString('hex')}`,
          provider: 'CULQI',
          status: 'failed',
          amountCents: req.amountCents,
          currency: 'PEN',
          method: req.method,
          simulated: false,
          userMessage: userMessage ?? 'El pago fue rechazado por Culqi.',
          metadata: req.metadata,
        };
      }

      if (json.outcome?.type === 'pendiente') {
        return {
          id: json.id,
          provider: 'CULQI',
          status: 'pending',
          amountCents: req.amountCents,
          currency: 'PEN',
          method: req.method,
          simulated: false,
          userMessage: userMessage ?? 'Pago pendiente de confirmación.',
          metadata: req.metadata,
        };
      }

      return {
        id: json.id,
        provider: 'CULQI',
        status: 'succeeded',
        amountCents: req.amountCents,
        currency: 'PEN',
        method: req.method,
        simulated: false,
        userMessage: userMessage ?? 'Cargo aprobado.',
        metadata: req.metadata,
      };
    } catch (err) {
      this.logger.error(`Error de red comunicándose con Culqi: ${(err as Error).message}`);
      return {
        id: `chr_neterr_${randomBytes(4).toString('hex')}`,
        provider: 'CULQI',
        status: 'failed',
        amountCents: req.amountCents,
        currency: 'PEN',
        method: req.method,
        simulated: false,
        userMessage: 'No se pudo contactar con la pasarela de pagos.',
        metadata: req.metadata,
      };
    }
  }

  /**
   * Ejecuta la compensación (anulación o reembolso) de un cargo cuando ocurre un conflicto
   * de concurrencia, expiración o sobrecupo.
   *  - Con `CULQI_SECRET_KEY`: invoca `POST https://api.culqi.com/v2/refunds` y verifica el resultado real.
   *  - Sin `CULQI_SECRET_KEY` y con `allowDemoFallback=true`: registra el reembolso simulado en Sandbox.
   *  - Sin `CULQI_SECRET_KEY` y sin modo demo: reporta `unverified_no_credentials` sin fingir éxito.
   */
  async refundCharge(req: RefundRequest): Promise<RefundResult> {
    const cacheKey = req.idempotencyKey || `refund:${req.chargeId}`;
    if (!this.live && this.sandboxRefundCache.has(cacheKey)) {
      return { ...this.sandboxRefundCache.get(cacheKey)! };
    }

    if (!this.live) {
      if (!this.cfg.allowDemoFallback) {
        return {
          id: null,
          chargeId: req.chargeId,
          amountCents: req.amountCents,
          status: 'unverified_no_credentials',
          simulated: false,
          userMessage:
            'Reembolso pendiente de conciliación: CULQI_SECRET_KEY no está configurado para verificar la reversa con el proveedor.',
        };
      }

      if (req.chargeId.includes('refund_fail')) {
        const failedSim: RefundResult = {
          id: null,
          chargeId: req.chargeId,
          amountCents: req.amountCents,
          status: 'failed',
          simulated: true,
          userMessage: 'Fallo simulado de reembolso en Sandbox para pruebas de conciliación.',
        };
        this.sandboxRefundCache.set(cacheKey, failedSim);
        return failedSim;
      }

      const okSim: RefundResult = {
        id: `ref_sandbox_${randomBytes(6).toString('hex')}`,
        chargeId: req.chargeId,
        amountCents: req.amountCents,
        status: 'succeeded',
        simulated: true,
        userMessage: 'Reembolso compensatorio registrado en entorno Sandbox local.',
      };
      this.sandboxRefundCache.set(cacheKey, okSim);
      return okSim;
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.cfg.culqi.secretKey}`,
        'Content-Type': 'application/json',
      };
      if (req.idempotencyKey) {
        headers['X-Culqi-Idempotency-Key'] = req.idempotencyKey;
      }

      const res = await fetch('https://api.culqi.com/v2/refunds', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: req.amountCents,
          charge_id: req.chargeId,
          reason: req.reason ?? 'solicitud_comprador',
        }),
      });
      const json = (await res.json()) as { id?: string; object?: string; user_message?: string };
      if (!res.ok || !json.id || json.object === 'error') {
        this.logger.warn(`Fallo al solicitar reembolso en Culqi para ${req.chargeId}: ${json.user_message ?? res.status}`);
        return {
          id: null,
          chargeId: req.chargeId,
          amountCents: req.amountCents,
          status: 'failed',
          simulated: false,
          userMessage: json.user_message ?? `Culqi rechazó el reembolso (HTTP ${res.status}).`,
        };
      }
      return {
        id: json.id,
        chargeId: req.chargeId,
        amountCents: req.amountCents,
        status: 'succeeded',
        simulated: false,
        userMessage: 'Reembolso confirmado por Culqi.',
      };
    } catch (err) {
      this.logger.error(`Error de red al reembolsar cargo ${req.chargeId}: ${(err as Error).message}`);
      return {
        id: null,
        chargeId: req.chargeId,
        amountCents: req.amountCents,
        status: 'failed',
        simulated: false,
        userMessage: `Error de red al solicitar reembolso: ${(err as Error).message}`,
      };
    }
  }

  sign(rawBody: string | Buffer): string {
    return createHmac('sha256', this.cfg.culqi.webhookSecret).update(rawBody).digest('hex');
  }

  verifySignature(rawBody: string | Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;
    const cleanSig = signature.trim();
    if (!HEX_SHA256_REGEX.test(cleanSig)) return false;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const given = Buffer.from(cleanSig, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Construye un evento de webhook con el formato de Culqi (data como JSON string). */
  buildWebhookEvent(charge: ChargeResult): { raw: string; signature: string } {
    const event = {
      object: 'event',
      id: `evt_${randomBytes(6).toString('hex')}`,
      type: charge.status === 'succeeded' ? 'charge.creation.succeeded' : `charge.creation.${charge.status}`,
      creation_date: Date.now(),
      data: JSON.stringify({
        object: 'charge',
        id: charge.id,
        amount: charge.amountCents,
        currency_code: charge.currency ?? 'PEN',
        source: { type: charge.method === 'CARD' ? 'card' : charge.method.toLowerCase() },
        metadata: charge.metadata,
        outcome: { type: charge.status === 'succeeded' ? 'venta_exitosa' : charge.status },
      }),
    };
    const raw = JSON.stringify(event);
    return { raw, signature: this.sign(raw) };
  }
}
