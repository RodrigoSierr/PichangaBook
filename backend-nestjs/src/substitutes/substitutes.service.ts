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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SubstitutesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly media: MediaService,
    private readonly bus: RealtimeBus,
  ) {}

  async list(filters: { position?: string; district?: string; onlyVerified?: string }) {
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

  /**
   * Convoca a un suplente de emergencia validando previamente que:
   *  1. Se indique un `bookingId` válido.
   *  2. La reserva exista en la base de datos.
   *  3. La reserva pertenezca al organizador autenticado (`organizer_id = user.sub` o `ADMIN`).
   *  4. La reserva esté vigente (`status IN ('HELD', 'CONFIRMED')`, no vencida ni cancelada).
   */
  async inviteSubstitute(
    substituteId: string,
    body: { bookingId?: string; message?: string },
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
