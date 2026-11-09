import { Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { AuthUser } from '../common/types';
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { limaToday } from '../common/utils/time.util';
import { BookingsService } from './bookings.service';
import { ReceptionBlockDto } from './dto/bookings.dto';

/**
 * Gateway de sincronización omnicanal en tiempo real (Socket.io).
 *
 *  - Los eventos públicos de disponibilidad (`slot:updated`, `split:updated`, `feed:event`)
 *    se emiten a las salas del complejo/split.
 *  - Los eventos privados de mensajería (`relay:message`) se emiten EXCLUSIVAMENTE a la sala
 *    aislada `relay:<id>` y jamás se retransmiten a `demo:global`.
 *  - Unirse a `relay:<id>` (`relay:join`) exige un JWT válido y verifica en base de datos
 *    que el usuario autenticado sea participante (`user_a_id`, `user_b_id` o `ADMIN`).
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class BookingsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BookingsGateway.name);
  private sub?: Subscription;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly bus: RealtimeBus,
    private readonly bookings: BookingsService,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit(): void {
    this.sub = this.bus.stream$.subscribe(({ rooms, event, payload }) => {
      if (!this.server) return;
      for (const room of rooms) {
        this.server.to(room).emit(event, payload);
      }
      // Los eventos de canales privados (relays) NUNCA se retransmiten a demo:global
      const isPrivateRelay =
        event.startsWith('relay:') || rooms.some((r) => r.startsWith('relay:'));
      if (!isPrivateRelay) {
        this.server.to('demo:global').emit(event, payload);
      }
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }

  private async extractUser(client: Socket, inlineToken?: string): Promise<AuthUser | undefined> {
    const rawAuth =
      inlineToken ||
      (typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined) ||
      (typeof client.handshake.headers?.authorization === 'string'
        ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);
    if (!rawAuth) return undefined;
    try {
      return await this.jwt.verifyAsync<AuthUser>(rawAuth);
    } catch {
      return undefined;
    }
  }

  handleConnection(client: Socket): void {
    client.join('demo:global');
    const complexId = client.handshake.query.complexId;
    if (typeof complexId === 'string' && complexId) {
      client.join(Rooms.complex(complexId));
    }
    this.server.emit('clients:count', { connected: this.server.engine.clientsCount });
  }

  handleDisconnect(_client: Socket): void {
    if (this.server?.engine) {
      this.server.emit('clients:count', { connected: this.server.engine.clientsCount });
    }
  }

  /** Suscripción a las actualizaciones en vivo de un complejo deportivo. */
  @SubscribeMessage('complex:join')
  async onJoinComplex(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { complexId: string; date?: string; accessToken?: string },
  ) {
    if (!body?.complexId) return { ok: false };
    await client.join(Rooms.complex(body.complexId));
    const user = await this.extractUser(client, body.accessToken);
    if (user && (user.role === 'OWNER' || user.role === 'ADMIN')) {
      try {
        const dashboard = await this.bookings.ownerDashboard(body.complexId, body.date ?? limaToday(), user);
        return { ok: true, room: Rooms.complex(body.complexId), dashboard };
      } catch {
        // Si el OWNER no es propietario de este complejo, sólo se une a la sala pública de disponibilidad
      }
    }
    return { ok: true, room: Rooms.complex(body.complexId) };
  }

  /** Suscripción a la sala de un Split Payment ("Cupos pagados: 4 de 6"). */
  @SubscribeMessage('split:join')
  async onJoinSplit(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { token: string },
  ) {
    if (!body?.token) return { ok: false };
    await client.join(Rooms.split(body.token));
    const split = await this.bookings.getSplitByToken(body.token);
    return { ok: true, room: Rooms.split(body.token), split };
  }

  /**
   * Suscripción aislada a la sala de un chat interno enmascarado (`contact_relays`).
   * Exige JWT válido y verifica que el usuario sea participante (`user_a_id`, `user_b_id` o `ADMIN`).
   */
  @SubscribeMessage('relay:join')
  async onJoinRelay(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { relayId: string; accessToken?: string },
  ) {
    if (!body?.relayId) {
      return { ok: false, status: 400, error: 'Se requiere relayId.' };
    }
    const user = await this.extractUser(client, body?.accessToken);
    if (!user?.sub) {
      return { ok: false, status: 401, error: 'Sesión JWT requerida para unirse al canal privado.' };
    }
    try {
      await this.bookings.verifyRelayParticipant(body.relayId, user);
      await client.join(Rooms.relay(body.relayId));
      return { ok: true, room: Rooms.relay(body.relayId) };
    } catch (e: any) {
      return {
        ok: false,
        status: e?.status ?? 403,
        error: e?.response?.message ?? e?.message ?? 'No eres participante autorizado de este canal.',
      };
    }
  }

  /** Bloqueo rápido directamente por WebSocket desde el panel de recepción (exige JWT de OWNER). */
  @SubscribeMessage('slot:block')
  async onSlotBlock(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ReceptionBlockDto & { accessToken?: string },
  ) {
    try {
      const user = await this.extractUser(client, dto?.accessToken);
      if (!user) throw new UnauthorizedException('Sesión JWT requerida para bloquear turnos.');
      const slot = await this.bookings.receptionBlock(dto, user);
      return { ok: true, slot };
    } catch (e: any) {
      this.logger.warn(`Conflicto al bloquear turno: ${e.message}`);
      return { ok: false, error: e?.response?.message ?? e.message };
    }
  }

  /** Liberación rápida de turno bloqueado desde el panel de recepción (exige JWT). */
  @SubscribeMessage('slot:release')
  async onSlotRelease(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { bookingId: string; accessToken?: string },
  ) {
    try {
      const user = await this.extractUser(client, body?.accessToken);
      if (!user) throw new UnauthorizedException('Sesión JWT requerida para liberar turnos.');
      const slot = await this.bookings.releaseBooking(body.bookingId, user);
      return { ok: true, slot };
    } catch (e: any) {
      return { ok: false, error: e?.response?.message ?? e.message };
    }
  }
}
