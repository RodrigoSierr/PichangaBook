#!/usr/bin/env node
/**
 * Script independiente de migración de base de datos para CI/CD y producción.
 * Uso:
 *   npm run db:migrate            # Ejecuta schema.sql + migrations/*.sql
 *   npm run db:migrate -- --seed  # Ejecuta migraciones + seed.sql (solo en no-producción)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import pg from 'pg';

const { Pool } = pg;
const ROOT_DIR = resolve(import.meta.dirname, '..');

function shouldEnableDatabaseSsl(databaseUrl) {
  const flag = (process.env.DB_SSL ?? process.env.DATABASE_SSL ?? '').trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  const url = (databaseUrl ?? '').trim().toLowerCase();
  if (!url) return false;
  return (
    url.includes('sslmode=require') ||
    url.includes('sslmode=verify-') ||
    url.includes('ssl=true') ||
    url.includes('neon.tech') ||
    url.includes('supabase.co') ||
    url.includes('supabase.com') ||
    url.includes('render.com')
  );
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';
  const seedFlag = process.argv.includes('--seed') || process.env.DB_SEED_DEMO === 'true';

  if (isProduction && !databaseUrl) {
    console.error('[db:migrate] ERROR: DATABASE_URL es obligatorio cuando NODE_ENV=production.');
    process.exit(1);
  }

  let pool = null;
  let lite = null;

  if (databaseUrl) {
    const sslEnabled = shouldEnableDatabaseSsl(databaseUrl);
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    });
    console.log(`[db:migrate] Conectado a PostgreSQL externo (${sslEnabled ? 'SSL activo' : 'sin SSL'}).`);
  } else {
    const dataDir = (process.env.PGLITE_DATA_DIR || '').trim() || undefined;
    lite = await PGlite.create({
      dataDir,
      extensions: { btree_gist },
    });
    console.log(`[db:migrate] Ejecutando sobre PGlite (${dataDir || 'en memoria'}).`);
  }

  const exec = async (sql) => {
    if (pool) await pool.query(sql);
    else await lite.exec(sql);
  };

  const query = async (sql, params = []) => {
    if (pool) return (await pool.query(sql, params)).rows;
    return (await lite.query(sql, params)).rows;
  };

  try {
    await exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(64) PRIMARY KEY,
        name       TEXT        NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const existingRows = await query(`SELECT version FROM schema_migrations ORDER BY version ASC`);
    const appliedSet = new Set(existingRows.map((r) => r.version));
    const newlyApplied = [];

    if (!appliedSet.has('001_initial_schema')) {
      const [bookingsCheck] = await query(`SELECT to_regclass('public.bookings')::text AS exists`);
      if (!bookingsCheck?.exists) {
        const schemaSql = readFileSync(resolve(ROOT_DIR, 'schema.sql'), 'utf8');
        await exec(schemaSql);
      }
      await query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        ['001_initial_schema', 'schema.sql'],
      );
      appliedSet.add('001_initial_schema');
      newlyApplied.push('001_initial_schema');
    }

    const migrationsDir = resolve(ROOT_DIR, 'migrations');
    if (existsSync(migrationsDir)) {
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const version = file.replace(/\.sql$/i, '');
        if (appliedSet.has(version)) continue;
        const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
        await exec(sql);
        await query(
          `INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
          [version, file],
        );
        appliedSet.add(version);
        newlyApplied.push(version);
      }
    }

    let seeded = false;
    if (seedFlag && !isProduction) {
      const [complexCount] = await query(`SELECT COUNT(*)::int AS count FROM complexes`);
      if ((complexCount?.count ?? 0) === 0) {
        const seedSql = readFileSync(resolve(ROOT_DIR, 'seed.sql'), 'utf8');
        await exec(seedSql);
        seeded = true;
      }
    }

    const totalApplied = await query(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`);
    const [districtsCount] = await query(`SELECT COUNT(*)::int AS count FROM districts`);

    console.log(
      `[db:migrate] OK — Migraciones nuevas: [${newlyApplied.join(', ') || 'ninguna'}] | Total registradas: ${totalApplied.length} | Distritos: ${districtsCount?.count ?? 0}${seeded ? ' | seed.sql cargado' : ''}`,
    );
  } finally {
    await pool?.end();
    await lite?.close();
  }
}

main().catch((err) => {
  console.error('[db:migrate] Fallo ejecutando migraciones:', err);
  process.exit(1);
});
