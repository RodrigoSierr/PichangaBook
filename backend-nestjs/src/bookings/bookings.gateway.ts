import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { limaToday } from '../common/utils/time.util';
import { BookingsService } from './bookings.service';
import { ReceptionBlockDto } from './dto/bookings.dto';

/**
 * Gateway de sincronización omnicanal en tiempo real (Socket.io).
 *
 * Conecta simultáneamente:
 *  - App Móvil (Flutter / Espejo Web): parrilla de turnos y barra de Split Payment.
 *  - Panel Web del Dueño (Recepción): agenda omnicanal y bloqueo rápido en 1 clic.
 *
 * Todo cambio en `bookings` o `split_payments` se difunde en < 50 ms a la sala
 * `complex:<id>` y al canal global de la demo, evitando el doble booking.
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
  ) {}

  onModuleInit(): void {
    this.sub = this.bus.stream$.subscribe(({ rooms, event, payload }) => {
      if (!this.server) return;
      for (const room of rooms) {
        this.server.to(room).emit(event, payload);
      }
      // Emitimos también al canal global `demo:global` para que cualquier ventana
      // abierta durante la presentación reciba la actualización sin fricción.
      this.server.to('demo:global').emit(event, payload);
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
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
    @MessageBody() body: { complexId: string; date?: string },
  ) {
    if (!body?.complexId) return { ok: false };
    await client.join(Rooms.complex(body.complexId));
    const dashboard = await this.bookings.ownerDashboard(body.complexId, body.date ?? limaToday());
    return { ok: true, room: Rooms.complex(body.complexId), dashboard };
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

  /** Bloqueo rápido directamente por WebSocket desde el panel de recepción. */
  @SubscribeMessage('slot:block')
  async onSlotBlock(@MessageBody() dto: ReceptionBlockDto) {
    try {
      const slot = await this.bookings.receptionBlock(dto);
      return { ok: true, slot };
    } catch (e: any) {
      this.logger.warn(`Conflicto al bloquear turno: ${e.message}`);
      return { ok: false, error: e?.response?.message ?? e.message };
    }
  }

  /** Liberación rápida de turno bloqueado desde el panel de recepción. */
  @SubscribeMessage('slot:release')
  async onSlotRelease(@MessageBody() body: { bookingId: string }) {
    try {
      const slot = await this.bookings.releaseBooking(body.bookingId);
      return { ok: true, slot };
    } catch (e: any) {
      return { ok: false, error: e?.response?.message ?? e.message };
    }
  }
}
