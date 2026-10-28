import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { AppConfig } from '../config/app.config';

export const CLIP_MIN_SECONDS = 15;
export const CLIP_MAX_SECONDS = 30;

/**
 * Multimedia:
 *  - Clips de suplentes (15-30 s) → Cloudinary con *signed upload* directo
 *    desde la app (el video nunca pasa por nuestro servidor) y entrega
 *    optimizada: recorte a 30 s, q_auto, 480 px, códec automático (streaming ligero).
 *  - Documentos de validación (RUC / licencia) → almacenamiento privado
 *    (disco local en demo; bucket S3 privado en producción).
 */
@Injectable()
export class MediaService {
  readonly uploadsDir = resolve(__dirname, '..', '..', 'uploads');

  constructor(private readonly cfg: AppConfig) {}

  get cloudinaryEnabled(): boolean {
    const c = this.cfg.cloudinary;
    return Boolean(c.cloudName && c.apiKey && c.apiSecret);
  }

  /** Firma para subida directa a Cloudinary (spec: SHA-1 de params ordenados + api_secret). */
  signClipUpload(userId: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      folder: 'pichangabook/clips',
      public_id: `sub_${userId}_${timestamp}`,
      // Recorte y compresión en la ingesta (eager) para streaming ligero
      eager: `so_0,eo_${CLIP_MAX_SECONDS},q_auto:eco,w_480,vc_auto/mp4`,
      timestamp,
    };
    const toSign = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const { cloudName, apiKey, apiSecret } = this.cfg.cloudinary;
    const signature = createHash('sha1')
      .update(toSign + (apiSecret || 'demo-secret'))
      .digest('hex');
    return {
      provider: this.cloudinaryEnabled ? 'CLOUDINARY' : 'LOCAL_DEMO',
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName || 'demo'}/video/upload`,
      apiKey: apiKey || 'demo',
      signature,
      ...params,
      constraints: { minSeconds: CLIP_MIN_SECONDS, maxSeconds: CLIP_MAX_SECONDS, maxSizeMb: 40 },
    };
  }

  /** URL de streaming optimizada para un public_id de Cloudinary. */
  cloudinaryClipUrl(publicId: string): { url: string; poster: string } {
    const cloud = this.cfg.cloudinary.cloudName || 'demo';
    const base = `https://res.cloudinary.com/${cloud}/video/upload`;
    return {
      url: `${base}/so_0,eo_${CLIP_MAX_SECONDS},q_auto:eco,w_480,vc_auto/${publicId}.mp4`,
      poster: `${base}/so_2,w_480,q_auto/${publicId}.jpg`,
    };
  }

  assertClipDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < CLIP_MIN_SECONDS || seconds > CLIP_MAX_SECONDS) {
      throw new BadRequestException(
        `El clip debe durar entre ${CLIP_MIN_SECONDS} y ${CLIP_MAX_SECONDS} segundos (recibido: ${seconds}s).`,
      );
    }
  }

  /** Guarda un documento de validación (PDF/JPG/PNG). */
  saveVerificationDocument(complexId: string, file: { originalname: string; buffer: Buffer; mimetype: string }) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Formato no permitido. Sube PDF, JPG o PNG.');
    }
    const dir = resolve(this.uploadsDir, 'complex-docs', complexId);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}${extname(file.originalname) || '.pdf'}`;
    writeFileSync(resolve(dir, name), file.buffer);
    // En producción: PutObject a S3 privado (SSE-S3) y URL prefirmada de 5 min para el revisor.
    return `/uploads/complex-docs/${complexId}/${name}`;
  }
}
