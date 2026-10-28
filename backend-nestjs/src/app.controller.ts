import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Public } from './common/auth/auth.guard';
import { AppConfig } from './config/app.config';
import { DatabaseService } from './database/database.service';
import { RealtimeBus } from './realtime/realtime.bus';
import { limaToday } from './common/utils/time.util';

@Controller()
export class AppController {
  constructor(
    private readonly db: DatabaseService,
    private readonly cfg: AppConfig,
    private readonly bus: RealtimeBus,
  ) {}

  @Public()
  @Get('health')
  async health() {
    const [row] = await this.db.query<{ version: string; complexes: number; substitutes: number }>(
      `SELECT version() AS version,
              (SELECT COUNT(*)::int FROM complexes) AS complexes,
              (SELECT COUNT(*)::int FROM substitute_profiles) AS substitutes`,
    );
    return {
      status: 'ok',
      project: 'PichangaBook Arequipa · Avance MVP (28 oct 2026)',
      authors: ['Rodrigo Sierra', 'Samuel Iman'],
      databaseDriver: this.db.driver,
      postgresVersion: row?.version,
      demoMode: this.cfg.demoMode,
      limaDate: limaToday(),
      counts: { complexes: row?.complexes ?? 0, substitutes: row?.substitutes ?? 0 },
    };
  }

  /** Reinicia las reservas y el Split Payment (4/6) a su estado semilla para repetir la demo en vivo. */
  @Public()
  @Post('demo/reset')
  @HttpCode(200)
  async resetDemo() {
    const root = resolve(__dirname, '..');
    const seed = readFileSync(resolve(root, 'seed.sql'), 'utf8');
    await this.db.exec(`
      TRUNCATE relay_messages, contact_relays, substitute_invitations,
               payment_shares, split_payments, booking_events, bookings,
               reviews, substitute_profiles, courts, complexes, users, districts
      RESTART IDENTITY CASCADE;
    `);
    await this.db.exec(seed);
    this.bus.publish('complex:00000000-0000-4000-b000-00000000c001', 'demo:reset', {
      at: new Date().toISOString(),
    });
    return { ok: true, message: 'Datos semilla restaurados para la demostración en vivo.' };
  }
}
