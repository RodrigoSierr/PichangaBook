import { Global, Injectable, Module } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** Mensaje a difundir por Socket.io a una o varias salas. */
export interface RealtimeMessage {
  rooms: string[];
  event: string;
  payload: unknown;
}

/**
 * Bus de eventos de dominio → WebSockets.
 * Los servicios (reservas, pagos, chat) publican aquí y el BookingsGateway
 * los reenvía a las salas correspondientes. Evita dependencias circulares
 * servicio ↔ gateway y permite escalar luego con Redis Pub/Sub (adapter).
 */
@Injectable()
export class RealtimeBus {
  private readonly subject = new Subject<RealtimeMessage>();
  readonly stream$: Observable<RealtimeMessage> = this.subject.asObservable();

  publish(rooms: string | string[], event: string, payload: unknown): void {
    this.subject.next({ rooms: Array.isArray(rooms) ? rooms : [rooms], event, payload });
  }
}

/** Convenciones de nombres de salas Socket.io. */
export const Rooms = {
  complex: (complexId: string) => `complex:${complexId}`,
  split: (token: string) => `split:${token}`,
  relay: (relayId: string) => `relay:${relayId}`,
  user: (userId: string) => `user:${userId}`,
};

@Global()
@Module({ providers: [RealtimeBus], exports: [RealtimeBus] })
export class RealtimeModule {}
