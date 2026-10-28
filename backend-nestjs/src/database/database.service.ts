import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { PGlite } from '@electric-sql/pglite';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');
import { AppConfig } from '../config/app.config';

/** Contrato mínimo para ejecutar SQL (fuera o dentro de una transacción). */
export interface SqlExecutor {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export type DbDriver = 'postgres' | 'pglite';

/**
 * Acceso a PostgreSQL con dos drivers intercambiables:
 *  - `postgres`: servidor real (Docker / Render / AWS RDS) vía `pg.Pool`.
 *  - `pglite`  : PostgreSQL 17+ compilado a WASM y embebido en el proceso.
 *                Ejecuta EXACTAMENTE el mismo schema.sql (enums, EXCLUDE GiST,
 *                columnas generadas, transacciones ACID) sin instalar nada.
 */
@Injectable()
export class DatabaseService implements SqlExecutor, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private pool?: Pool;
  private lite?: PGlite;
  driver: DbDriver = 'pglite';

  constructor(private readonly cfg: AppConfig) {}

  async onModuleInit(): Promise<void> {
    if (this.cfg.databaseUrl) {
      this.driver = 'postgres';
      this.pool = new Pool({
        connectionString: this.cfg.databaseUrl,
        ssl: this.cfg.databaseSsl ? { rejectUnauthorized: false } : undefined,
        max: 20,
      });
      await this.pool.query('SELECT 1');
      this.logger.log('Conectado a PostgreSQL (servidor)');
    } else {
      this.driver = 'pglite';
      this.lite = new PGlite({
        dataDir: this.cfg.pgliteDataDir || 'memory://',
        extensions: { btree_gist },
      });
      await this.lite.waitReady;
      this.logger.warn('DATABASE_URL vacío → PostgreSQL embebido (PGlite/WASM) en modo DEMO');
    }
    await this.migrateIfEmpty();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
    await this.lite?.close();
  }

  private async migrateIfEmpty(): Promise<void> {
    if (!this.cfg.dbAutoMigrate) return;
    const [row] = await this.query<{ exists: string | null }>(
      `SELECT to_regclass('public.bookings')::text AS exists`,
    );
    if (row?.exists) return;
    const root = resolve(__dirname, '..', '..');
    const schema = readFileSync(resolve(root, 'schema.sql'), 'utf8');
    const seed = readFileSync(resolve(root, 'seed.sql'), 'utf8');
    await this.exec(schema);
    await this.exec(seed);
    this.logger.log('schema.sql + seed.sql aplicados');
  }

  /** Ejecuta SQL multi-sentencia sin parámetros (migraciones). */
  async exec(sql: string): Promise<void> {
    if (this.pool) await this.pool.query(sql);
    else await this.lite!.exec(sql);
  }

  async query<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.pool) return (await this.pool.query(sql, params as any[])).rows as T[];
    return (await this.lite!.query<T>(sql, params as any[])).rows;
  }

  async one<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /**
   * Transacción ACID. Si `fn` lanza error se hace ROLLBACK completo:
   * jamás queda un turno reservado sin su registro de pago / bitácora.
   */
  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client: PoolClient = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await client.query(sql, params as any[])).rows as R[],
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    return this.lite!.transaction((tx) =>
      fn({
        query: async <R>(sql: string, params: unknown[] = []) =>
          (await tx.query<R>(sql, params as any[])).rows,
      }),
    );
  }
}
