import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { AppConfig } from '../config/app.config';

export const CLIP_MIN_SECONDS = 15;
export const CLIP_MAX_SECONDS = 30;
export const MAX_VERIFICATION_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Multimedia y Documentos Privados:
 *  - Clips de suplentes (15-30 s) → Cloudinary con *signed upload* directo.
 *  - Documentos de validación (RUC / licencia municipal) → almacenamiento privado
 *    fuera de `public/` (`private-storage/complex-docs`), inaccesible por URL pública,
 *    con descarga protegida por ownership (`OWNER`/`ADMIN`) o URL temporal firmada con HMAC.
 */
@Injectable()
export class MediaService {
  readonly privateDocsDir = resolve(__dirname, '..', '..', 'private-storage', 'complex-docs');

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

  /**
   * Guarda un documento de validación (PDF/JPG/PNG/WEBP) en almacenamiento privado
   * fuera de cualquier ruta estática pública.
   */
  saveVerificationDocument(
    complexId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string; size?: number },
  ): { storageKey: string; fileName: string } {
    const allowed: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const ext = allowed[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Formato no permitido. Sube PDF, JPG, PNG o WEBP.');
    }
    const byteLength = file.size ?? file.buffer?.length ?? 0;
    if (byteLength <= 0 || byteLength > MAX_VERIFICATION_DOC_BYTES) {
      throw new BadRequestException('El documento excede el límite máximo permitido de 5 MB.');
    }
    const safeComplexId = basename(complexId).replace(/[^a-zA-Z0-9-]/g, '');
    const dir = resolve(this.privateDocsDir, safeComplexId);
    mkdirSync(dir, { recursive: true });

    const rawExt = extname(file.originalname || '').toLowerCase();
    const finalExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(rawExt) ? rawExt : ext;
    const fileName = `${Date.now()}-${randomBytes(6).toString('hex')}${finalExt}`;
    writeFileSync(resolve(dir, fileName), file.buffer, { mode: 0o600 });

    return {
      storageKey: `private://complex-docs/${safeComplexId}/${fileName}`,
      fileName,
    };
  }

  extractFileNameFromKey(storageKey: string | null | undefined): string | null {
    if (!storageKey) return null;
    const parts = storageKey.split('/');
    const last = parts[parts.length - 1];
    if (!last || last.includes('..')) return null;
    return basename(last);
  }

  private signDocumentToken(complexId: string, fileName: string, expiresEpochSec: number): string {
    return createHmac('sha256', this.cfg.jwtSecret)
      .update(`doc:${complexId}:${fileName}:${expiresEpochSec}`)
      .digest('hex');
  }

  /**
   * Genera una URL firmada temporal (por defecto 5 minutos) para consultar el documento privado.
   */
  createSignedDocumentUrl(complexId: string, fileName: string, ttlSeconds = 300): {
    url: string;
    expiresAt: string;
    expiresInSeconds: number;
  } {
    const expiresEpochSec = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.signDocumentToken(complexId, fileName, expiresEpochSec);
    const url = `/api/complexes/${encodeURIComponent(complexId)}/verification-document/download?file=${encodeURIComponent(fileName)}&expires=${expiresEpochSec}&sig=${sig}`;
    return {
      url,
      expiresAt: new Date(expiresEpochSec * 1000).toISOString(),
      expiresInSeconds: ttlSeconds,
    };
  }

  verifySignedDocumentAccess(
    complexId: string,
    fileName: string,
    expiresRaw?: string,
    sigRaw?: string,
  ): boolean {
    if (!expiresRaw || !sigRaw) return false;
    const expiresEpochSec = Number(expiresRaw);
    if (!Number.isInteger(expiresEpochSec) || expiresEpochSec <= Math.floor(Date.now() / 1000)) {
      return false;
    }
    const cleanSig = sigRaw.trim();
    if (!/^[0-9a-f]{64}$/i.test(cleanSig)) return false;
    const expected = Buffer.from(this.signDocumentToken(complexId, fileName, expiresEpochSec), 'hex');
    const given = Buffer.from(cleanSig, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  readPrivateVerificationDocument(complexId: string, fileName: string): {
    buffer: Buffer;
    contentType: string;
    fileName: string;
  } {
    const safeComplexId = basename(complexId).replace(/[^a-zA-Z0-9-]/g, '');
    const safeFileName = basename(fileName);
    if (!safeFileName || safeFileName !== fileName || safeFileName.includes('..')) {
      throw new ForbiddenException('Nombre de documento inválido.');
    }
    const fullPath = resolve(this.privateDocsDir, safeComplexId, safeFileName);
    if (!existsSync(fullPath)) {
      throw new NotFoundException('Documento de verificación no encontrado en almacenamiento privado.');
    }
    const ext = extname(safeFileName).toLowerCase();
    const contentType =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg';
    return {
      buffer: readFileSync(fullPath),
      contentType,
      fileName: safeFileName,
    };
  }
}
