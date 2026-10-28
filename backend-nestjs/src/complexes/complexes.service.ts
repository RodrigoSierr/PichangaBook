import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AppConfig } from '../config/app.config';
import { MapsService } from '../integrations/maps.service';
import { MediaService } from '../integrations/media.service';
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { AuthUser } from '../common/types';
import { isValidRuc } from '../common/utils/ruc.util';
import { isPgError, PG_UNIQUE_VIOLATION } from '../common/utils/pg-errors';
import { CreateComplexDto, ListComplexesQuery, ReviewDto, VerificationDto } from './dto/complexes.dto';
import { AvailabilityService } from './availability.service';

const COMPLEX_COLUMNS = `x.id, x.name, x.district_code AS "districtCode", d.name AS "districtName",
  x.address, x.lat::float AS lat, x.lng::float AS lng, x.photos, x.amenities,
  x.verification_status AS "verificationStatus", r.rating_avg::float AS rating,
  r.reviews_count::int AS "reviewsCount",
  (SELECT MIN(c.price_cents) FROM courts c WHERE c.complex_id = x.id AND c.is_active)::int AS "minPriceCents",
  (SELECT COUNT(*) FROM courts c WHERE c.complex_id = x.id AND c.is_active)::int AS "courtsCount"`;

@Injectable()
export class ComplexesService {
  private readonly logger = new Logger(ComplexesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly maps: MapsService,
    private readonly media: MediaService,
    private readonly bus: RealtimeBus,
    private readonly cfg: AppConfig,
    private readonly availability: AvailabilityService,
  ) {}

  /** Distritos de Arequipa con número de complejos verificados (chips del mapa). */
  districts() {
    return this.db.query(
      `SELECT d.code, d.name, d.lat::float AS lat, d.lng::float AS lng, d.is_key_zone AS "isKeyZone",
              COUNT(x.id) FILTER (WHERE x.verification_status = 'VERIFIED')::int AS "complexesCount"
         FROM districts d LEFT JOIN complexes x ON x.district_code = d.code
        GROUP BY d.code ORDER BY d.is_key_zone DESC, d.name`,
    );
  }

  /** Pines del mapa: sólo complejos con RUC/licencia VERIFICADOS (antifraude). */
  async list(q: ListComplexesQuery) {
    const params: unknown[] = [];
    const where = [`x.verification_status = 'VERIFIED'`];
    if (q.district && q.district !== 'ALL') {
      params.push(q.district.toUpperCase());
      where.push(`x.district_code = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(x.name ILIKE $${params.length} OR x.address ILIKE $${params.length})`);
    }
    const rows = await this.db.query<{ lat: number; lng: number; distanceKm?: number }>(
      `SELECT ${COMPLEX_COLUMNS}
         FROM complexes x
         JOIN districts d ON d.code = x.district_code
         JOIN v_complex_ratings r ON r.complex_id = x.id
        WHERE ${where.join(' AND ')}
        ORDER BY r.rating_avg DESC`,
      params,
    );
    if (q.lat !== undefined && q.lng !== undefined) {
      const origin = { lat: Number(q.lat), lng: Number(q.lng) };
      rows.forEach((r) => (r.distanceKm = MapsService.haversineKm(origin, r)));
      rows.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }
    return rows;
  }

  async detail(id: string) {
    const complex = await this.db.one(
      `SELECT ${COMPLEX_COLUMNS}, u.full_name AS "ownerName"
         FROM complexes x
         JOIN districts d ON d.code = x.district_code
         JOIN v_complex_ratings r ON r.complex_id = x.id
         JOIN users u ON u.id = x.owner_id
        WHERE x.id = $1`,
      [id],
    );
    if (!complex) throw new NotFoundException('Complejo no encontrado');
    const [courts, reviews] = await Promise.all([
      this.availability.courtsOfComplex(id),
      this.db.query(
        `SELECT rv.id, rv.rating, rv.comment, rv.created_at AS "createdAt",
                split_part(u.full_name, ' ', 1) || ' ' || left(split_part(u.full_name, ' ', 2), 1) || '.' AS author
           FROM reviews rv JOIN users u ON u.id = rv.user_id
          WHERE rv.complex_id = $1 ORDER BY rv.created_at DESC LIMIT 20`,
        [id],
      ),
    ]);
    return { ...complex, courts, reviews };
  }

  async addReview(complexId: string, user: AuthUser, dto: ReviewDto) {
    try {
      return await this.db.one(
        `INSERT INTO reviews (complex_id, user_id, rating, comment) VALUES ($1, $2, $3, $4)
         RETURNING id, rating, comment, created_at AS "createdAt"`,
        [complexId, user.sub, dto.rating, dto.comment ?? null],
      );
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new ConflictException('Ya dejaste una reseña para este complejo');
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Dueños: alta de complejo + validación documental (RUC / licencia)
  // ---------------------------------------------------------------------------
  async create(owner: AuthUser, dto: CreateComplexDto) {
    if (!isValidRuc(dto.ruc)) {
      throw new BadRequestException({ code: 'INVALID_RUC', message: 'RUC inválido (dígito verificador SUNAT no coincide).' });
    }
    const district = await this.db.one<{ lat: string; lng: string }>(`SELECT lat, lng FROM districts WHERE code = $1`, [
      dto.districtCode,
    ]);
    if (!district) throw new BadRequestException('Distrito no soportado en Arequipa');

    let { lat, lng } = dto;
    if (lat === undefined || lng === undefined) {
      const geo = await this.maps.geocode(dto.address, { lat: Number(district.lat), lng: Number(district.lng) });
      ({ lat, lng } = geo);
    }
    try {
      return await this.db.one(
        `INSERT INTO complexes (owner_id, name, ruc, business_name, district_code, address, lat, lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, ruc, verification_status AS "verificationStatus", lat::float, lng::float`,
        [owner.sub, dto.name, dto.ruc, dto.businessName ?? null, dto.districtCode, dto.address, lat, lng],
      );
    } catch (e) {
      if (isPgError(e, PG_UNIQUE_VIOLATION)) throw new ConflictException('Este RUC ya está registrado en PichangaBook');
      throw e;
    }
  }

  async assertOwner(complexId: string, user: AuthUser): Promise<{ id: string; name: string; ownerId: string }> {
    const row = await this.db.one<{ id: string; name: string; ownerId: string }>(
      `SELECT id, name, owner_id AS "ownerId" FROM complexes WHERE id = $1`,
      [complexId],
    );
    if (!row) throw new NotFoundException('Complejo no encontrado');
    if (row.ownerId !== user.sub && user.role !== 'ADMIN') throw new ForbiddenException('No eres dueño de este complejo');
    return row;
  }

  async uploadVerificationDocument(
    complexId: string,
    user: AuthUser,
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    await this.assertOwner(complexId, user);
    if (!file) throw new BadRequestException('Adjunta el PDF/imagen de tu ficha RUC o licencia municipal');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('Máximo 5 MB');
    const url = this.media.saveVerificationDocument(complexId, file);
    const updated = await this.db.one(
      `UPDATE complexes SET license_doc_url = $2, license_doc_uploaded_at = now(),
              verification_status = 'IN_REVIEW', verification_notes = NULL
        WHERE id = $1
        RETURNING id, verification_status AS "verificationStatus", license_doc_url AS "licenseDocUrl"`,
      [complexId, url],
    );
    this.bus.publish(Rooms.complex(complexId), 'complex:verification', updated);

    // DEMO: simula la revisión del backoffice (en producción la hace un admin + consulta SUNAT)
    const secs = this.cfg.demoAutoVerifySeconds;
    if (this.cfg.demoMode && secs > 0) {
      setTimeout(() => {
        this.setVerification(complexId, { status: 'VERIFIED', notes: 'Validado automáticamente (demo)' }).catch((e) =>
          this.logger.error(e),
        );
      }, secs * 1000);
    }
    return updated;
  }

  async setVerification(complexId: string, dto: VerificationDto) {
    const updated = await this.db.one(
      `UPDATE complexes SET verification_status = $2::verification_status, verification_notes = $3,
              verified_at = CASE WHEN $2::verification_status = 'VERIFIED' THEN now() ELSE NULL END
        WHERE id = $1
        RETURNING id, name, verification_status AS "verificationStatus", verification_notes AS "verificationNotes"`,
      [complexId, dto.status, dto.notes ?? null],
    );
    if (!updated) throw new NotFoundException();
    this.bus.publish(Rooms.complex(complexId), 'complex:verification', updated);
    return updated;
  }
}
