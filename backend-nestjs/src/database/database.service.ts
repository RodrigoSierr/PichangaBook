import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string;
}

/**
 * Acceso a PostgreSQL con dos drivers intercambiables (`pg.Pool` y `PGlite` WASM)
 * y motor de migraciones incrementales versionadas (`schema_migrations`).
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
      this.logger.warn('DATABASE_URL vacío → PostgreSQL embebido (PGlite/WASM)');
    }
    if (this.cfg.dbAutoMigrate) {
      await this.runMigrations({ seedDemo: this.cfg.shouldSeedDemoData });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
    await this.lite?.close();
  }

  /**
   * Ejecuta migraciones incrementales versionadas sobre una instalación limpia
   * o sobre una base de datos preexistente sin pérdida de datos, y carga `seed.sql`
   * únicamente cuando `seedDemo` está activo (entornos demo opt-in).
   */
  async runMigrations(options?: { seedDemo?: boolean }): Promise<{
    applied: string[];
    seeded: boolean;
  }> {
    const seedDemo = options?.seedDemo ?? this.cfg.shouldSeedDemoData;
    const root = resolve(__dirname, '..', '..');

    await this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(64) PRIMARY KEY,
        name       TEXT        NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const existingRows = await this.query<{ version: string }>(
      `SELECT version FROM schema_migrations ORDER BY version ASC`,
    );
    const appliedSet = new Set(existingRows.map((r) => r.version));
    const newlyApplied: string[] = [];

    // 1. Esquema base 001_initial_schema (compatible con instalaciones limpias y preexistentes)
    if (!appliedSet.has('001_initial_schema')) {
      const [bookingsCheck] = await this.query<{ exists: string | null }>(
        `SELECT to_regclass('public.bookings')::text AS exists`,
      );
      if (!bookingsCheck?.exists) {
        const schemaSql = readFileSync(resolve(root, 'schema.sql'), 'utf8');
        await this.exec(schemaSql);
      }
      await this.query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        ['001_initial_schema', 'schema.sql'],
      );
      appliedSet.add('001_initial_schema');
      newlyApplied.push('001_initial_schema');
    }

    // 2. Migraciones incrementales en /migrations/*.sql
    const migrationsDir = resolve(root, 'migrations');
    if (existsSync(migrationsDir)) {
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const version = file.replace(/\.sql$/i, '');
        if (appliedSet.has(version)) continue;
        const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
        await this.exec(sql);
        await this.query(
          `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
          [version, file],
        );
        appliedSet.add(version);
        newlyApplied.push(version);
      }
    }

    // 3. Carga condicional de seed.sql (SOLO en entornos demo opt-in y cuando está vacío)
    let seeded = false;
    if (seedDemo) {
      const [distCount] = await this.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM districts`,
      );
      if ((distCount?.count ?? 0) === 0) {
        const seedSql = readFileSync(resolve(root, 'seed.sql'), 'utf8');
        await this.exec(seedSql);
        seeded = true;
      }
    }

    if (newlyApplied.length > 0 || seeded) {
      this.logger.log(
        `Migraciones verificadas (${newlyApplied.join(', ') || 'al día'})${seeded ? ' + seed.sql cargado (modo demo)' : ''}`,
      );
    }

    return { applied: newlyApplied, seeded };
  }

  async listMigrations(): Promise<MigrationRecord[]> {
    return this.query<MigrationRecord>(
      `SELECT version, name, applied_at AS "appliedAt" FROM schema_migrations ORDER BY version ASC`,
    );
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
