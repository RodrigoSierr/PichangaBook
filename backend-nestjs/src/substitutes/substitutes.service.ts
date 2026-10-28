import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { MediaService } from '../integrations/media.service';
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { AuthUser } from '../common/types';
import { redactContactInfo } from '../common/utils/phone.util';
import { DEMO_ORGANIZER_ID } from '../bookings/bookings.service';

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

  signClipUpload(user?: AuthUser) {
    return this.media.signClipUpload(user?.sub ?? DEMO_ORGANIZER_ID);
  }

  /**
   * Convoca a un suplente de emergencia y abre un canal seguro (chat interno + número proxy VoIP)
   * sin revelar el número de celular real de ninguna de las partes.
   */
  async inviteSubstitute(
    substituteId: string,
    body: { bookingId?: string; message?: string },
    user?: AuthUser,
  ) {
    const organizerId = user?.sub ?? DEMO_ORGANIZER_ID;
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
        [substituteId, organizerId, body.bookingId ?? null],
      );

      const [rel] = await tx.query<{ id: string; proxyNumber: string; expiresAt: string }>(
        `INSERT INTO contact_relays (user_a_id, user_b_id, booking_id, proxy_number, expires_at)
         VALUES ($1, $2, $3, $4, now() + INTERVAL '4 hours')
         RETURNING id, proxy_number AS "proxyNumber", expires_at AS "expiresAt"`,
        [organizerId, sub.userId, body.bookingId ?? null, proxyNumber],
      );

      const [msg] = await tx.query(
        `INSERT INTO relay_messages (relay_id, sender_id, body, was_redacted)
         VALUES ($1, $2, $3, $4)
         RETURNING id, body, was_redacted AS "wasRedacted", created_at AS "createdAt"`,
        [rel.id, organizerId, sanitized.body, sanitized.redacted],
      );

      return { invitation: inv, relay: rel, firstMessage: msg };
    });

    const payload = {
      invitation,
      substitute: sub,
      relay: {
        ...relay,
        privacyNotice:
          'Números reales protegidos con enmascaramiento E.164 y central VoIP temporal antifraude.',
      },
      messages: [{ ...firstMessage, senderRole: 'ORGANIZER', senderName: 'Diego Salas (Organizador)' }],
    };

    this.bus.publish(Rooms.relay(relay.id), 'relay:message', payload.messages[0]);
    return payload;
  }

  async getRelay(relayId: string) {
    const relay = await this.db.one<{
      id: string;
      proxyNumber: string;
      expiresAt: string;
      userAName: string;
      userAPhoneMasked: string;
      userBName: string;
      userBPhoneMasked: string;
    }>(
      `SELECT r.id, r.proxy_number AS "proxyNumber", r.expires_at AS "expiresAt",
              ua.full_name AS "userAName", ua.phone_masked AS "userAPhoneMasked",
              ub.full_name AS "userBName", ub.phone_masked AS "userBPhoneMasked"
         FROM contact_relays r
         JOIN users ua ON ua.id = r.user_a_id
         JOIN users ub ON ub.id = r.user_b_id
        WHERE r.id = $1`,
      [relayId],
    );
    if (!relay) throw new NotFoundException('Canal seguro no encontrado');

    const messages = await this.db.query(
      `SELECT m.id, m.sender_id AS "senderId", u.full_name AS "senderName",
              m.body, m.was_redacted AS "wasRedacted", m.created_at AS "createdAt"
         FROM relay_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.relay_id = $1 ORDER BY m.created_at ASC`,
      [relayId],
    );
    return { ...relay, messages };
  }

  async sendRelayMessage(relayId: string, text: string, user?: AuthUser) {
    if (!text || !text.trim()) throw new BadRequestException('Escribe un mensaje');
    const senderId = user?.sub ?? DEMO_ORGANIZER_ID;
    const sanitized = redactContactInfo(text.trim());

    const msg = await this.db.one(
      `INSERT INTO relay_messages (relay_id, sender_id, body, was_redacted)
       VALUES ($1, $2, $3, $4)
       RETURNING id, sender_id AS "senderId", body, was_redacted AS "wasRedacted", created_at AS "createdAt"`,
      [relayId, senderId, sanitized.body, sanitized.redacted],
    );

    this.bus.publish(Rooms.relay(relayId), 'relay:message', msg);
    return msg;
  }
}
