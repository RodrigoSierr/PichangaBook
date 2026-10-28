import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app.config';

export type PaymentMethod = 'CARD' | 'YAPE' | 'PLIN';

export interface ChargeRequest {
  amountCents: number;
  email: string;
  method: PaymentMethod;
  /** Token generado por Culqi.js / Culqi Checkout (tarjeta o Yape) en el cliente. */
  sourceId?: string;
  description: string;
  metadata: Record<string, string>;
}

export interface ChargeResult {
  id: string;
  provider: 'CULQI' | 'MERCADO_PAGO';
  status: 'succeeded' | 'failed';
  amountCents: number;
  method: PaymentMethod;
  simulated: boolean;
  metadata: Record<string, string>;
}

/**
 * Pasarela Culqi (Perú): tarjetas + Yape (+ Plin vía billeteras / Mercado Pago).
 *  - Con CULQI_SECRET_KEY → POST https://api.culqi.com/v2/charges
 *  - Sin clave → cargo simulado "chr_demo_*" (mismo contrato de respuesta).
 * Los webhooks se validan con HMAC-SHA256 del cuerpo crudo.
 */
@Injectable()
export class CulqiService {
  private readonly logger = new Logger(CulqiService.name);

  constructor(private readonly cfg: AppConfig) {}

  get live(): boolean {
    return Boolean(this.cfg.culqi.secretKey);
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    if (!this.live) {
      return {
        id: `chr_demo_${randomBytes(6).toString('hex')}`,
        provider: 'CULQI',
        status: 'succeeded',
        amountCents: req.amountCents,
        method: req.method,
        simulated: true,
        metadata: req.metadata,
      };
    }
    const res = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.culqi.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: req.amountCents,
        currency_code: 'PEN',
        email: req.email,
        source_id: req.sourceId,
        description: req.description.slice(0, 80),
        metadata: req.metadata,
      }),
    });
    const json = (await res.json()) as { id?: string; outcome?: { type?: string }; user_message?: string };
    if (!res.ok || !json.id) {
      this.logger.warn(`Cargo rechazado por Culqi: ${json.user_message ?? res.status}`);
      return { id: json.id ?? 'rejected', provider: 'CULQI', status: 'failed', amountCents: req.amountCents, method: req.method, simulated: false, metadata: req.metadata };
    }
    return { id: json.id, provider: 'CULQI', status: 'succeeded', amountCents: req.amountCents, method: req.method, simulated: false, metadata: req.metadata };
  }

  sign(rawBody: string): string {
    return createHmac('sha256', this.cfg.culqi.webhookSecret).update(rawBody).digest('hex');
  }

  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const given = Buffer.from(signature, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Construye un evento de webhook con el formato de Culqi (data como JSON string). */
  buildWebhookEvent(charge: ChargeResult): { raw: string; signature: string } {
    const event = {
      object: 'event',
      id: `evt_${randomBytes(6).toString('hex')}`,
      type: 'charge.creation.succeeded',
      creation_date: Date.now(),
      data: JSON.stringify({
        object: 'charge',
        id: charge.id,
        amount: charge.amountCents,
        currency_code: 'PEN',
        source: { type: charge.method === 'CARD' ? 'card' : charge.method.toLowerCase() },
        metadata: charge.metadata,
        outcome: { type: 'venta_exitosa' },
      }),
    };
    const raw = JSON.stringify(event);
    return { raw, signature: this.sign(raw) };
  }
}
