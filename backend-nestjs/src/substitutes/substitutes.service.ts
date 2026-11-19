import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { MediaService } from '../integrations/media.service';
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { AuthUser } from '../common/types';
import { redactContactInfo } from '../common/utils/phone.util';
import {
  InviteSubstituteDto,
  ListSubstitutesQueryDto,
  RespondInvitationDto,
  UpsertSubstituteProfileDto,
} from './dto/substitutes.dto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SubstitutesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
    private readonly bus: RealtimeBus,
  ) {}

  async list(filters: ListSubstitutesQueryDto) {
    const params: unknown[] = [];
    const where = [`sp.is_available = TRUE`];

    if (filters.position && filters.position !== 'ALL') {
      params.push(filters.position.toUpperCase());
      where.push(`sp.position = $${params.length}::player_position`);
    }
    if (filters.district && filters.district !== 'ALL') {
      params.push(filters.district.toUpperCase());
      where.push(`sp.district_code = $${params.length}`);
    }
    if (filters.onlyVerified === 'true') {
      where.push(`sp.is_verified = TRUE`);
    }
    if (filters.minSkill !== undefined && Number.isFinite(Number(filters.minSkill))) {
      params.push(Number(filters.minSkill));
      where.push(`sp.skill_level >= $${params.length}`);
    }

    return this.db.query(
      `SELECT sp.id, sp.user_id AS "userId", u.full_name AS "fullName",
              u.phone_masked AS "phoneMasked", u.trust_score AS "trustScore",
              sp.position, sp.skill_level AS "skillLevel",
              sp.punctuality_score::float AS "punctualityScore",
              sp.matches_played AS "matchesPlayed", sp.no_shows AS "noShows",
              sp.district_code AS "districtCode", d.name AS "districtName",
              sp.bio, sp.clip_provider AS "clipProvider", sp.clip_public_id AS "clipPublicId",
              sp.clip_url AS "clipUrl", sp.clip_poster_url AS "clipPosterUrl",
              sp.clip_duration_s AS "clipDurationS",
              sp.is_verified AS "isVerified", sp.is_available AS "isAvailable"
         FROM substitute_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN districts d ON d.code = sp.district_code
        WHERE ${where.join(' AND ')}
        ORDER BY sp.is_verified DESC, sp.punctuality_score DESC`,
      params,
    );
  }

  signClipUpload(user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para obtener firma de subida.');
    return this.media.signClipUpload(user.sub);
  }

  uploadClipFile(
    user: AuthUser,
    file: { originalname: string; buffer: Buffer; mimetype: string; size?: number } | undefined,
  ) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para subir tu clip de video.');
    return this.media.saveSubstituteClipFile(user.sub, file);
  }

  /**
   * Crea o actualiza el perfil de suplente del usuario autenticado (`POST /api/substitutes/profile`),
   * validando la duración del clip (15-30s) con `MediaService.assertClipDuration` y generando
   * las URLs de streaming y póster desde Cloudinary con `MediaService.cloudinaryClipUrl`.
   */
  async upsertProfile(user: AuthUser, dto: UpsertSubstituteProfileDto) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para registrar tu perfil de suplente.');

    let districtCode: string | null = null;
    if (dto.districtCode) {
      const normalizedDistrict = dto.districtCode.trim().toUpperCase();
      const dist = await this.db.one<{ code: string }>(
        `SELECT code FROM districts WHERE code = $1`,
        [normalizedDistrict],
      );
      if (!dist) {
        throw new BadRequestException('Distrito no soportado en Arequipa');
      }
      districtCode = dist.code;
    }

    if (dto.clipDurationSeconds !== undefined) {
      this.media.assertClipDuration(dto.clipDurationSeconds);
    }

    const clipProvider = this.media.cloudinaryEnabled ? 'CLOUDINARY' : 'LOCAL_DEMO';
    let clipPublicId: string | null = dto.clipPublicId?.trim() || null;
    let clipUrl: string | null = dto.clipUrl?.trim() || null;
    let clipPosterUrl: string | null = dto.clipPosterUrl?.trim() || null;

    if (clipPublicId) {
      const derived = this.media.cloudinaryClipUrl(clipPublicId);
      clipUrl = clipUrl || derived.url;
      clipPosterUrl = clipPosterUrl || derived.poster;
    }

    const skillLevel = dto.skillLevel ?? 3;
    const bio = dto.bio?.trim() || null;
    const clipDurationS = dto.clipDurationSeconds ?? null;
    const isAvailable = dto.isAvailable ?? true;

    return this.db.one(
      `INSERT INTO substitute_profiles (
         user_id, position, skill_level, district_code, bio,
         clip_provider, clip_public_id, clip_url, clip_poster_url, clip_duration_s, is_available
       )
       VALUES ($1, $2::player_position, $3, $4, $5, $6::media_provider, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id) DO UPDATE
         SET position = EXCLUDED.position,
             skill_level = EXCLUDED.skill_level,
             district_code = COALESCE(EXCLUDED.district_code, substitute_profiles.district_code),
             bio = COALESCE(EXCLUDED.bio, substitute_profiles.bio),
             clip_provider = CASE WHEN EXCLUDED.clip_public_id IS NOT NULL OR EXCLUDED.clip_url IS NOT NULL
                                  THEN EXCLUDED.clip_provider
                                  ELSE substitute_profiles.clip_provider END,
             clip_public_id = COALESCE(EXCLUDED.clip_public_id, substitute_profiles.clip_public_id),
             clip_url = COALESCE(EXCLUDED.clip_url, substitute_profiles.clip_url),
             clip_poster_url = COALESCE(EXCLUDED.clip_poster_url, substitute_profiles.clip_poster_url),
             clip_duration_s = COALESCE(EXCLUDED.clip_duration_s, substitute_profiles.clip_duration_s),
             is_available = EXCLUDED.is_available
       RETURNING id, user_id AS "userId", position, skill_level AS "skillLevel",
                 punctuality_score::float AS "punctualityScore",
                 matches_played AS "matchesPlayed", no_shows AS "noShows",
                 district_code AS "districtCode", bio,
                 clip_provider AS "clipProvider", clip_public_id AS "clipPublicId",
                 clip_url AS "clipUrl", clip_poster_url AS "clipPosterUrl",
                 clip_duration_s AS "clipDurationS",
                 is_verified AS "isVerified", is_available AS "isAvailable"`,
      [
        user.sub,
        dto.position,
        skillLevel,
        districtCode,
        bio,
        clipProvider,
        clipPublicId,
        clipUrl,
        clipPosterUrl,
        clipDurationS,
        isAvailable,
      ],
    );
  }

  /**
   * Lista las convocatorias recibidas (como suplente) o enviadas (como organizador) por el usuario autenticado.
   */
  async myInvitations(user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para consultar tus convocatorias.');
    return this.db.query(
      `SELECT si.id, si.substitute_id AS "substituteId", si.organizer_id AS "organizerId",
              si.booking_id AS "bookingId", si.status, si.created_at AS "createdAt",
              sp.user_id AS "substituteUserId", sp.position,
              u_sub.full_name AS "substituteName",
              u_org.full_name AS "organizerName",
              b.starts_at AS "startsAt", c.name AS "courtName", x.name AS "complexName"
         FROM substitute_invitations si
         JOIN substitute_profiles sp ON sp.id = si.substitute_id
         JOIN users u_sub ON u_sub.id = sp.user_id
         JOIN users u_org ON u_org.id = si.organizer_id
         LEFT JOIN bookings b ON b.id = si.booking_id
         LEFT JOIN courts c ON c.id = b.court_id
         LEFT JOIN complexes x ON x.id = c.complex_id
        WHERE sp.user_id = $1 OR si.organizer_id = $1
        ORDER BY si.created_at DESC
        LIMIT 25`,
      [user.sub],
    );
  }

  /**
   * Permite al suplente convocado aceptar o rechazar una invitación (`PATCH /api/substitutes/invitations/:id`).
   */
  async respondInvitation(invitationId: string, dto: RespondInvitationDto, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para responder a la convocatoria.');

    const existing = await this.db.one<{
      id: string;
      substituteId: string;
      organizerId: string;
      bookingId: string | null;
      status: string;
      substituteUserId: string;
    }>(
      `SELECT si.id, si.substitute_id AS "substituteId", si.organizer_id AS "organizerId",
              si.booking_id AS "bookingId", si.status, sp.user_id AS "substituteUserId"
         FROM substitute_invitations si
         JOIN substitute_profiles sp ON sp.id = si.substitute_id
        WHERE si.id = $1`,
      [invitationId],
    );
    if (!existing) throw new NotFoundException('Convocatoria no encontrada.');
    if (existing.substituteUserId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('Solo el suplente convocado puede aceptar o rechazar esta invitación.');
    }
    if (existing.status === 'EXPIRED') {
      throw new ConflictException('Esta convocatoria ya ha expirado.');
    }

    const updated = await this.db.one<{
      id: string;
      substituteId: string;
      organizerId: string;
      bookingId: string | null;
      status: string;
      createdAt: string;
    }>(
      `UPDATE substitute_invitations
          SET status = $2::invitation_status
        WHERE id = $1
        RETURNING id, substitute_id AS "substituteId", organizer_id AS "organizerId",
                  booking_id AS "bookingId", status, created_at AS "createdAt"`,
      [invitationId, dto.status],
    );

    const relay = await this.db.one<{ id: string }>(
      `SELECT id FROM contact_relays
        WHERE user_a_id = $1 AND user_b_id = $2
          AND ($3::uuid IS NULL OR booking_id = $3::uuid)
        ORDER BY created_at DESC LIMIT 1`,
      [existing.organizerId, existing.substituteUserId, existing.bookingId],
    );
    if (relay) {
      this.bus.publish(Rooms.relay(relay.id), 'invitation:updated', updated);
    }

    return updated;
  }

  /**
   * Convoca a un suplente de emergencia validando previamente que:
   *  1. Se indique un `bookingId` válido.
   *  2. La reserva exista en la base de datos.
   *  3. La reserva pertenezca al organizador autenticado (`organizer_id = user.sub` o `ADMIN`).
   *  4. La reserva esté vigente (`status IN ('HELD', 'CONFIRMED')`, no vencida ni cancelada).
   */
  async inviteSubstitute(
    substituteId: string,
    body: InviteSubstituteDto,
    user: AuthUser,
  ) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para convocar a un suplente.');

    const bookingId = body?.bookingId?.trim();
    if (!bookingId || !UUID_REGEX.test(bookingId)) {
      throw new BadRequestException({
        code: 'BOOKING_ID_REQUIRED',
        message: 'Se requiere un bookingId UUID válido de una reserva activa para convocar a un suplente.',
      });
    }

    const booking = await this.db.one<{
      id: string;
      organizerId: string | null;
      status: string;
      startsAt: Date;
      endsAt: Date;
      holdExpiresAt: Date | null;
    }>(
      `SELECT id, organizer_id AS "organizerId", status,
              starts_at AS "startsAt", ends_at AS "endsAt",
              hold_expires_at AS "holdExpiresAt"
         FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'La reserva indicada no existe.',
      });
    }
    if (booking.organizerId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'BOOKING_OWNERSHIP_FORBIDDEN',
        message: 'Solo el organizador titular de la reserva puede convocar suplentes para este partido.',
      });
    }
    const isHoldExpired =
      (booking.status === 'HELD' || booking.status === 'PENDING_PAYMENT') &&
      booking.holdExpiresAt &&
      new Date(booking.holdExpiresAt).getTime() <= Date.now();
    if (!['HELD', 'CONFIRMED'].includes(booking.status) || isHoldExpired) {
      throw new ConflictException({
        code: 'BOOKING_NOT_ACTIVE',
        message: `No se puede convocar un suplente para una reserva en estado ${isHoldExpired ? 'EXPIRED' : booking.status}.`,
      });
    }

    const organizerId = user.sub;
    const sub = await this.db.one<{
      id: string;
      userId: string;
      fullName: string;
      phoneMasked: string;
      position: string;
      punctualityScore: number;
    }>(
      `SELECT sp.id, sp.user_id AS "userId", u.full_name AS "fullName",
              u.phone_masked AS "phoneMasked", sp.position,
              sp.punctuality_score::float AS "punctualityScore"
         FROM substitute_profiles sp JOIN users u ON u.id = sp.user_id
        WHERE sp.id = $1`,
      [substituteId],
    );
    if (!sub) throw new NotFoundException('Perfil de suplente no encontrado');
    if (sub.userId === organizerId) {
      throw new BadRequestException('No puedes convocarte a ti mismo como suplente.');
    }

    const proxyNumber = `+51 (054) 64${randomInt(10, 99)}-${randomInt(100, 999)}`;
    const initialText =
      body.message?.trim() ||
      `¡Hola ${sub.fullName.split(' ')[0]}! Nos falta un ${sub.position.toLowerCase()} hoy a las 20:00 en El Misti (Cayma). ¿Confirmas llegada?`;
    const sanitized = redactContactInfo(initialText);

    const { invitation, relay, firstMessage } = await this.db.transaction(async (tx) => {
      const [inv] = await tx.query<{ id: string; status: string; createdAt: string }>(
        `INSERT INTO substitute_invitations (substitute_id, organizer_id, booking_id, status)
         VALUES ($1, $2, $3, 'SENT')
         ON CONFLICT (substitute_id, booking_id) DO UPDATE SET status = 'SENT'
         RETURNING id, status, created_at AS "createdAt"`,
        [substituteId, organizerId, booking.id],
      );

      const [rel] = await tx.query<{ id: string; proxyNumber: string; expiresAt: string }>(
        `INSERT INTO contact_relays (user_a_id, user_b_id, booking_id, proxy_number, expires_at)
         VALUES ($1, $2, $3, $4, now() + INTERVAL '4 hours')
         RETURNING id, proxy_number AS "proxyNumber", expires_at AS "expiresAt"`,
        [organizerId, sub.userId, booking.id, proxyNumber],
      );

      const [msg] = await tx.query(
        `INSERT INTO relay_messages (relay_id, sender_id, body, was_redacted)
         VALUES ($1, $2, $3, $4)
         RETURNING id, sender_id AS "senderId", body, was_redacted AS "wasRedacted", created_at AS "createdAt"`,
        [rel.id, organizerId, sanitized.body, sanitized.redacted],
      );

      return { invitation: inv, relay: rel, firstMessage: msg };
    });

    const senderName = user.name || 'Organizador';
    const payload = {
      invitation,
      substitute: sub,
      relay: {
        ...relay,
        privacyNotice:
          'Números reales protegidos con enmascaramiento E.164 y redacción automática de datos de contacto.',
      },
      messages: [{ ...firstMessage, senderRole: user.role, senderName }],
    };

    this.bus.publish(Rooms.relay(relay.id), 'relay:message', payload.messages[0]);
    return payload;
  }

  async myRelays(user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException();
    return this.db.query(
      `SELECT r.id, r.proxy_number AS "proxyNumber", r.expires_at AS "expiresAt",
              ua.full_name AS "userAName", ua.phone_masked AS "userAPhoneMasked",
              ub.full_name AS "userBName", ub.phone_masked AS "userBPhoneMasked",
              r.created_at AS "createdAt"
         FROM contact_relays r
         JOIN users ua ON ua.id = r.user_a_id
         JOIN users ub ON ub.id = r.user_b_id
        WHERE (r.user_a_id = $1 OR r.user_b_id = $1)
          AND r.expires_at > now()
        ORDER BY r.created_at DESC
        LIMIT 20`,
      [user.sub],
    );
  }

  async getRelay(relayId: string, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para consultar este canal.');
    const relay = await this.db.one<{
      id: string;
      userAId: string;
      userBId: string;
      proxyNumber: string;
      expiresAt: string;
      userAName: string;
      userAPhoneMasked: string;
      userBName: string;
      userBPhoneMasked: string;
    }>(
      `SELECT r.id, r.user_a_id AS "userAId", r.user_b_id AS "userBId",
              r.proxy_number AS "proxyNumber", r.expires_at AS "expiresAt",
              ua.full_name AS "userAName", ua.phone_masked AS "userAPhoneMasked",
              ub.full_name AS "userBName", ub.phone_masked AS "userBPhoneMasked"
         FROM contact_relays r
         JOIN users ua ON ua.id = r.user_a_id
         JOIN users ub ON ub.id = r.user_b_id
        WHERE r.id = $1`,
      [relayId],
    );
    if (!relay) throw new NotFoundException('Canal seguro no encontrado');
    if (relay.userAId !== user.sub && relay.userBId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No eres participante de este canal de contacto.');
    }

    const messages = await this.db.query(
      `SELECT m.id, m.sender_id AS "senderId", u.full_name AS "senderName",
              m.body, m.was_redacted AS "wasRedacted", m.created_at AS "createdAt"
         FROM relay_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.relay_id = $1 ORDER BY m.created_at ASC`,
      [relayId],
    );
    return { ...relay, messages };
  }

  async sendRelayMessage(relayId: string, text: string, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para enviar mensajes.');
    if (!text || !text.trim()) throw new BadRequestException('Escribe un mensaje');

    const relay = await this.db.one<{ id: string; userAId: string; userBId: string; expiresAt: Date }>(
      `SELECT id, user_a_id AS "userAId", user_b_id AS "userBId", expires_at AS "expiresAt"
         FROM contact_relays WHERE id = $1`,
      [relayId],
    );
    if (!relay) throw new NotFoundException('Canal seguro no encontrado');
    if (relay.userAId !== user.sub && relay.userBId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No eres participante de este canal de contacto.');
    }
    if (new Date(relay.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Esta sesión de contacto temporal ha expirado.');
    }

    const sanitized = redactContactInfo(text.trim());

    const msg = await this.db.one(
      `INSERT INTO relay_messages (relay_id, sender_id, body, was_redacted)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sender_id AS "senderId", body, was_redacted AS "wasRedacted", created_at AS "createdAt"`,
      [relayId, user.sub, sanitized.body, sanitized.redacted],
    );

    const enriched = { ...msg, senderName: user.name || 'Participante' };
    this.bus.publish(Rooms.relay(relayId), 'relay:message', enriched);
    return enriched;
  }
}
