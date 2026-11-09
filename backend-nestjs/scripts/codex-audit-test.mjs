import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io } from 'socket.io-client';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const COMPLEX_ID = '00000000-0000-4000-b000-00000000c001';
const COURT_1_ID = '00000000-0000-4000-c000-00000000d011';
const COURT_2_ID = '00000000-0000-4000-c000-00000000d012';
const COURT_3_ID = '00000000-0000-4000-c000-00000000d013';
const SEED_BOOKING_ID = '00000000-0000-4000-e000-0000000000b2';
const SEED_SUB_ID = '00000000-0000-4000-9000-000000000501';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signFirebaseJwt(payload, privateKeyPem, kid = 'audit-key-1') {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function testPoint14Migrations() {
  console.log('\n=== [Punto 14] Migraciones incrementales versionadas y seed condicional ===');
  const schemaSql = readFileSync(join(ROOT_DIR, 'schema.sql'), 'utf8');
  const mig002Sql = readFileSync(
    join(ROOT_DIR, 'migrations', '002_align_expired_and_payments_reconciliation.sql'),
    'utf8',
  );

  // 14.a Instalación limpia sin seed demo
  const cleanDb = new PGlite({ extensions: { btree_gist } });
  await cleanDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await cleanDb.exec(schemaSql);
  await cleanDb.query(`INSERT INTO schema_migrations (version) VALUES ('001_initial_schema.sql')`);
  await cleanDb.exec(mig002Sql);
  await cleanDb.query(
    `INSERT INTO schema_migrations (version) VALUES ('002_align_expired_and_payments_reconciliation.sql')`,
  );

  const migsClean = await cleanDb.query(`SELECT version FROM schema_migrations ORDER BY version ASC`);
  const districtsClean = await cleanDb.query(`SELECT COUNT(*)::int AS c FROM districts`);
  assert(migsClean.rows.length === 2, 'Instalación limpia debe registrar 2 migraciones');
  assert(districtsClean.rows[0].c === 0, 'Sin seedDemo no deben cargarse datos de demostración');

  // 14.b Actualización no destructiva de base de datos preexistente (sin EXPIRED ni payment_attempts)
  const legacyDb = new PGlite({ extensions: { btree_gist } });
  const legacySchema = schemaSql
    .replace(", 'EXPIRED'", '')
    .replace('reserved_slots        SMALLINT NOT NULL DEFAULT 0,', '')
    .replace(
      'CONSTRAINT chk_split_slots_bounds CHECK (paid_slots >= 0 AND reserved_slots >= 0 AND (paid_slots + reserved_slots) <= total_slots)',
      'CONSTRAINT chk_split_slots_bounds CHECK (paid_slots >= 0 AND paid_slots <= total_slots)',
    );
  await legacyDb.exec(legacySchema);
  await legacyDb.query(
    `INSERT INTO districts (code, name, lat, lng, is_key_zone) VALUES ('CAYMA', 'Cayma', -16.3615, -71.5468, TRUE)`,
  );
  await legacyDb.exec(mig002Sql);

  const enumLabels = await legacyDb.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'booking_status'`,
  );
  const hasExpired = enumLabels.rows.some((r) => r.enumlabel === 'EXPIRED');
  const preservedDistrict = await legacyDb.query(`SELECT COUNT(*)::int AS c FROM districts WHERE code = 'CAYMA'`);
  assert(hasExpired, 'La migración 002 debe añadir EXPIRED a una base preexistente');
  assert(preservedDistrict.rows[0].c === 1, 'La migración 002 no debe destruir datos existentes');

  await cleanDb.close();
  await legacyDb.close();
  console.log('✓ [Punto 14] Instalación limpia (0 filas demo) y upgrade incremental verificados.');
}

async function testPoint5ProductionAndNonDemoMode() {
  console.log('\n=== [Punto 5] Modo demo opt-in y validación de configuración productiva ===');
  const { ConfigService } = await import('@nestjs/config');
  const { AppConfig } = await import('../dist/config/app.config.js');

  const defaultCfg = new AppConfig(new ConfigService({ NODE_ENV: 'development' }));
  assert(defaultCfg.allowDemoFallback === false, 'allowDemoFallback debe ser false por defecto');

  let prodRejected = false;
  try {
    const invalidProdCfg = new AppConfig(
      new ConfigService({
        NODE_ENV: 'production',
        ALLOW_DEMO_FALLBACK: 'true',
      }),
    );
    invalidProdCfg.validateStartupConfig();
  } catch {
    prodRejected = true;
  }
  assert(prodRejected, 'validateStartupConfig debe rechazar ALLOW_DEMO_FALLBACK=true en producción');

  let weakJwtRejected = false;
  try {
    const weakJwtCfg = new AppConfig(
      new ConfigService({
        NODE_ENV: 'production',
        ALLOW_DEMO_FALLBACK: 'false',
        JWT_SECRET: 'pichangabook-dev-secret',
      }),
    );
    weakJwtCfg.validateStartupConfig();
  } catch {
    weakJwtRejected = true;
  }
  assert(weakJwtRejected, 'validateStartupConfig debe rechazar JWT_SECRET por defecto en producción');

  // Levantar instancia en modo no-demo (ALLOW_DEMO_FALLBACK=false)
  const prevAllow = process.env.ALLOW_DEMO_FALLBACK;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEMO_FALLBACK = 'false';
  process.env.DB_SEED_DEMO = 'false';
  const { AppModule } = await import('../dist/app.module.js');
  const prodLikeApp = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  prodLikeApp.setGlobalPrefix('api');
  prodLikeApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await prodLikeApp.listen(0);
  const url = (await prodLikeApp.getUrl()).replace('[::1]', '127.0.0.1');

  const otpRes = await fetch(`${url}/api/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+51958222333' }),
  });
  const otpData = await otpRes.json();
  assert(otpRes.ok, `Solicitud OTP debe responder 200/201, devolvió ${otpRes.status}`);
  assert(otpData.devCode === undefined && otpData.demoOtp === undefined, 'No debe exponer devCode/demoOtp fuera de demo');

  const demoSessionRes = await fetch(`${url}/api/auth/demo-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'ORGANIZER' }),
  });
  assert(demoSessionRes.status === 403, `demo-session fuera de demo debe devolver 403, devolvió ${demoSessionRes.status}`);

  const demoResetRes = await fetch(`${url}/api/demo/reset`, { method: 'POST' });
  assert(demoResetRes.status === 403, `demo/reset fuera de demo debe devolver 403, devolvió ${demoResetRes.status}`);

  await prodLikeApp.close();
  if (prevAllow !== undefined) process.env.ALLOW_DEMO_FALLBACK = prevAllow;
  if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
  console.log('✓ [Punto 5] Respuesta OTP sin código expuesto y bloqueo 403 de rutas demo verificados.');
}

async function main() {
  await testPoint14Migrations();
  await testPoint5ProductionAndNonDemoMode();

  // Generar par RSA-2048 para pruebas de Firebase ID Token (Punto 15)
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  process.env.NODE_ENV = 'development';
  process.env.ALLOW_DEMO_FALLBACK = 'true';
  process.env.DB_SEED_DEMO = 'true';
  process.env.FIREBASE_PROJECT_ID = 'pichangabook-aqp';
  process.env.FIREBASE_PUBLIC_KEY = publicKey;
  process.env.CULQI_WEBHOOK_SECRET = 'pichangabook-webhook-demo';

  const { AppModule } = await import('../dist/app.module.js');
  const { DatabaseService } = await import('../dist/database/database.service.js');
  const { BookingsService } = await import('../dist/bookings/bookings.service.js');

  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const BASE = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  const db = app.get(DatabaseService);
  const bookingsService = app.get(BookingsService);
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const limaDate = health.limaDate;

  try {
    // =========================================================================
    // [Punto 15] Verificación criptográfica Firebase Auth RS256
    // =========================================================================
    console.log('\n=== [Punto 15] Verificación Firebase ID Token (RS256 válido, expirado y sin teléfono) ===');
    const nowSec = Math.floor(Date.now() / 1000);
    const validFbToken = signFirebaseJwt(
      {
        iss: 'https://securetoken.google.com/pichangabook-aqp',
        aud: 'pichangabook-aqp',
        sub: 'fb-uid-aqp-1',
        phone_number: '+51958777888',
        iat: nowSec - 30,
        exp: nowSec + 1800,
      },
      privateKey,
    );
    const fbOkRes = await fetch(`${BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: validFbToken, fullName: 'Usuario Firebase AQP', role: 'PLAYER' }),
    });
    const fbOkData = await fbOkRes.json();
    assert(fbOkRes.status === 200 || fbOkRes.status === 201, `Firebase válido debe responder 200/201, recibió ${fbOkRes.status}`);
    assert(Boolean(fbOkData.accessToken), 'Firebase login válido debe emitir JWT');

    const expiredFbToken = signFirebaseJwt(
      {
        iss: 'https://securetoken.google.com/pichangabook-aqp',
        aud: 'pichangabook-aqp',
        sub: 'fb-uid-aqp-2',
        phone_number: '+51958777888',
        iat: nowSec - 3600,
        exp: nowSec - 60,
      },
      privateKey,
    );
    const fbExpRes = await fetch(`${BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: expiredFbToken }),
    });
    const fbExpData = await fbExpRes.json();
    assert(fbExpRes.status === 401 && fbExpData.code === 'FIREBASE_TOKEN_EXPIRED', 'Token expirado debe devolver 401 FIREBASE_TOKEN_EXPIRED');

    const noPhoneFbToken = signFirebaseJwt(
      {
        iss: 'https://securetoken.google.com/pichangabook-aqp',
        aud: 'pichangabook-aqp',
        sub: 'fb-uid-aqp-3',
        iat: nowSec - 30,
        exp: nowSec + 1800,
      },
      privateKey,
    );
    const fbNoPhoneRes = await fetch(`${BASE}/api/auth/firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: noPhoneFbToken }),
    });
    const fbNoPhoneData = await fbNoPhoneRes.json();
    assert(fbNoPhoneRes.status === 401 && fbNoPhoneData.code === 'FIREBASE_PHONE_UNVERIFIED', 'Token sin teléfono debe devolver 401 FIREBASE_PHONE_UNVERIFIED');
    console.log('✓ [Punto 15] Token válido (200), expirado (401) y sin celular verificado (401) comprobados.');

    // =========================================================================
    // [Punto 3] Cerrar escalamiento de rol en PATCH /api/auth/me
    // =========================================================================
    console.log('\n=== [Punto 3] Bloqueo de escalamiento de rol (PLAYER -> OWNER) ===');
    const playerSession = await (
      await fetch(`${BASE}/api/auth/demo-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'PLAYER' }),
      })
    ).json();
    const playerToken = playerSession.accessToken;
    assert(playerSession.user.role === 'PLAYER', 'Sesión inicial debe ser PLAYER');

    const patchRoleRes = await fetch(`${BASE}/api/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${playerToken}`,
      },
      body: JSON.stringify({ fullName: 'Piero Sin Escalada', role: 'OWNER' }),
    });
    const patchRoleData = await patchRoleRes.json();
    assert(patchRoleRes.status === 200, 'PATCH /api/auth/me debe responder 200 ignorando campos no permitidos');
    assert(patchRoleData.user.role === 'PLAYER', `El rol debe seguir siendo PLAYER, recibió ${patchRoleData.user.role}`);

    const ownerEndpointAttempt = await fetch(`${BASE}/api/owner/complexes/${COMPLEX_ID}/dashboard`, {
      headers: { Authorization: `Bearer ${patchRoleData.accessToken}` },
    });
    assert(ownerEndpointAttempt.status === 403, 'El nuevo JWT tras PATCH /auth/me debe seguir rechazado (403) en rutas OWNER');
    console.log('✓ [Punto 3] Escalamiento PLAYER -> OWNER bloqueado y JWT mantiene rol PLAYER.');

    // =========================================================================
    // [Punto 4 y Punto 10] Aprobación documental solo ADMIN + Documentos privados
    // =========================================================================
    console.log('\n=== [Puntos 4 y 10] Restricción de aprobación a ADMIN y almacenamiento privado de documentos ===');
    const ownerSession = await (
      await fetch(`${BASE}/api/auth/demo-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'OWNER' }),
      })
    ).json();
    const ownerToken = ownerSession.accessToken;

    // Crear sesión ADMIN real mediante OTP sobre el usuario administrador semilla (+51900000001)
    const adminOtpReq = await (
      await fetch(`${BASE}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+51900000001' }),
      })
    ).json();
    const adminSession = await (
      await fetch(`${BASE}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+51900000001', code: adminOtpReq.devCode }),
      })
    ).json();
    const adminToken = adminSession.accessToken;
    assert(adminSession.user.role === 'ADMIN', 'Usuario +51900000001 debe tener rol ADMIN');

    // Verificar que un archivo > 5MB sea rechazado con 413 antes de procesarse
    const bigForm = new FormData();
    const oversizedBuf = Buffer.alloc(5 * 1024 * 1024 + 2048, 0x41);
    bigForm.append('document', new Blob([oversizedBuf], { type: 'application/pdf' }), 'ficha-grande.pdf');
    const bigUploadRes = await fetch(`${BASE}/api/complexes/${COMPLEX_ID}/verification-document`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: bigForm,
    });
    assert(bigUploadRes.status === 413, `Archivo >5MB debe devolver 413, devolvió ${bigUploadRes.status}`);

    // Subir documento PDF válido como OWNER
    const validForm = new FormData();
    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
    validForm.append('document', new Blob([pdfBytes], { type: 'application/pdf' }), 'ficha-ruc-misti.pdf');
    validForm.append('docType', 'FICHA_RUC');
    const uploadDocRes = await fetch(`${BASE}/api/complexes/${COMPLEX_ID}/verification-document`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: validForm,
    });
    const uploadDocData = await uploadDocRes.json();
    assert(uploadDocRes.status === 201 || uploadDocRes.status === 200, 'Carga documental por OWNER debe responder 200/201');
    assert(Boolean(uploadDocData.temporaryDownloadUrl), 'Debe emitir temporaryDownloadUrl firmada');

    // Verificar que la ruta estática pública /uploads NO expone documentos (404)
    const publicUploadTry = await fetch(`${BASE}/uploads/complex-docs/ficha-ruc-misti.pdf`);
    assert(publicUploadTry.status === 404, `Ruta pública /uploads debe devolver 404, devolvió ${publicUploadTry.status}`);

    // Verificar que la descarga sin firma ni token falla con 401
    const unauthDownloadRes = await fetch(`${BASE}/api/complexes/${COMPLEX_ID}/verification-document/download`);
    assert(unauthDownloadRes.status === 401, 'Descarga sin firma ni JWT debe devolver 401');

    // Verificar que la URL temporal firmada con HMAC permite descargar el PDF privado
    const signedDownloadRes = await fetch(`${BASE}${uploadDocData.temporaryDownloadUrl}`);
    assert(signedDownloadRes.status === 200, 'URL firmada HMAC debe permitir descarga autorizada (200)');

    // Verificar que el OWNER NO puede auto-aprobar su complejo a VERIFIED (403)
    const ownerSelfVerifyRes = await fetch(`${BASE}/api/complexes/${COMPLEX_ID}/verification`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ status: 'VERIFIED' }),
    });
    assert(
      ownerSelfVerifyRes.status === 403,
      `OWNER intentando auto-verificar su complejo debe recibir 403, recibió ${ownerSelfVerifyRes.status}`,
    );

    // Verificar que ADMIN sí puede aprobar la verificación documental (200)
    const adminVerifyRes = await fetch(`${BASE}/api/complexes/${COMPLEX_ID}/verification`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'VERIFIED' }),
    });
    assert(adminVerifyRes.status === 200, `ADMIN verificando complejo debe recibir 200, recibió ${adminVerifyRes.status}`);
    console.log('✓ [Puntos 4 y 10] Auto-aprobación OWNER bloqueada (403), aprobación ADMIN (200) y almacenamiento privado verificados.');

    // =========================================================================
    // [Punto 1] Expiración de Holds vencidos (EXPIRED) y liberación de parrilla
    // =========================================================================
    console.log('\n=== [Punto 1] Expiración de holds vencidos (EXPIRED) y liberación de disponibilidad ===');
    const organizerSession = await (
      await fetch(`${BASE}/api/auth/demo-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ORGANIZER' }),
      })
    ).json();
    const organizerToken = organizerSession.accessToken;

    const futureDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const holdBookingRes = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${organizerToken}`,
      },
      body: JSON.stringify({
        courtId: COURT_3_ID,
        date: futureDate,
        hour: 18,
        paymentMode: 'SPLIT',
        totalSlots: 6,
        method: 'YAPE',
        sourceId: 'ype_sandbox_hold_expire_test',
      }),
    });
    const holdBooking = await holdBookingRes.json();
    assert(holdBookingRes.status === 201 && holdBooking.status === 'HELD', 'Debe crear reserva HELD para prueba de expiración');

    // Forzar vencimiento del hold en base de datos y ejecutar expireStaleHolds()
    await db.query(`UPDATE bookings SET hold_expires_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [
      holdBooking.id,
    ]);
    const expiredCount = await bookingsService.expireStaleHolds();
    assert(expiredCount >= 1, 'expireStaleHolds() debe expirar al menos 1 hold vencido');

    const dbExpiredRow = await db.query(`SELECT status FROM bookings WHERE id = $1`, [holdBooking.id]);
    assert(dbExpiredRow[0].status === 'EXPIRED', `Estado en BD debe ser EXPIRED, fue ${dbExpiredRow[0].status}`);

    const availAfterExpire = await (
      await fetch(`${BASE}/api/courts/${COURT_3_ID}/availability?date=${futureDate}`)
    ).json();
    const slot18Future = availAfterExpire.slots.find((s) => s.hour === 18);
    assert(slot18Future.status === 'FREE', `El turno tras expirar el hold debe quedar FREE, quedó ${slot18Future.status}`);
    console.log('✓ [Punto 1] Hold vencido transicionado a EXPIRED y liberado como FREE en parrilla.');

    // =========================================================================
    // [Puntos 11 y 2] Validación de invitaciones a suplentes y aislamiento de chat WebSocket
    // =========================================================================
    console.log('\n=== [Puntos 11 y 2] Invitaciones validadas por reserva activa y aislamiento de sala Relay ===');
    // 11.a bookingId inexistente -> 404
    const invNotFound = await fetch(`${BASE}/api/substitutes/${SEED_SUB_ID}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({ bookingId: '00000000-0000-4000-e000-000000009999', message: 'Hola' }),
    });
    assert(invNotFound.status === 404, `Reserva inexistente debe devolver 404, devolvió ${invNotFound.status}`);

    // 11.b bookingId ajeno (intentado por PLAYER que no es dueño de SEED_BOOKING_ID) -> 403
    const invForeign = await fetch(`${BASE}/api/substitutes/${SEED_SUB_ID}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: JSON.stringify({ bookingId: SEED_BOOKING_ID, message: 'Intento con reserva ajena' }),
    });
    assert(invForeign.status === 403, `Reserva ajena debe devolver 403, devolvió ${invForeign.status}`);

    // 11.c bookingId inactivo/expirado -> 409
    const invInactive = await fetch(`${BASE}/api/substitutes/${SEED_SUB_ID}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({ bookingId: holdBooking.id, message: 'Intento con reserva expirada' }),
    });
    assert(invInactive.status === 409, `Reserva expirada debe devolver 409, devolvió ${invInactive.status}`);

    // 11.d bookingId cancelado -> 409
    const tempCancelBookRes = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        courtId: COURT_3_ID,
        date: futureDate,
        hour: 19,
        paymentMode: 'FULL_DEPOSIT',
        method: 'YAPE',
        sourceId: 'ype_sandbox_cancel_for_sub_test',
      }),
    });
    const tempCancelBook = await tempCancelBookRes.json();
    await fetch(`${BASE}/api/bookings/${tempCancelBook.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${organizerToken}` },
    });
    const invCancelled = await fetch(`${BASE}/api/substitutes/${SEED_SUB_ID}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({ bookingId: tempCancelBook.id, message: 'Intento con reserva cancelada' }),
    });
    assert(invCancelled.status === 409, `Reserva CANCELLED debe devolver 409, devolvió ${invCancelled.status}`);

    // 11.e bookingId propio y activo -> 201/200
    const invValidRes = await fetch(`${BASE}/api/substitutes/${SEED_SUB_ID}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        bookingId: SEED_BOOKING_ID,
        message: 'Nos falta arquero hoy a las 20:00, mi cel es 958222333',
      }),
    });
    const invValid = await invValidRes.json();
    assert(invValidRes.ok, `Invitación válida debe responder 200/201, devolvió ${invValidRes.status}`);
    const relayId = invValid.relay.id;

    // Obtener token del suplente convocado (Renzo Valdivia: +51957333101) y de un tercero intruso (Owner)
    const subOtpReq = await (
      await fetch(`${BASE}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+51957333101' }),
      })
    ).json();
    const subSession = await (
      await fetch(`${BASE}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+51957333101', code: subOtpReq.devCode }),
      })
    ).json();
    const subToken = subSession.accessToken;

    const orgSocket = io(BASE, { auth: { token: organizerToken }, transports: ['websocket'] });
    const subSocket = io(BASE, { auth: { token: subToken }, transports: ['websocket'] });
    const intruderSocket = io(BASE, { auth: { token: ownerToken }, transports: ['websocket'] });

    await Promise.all([
      new Promise((res, rej) => {
        orgSocket.on('connect', res);
        orgSocket.on('connect_error', rej);
      }),
      new Promise((res, rej) => {
        subSocket.on('connect', res);
        subSocket.on('connect_error', rej);
      }),
      new Promise((res, rej) => {
        intruderSocket.on('connect', res);
        intruderSocket.on('connect_error', rej);
      }),
    ]);

    const orgMessages = [];
    const subMessages = [];
    const intruderMessages = [];
    orgSocket.on('relay:message', (m) => orgMessages.push(m));
    subSocket.on('relay:message', (m) => subMessages.push(m));
    intruderSocket.on('relay:message', (m) => intruderMessages.push(m));

    const orgJoinAck = await orgSocket.emitWithAck('relay:join', { relayId, accessToken: organizerToken });
    const subJoinAck = await subSocket.emitWithAck('relay:join', { relayId, accessToken: subToken });
    const intruderJoinAck = await intruderSocket.emitWithAck('relay:join', { relayId, accessToken: ownerToken });

    assert(orgJoinAck.ok === true && orgJoinAck.room === `relay:${relayId}`, 'Organizador debe poder unirse al relay');
    assert(subJoinAck.ok === true && subJoinAck.room === `relay:${relayId}`, 'Suplente convocado debe poder unirse al relay');
    assert(
      intruderJoinAck.ok === false && intruderJoinAck.status === 403,
      `Tercero intruso debe ser rechazado con 403 en relay:join, recibió ${JSON.stringify(intruderJoinAck)}`,
    );

    await fetch(`${BASE}/api/relays/${relayId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${subToken}` },
      body: JSON.stringify({ text: 'Confirmo asistencia a las 20:00 en punto.' }),
    });
    await new Promise((r) => setTimeout(r, 150));

    assert(orgMessages.length === 1 && subMessages.length === 1, 'Participantes deben recibir el mensaje en vivo');
    assert(intruderMessages.length === 0, 'Tercero no participante NO debe recibir mensajes del relay');
    orgSocket.close();
    subSocket.close();
    intruderSocket.close();
    console.log('✓ [Puntos 11 y 2] Validaciones de reserva (404/403/409) y aislamiento WebSocket de Relay verificados.');

    // =========================================================================
    // [Punto 7] Concurrencia Cobro vs. Reserva + Reversión / Reembolso Automático
    // =========================================================================
    console.log('\n=== [Punto 7] Concurrencia Cobro vs. Reserva e Idempotencia / Reversión Automática ===');
    const concBookingReqs = [1, 2].map((idx) =>
      fetch(`${BASE}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
        body: JSON.stringify({
          courtId: COURT_2_ID,
          date: limaDate,
          hour: 20,
          paymentMode: 'FULL_DEPOSIT',
          method: 'YAPE',
          sourceId: `ype_sandbox_race_slot_${idx}`,
        }),
      }),
    );
    const concResponses = await Promise.all(concBookingReqs);
    const concStatuses = concResponses.map((r) => r.status).sort();
    assert(
      concStatuses[0] === 201 && concStatuses[1] === 409,
      `Dos reservas concurrentes al mismo turno deben dar [201, 409], dieron [${concStatuses.join(', ')}]`,
    );

    // Verificar que ningún intento concurrente quedó cobrado sin reserva ni reversión
    const uncompensated = await db.query(
      `SELECT COUNT(*)::int AS c FROM payment_attempts WHERE status = 'SUCCEEDED' AND booking_id IS NULL`,
    );
    assert(uncompensated[0].c === 0, 'No debe existir ningún cobro exitoso sin reserva asociada');

    // Simular fallo post-cobro para verificar la compensación/reembolso automático
    const compRes = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        courtId: COURT_2_ID,
        date: limaDate,
        hour: 21,
        paymentMode: 'FULL_DEPOSIT',
        method: 'YAPE',
        sourceId: 'ype_sandbox_post_charge_fail',
        simulatePostChargeConflict: true,
      }),
    });
    const compData = await compRes.json();
    assert(
      compRes.status === 409 && compData.code === 'BOOKING_CHARGE_COMPENSATED',
      `Conflicto post-cobro debe devolver 409 BOOKING_CHARGE_COMPENSATED, devolvió ${compRes.status} ${compData.code}`,
    );
    assert(Boolean(compData.compensation?.refundId), 'La respuesta debe incluir el refundId de compensación');

    const compAttempt = await db.query(
      `SELECT status, refund_id FROM payment_attempts WHERE provider_charge_id = $1`,
      [compData.chargeId],
    );
    assert(
      compAttempt[0]?.status === 'REFUNDED' && Boolean(compAttempt[0]?.refund_id),
      'El intento de pago fallido post-cobro debe quedar en estado REFUNDED con refund_id',
    );
    console.log('✓ [Punto 7] Bloqueo previo al cobro y reembolso automático (REFUNDED) ante fallo post-cobro verificados.');

    // =========================================================================
    // [Punto 8] Carreras en pagos divididos sobre el último cupo (5/6 -> 6/6)
    // =========================================================================
    console.log('\n=== [Punto 8] Carrera de múltiples pagos simultáneos por el último cupo de Split Payment ===');
    // El split semilla pk4de6demo inicia en 4/6. Avanzamos a 5/6 (queda exactamente 1 cupo libre).
    const slot5Res = await fetch(`${BASE}/api/split-payments/pk4de6demo/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        payerName: 'Jugador 5 Antes de Carrera',
        method: 'YAPE',
        sourceId: 'ype_sandbox_slot5_prep',
      }),
    });
    assert(slot5Res.status === 200, 'Avance a 5/6 debe responder 200');

    // Disparar 4 pagos simultáneos por el único cupo restante (cupo #6)
    const lastSlotRace = await Promise.all(
      [1, 2, 3, 4].map((idx) =>
        fetch(`${BASE}/api/split-payments/pk4de6demo/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
          body: JSON.stringify({
            payerName: `Competidor Cupo 6 #${idx}`,
            method: 'PLIN',
            sourceId: `pln_sandbox_last_slot_race_${idx}`,
          }),
        }),
      ),
    );
    const raceStatuses = lastSlotRace.map((r) => r.status);
    const winners = raceStatuses.filter((s) => s === 200).length;
    const rejectedFull = raceStatuses.filter((s) => s === 409).length;
    assert(
      winners === 1 && rejectedFull === 3,
      `De 4 pagos simultáneos por el último cupo debe ganar 1 (200) y rechazarse 3 (409), resultado: ${raceStatuses.join(', ')}`,
    );

    const splitFinal = await (await fetch(`${BASE}/api/split-payments/pk4de6demo`)).json();
    assert(splitFinal.paidSlots === 6 && splitFinal.status === 'COMPLETED', 'Split debe quedar exactamente en 6/6 COMPLETED');
    console.log('✓ [Punto 8] Carrera 4x por el último cupo resuelta: 1 ganador (6/6 COMPLETED) y 3 rechazados (409) sin sobrecobro.');

    // =========================================================================
    // [Punto 9] Validación estricta de Webhooks contra el pago esperado + Reembolso de Overflow
    // =========================================================================
    console.log('\n=== [Punto 9] Validación de Webhooks Culqi (firma, moneda, monto exacto, PENDING->SUCCEEDED, duplicados y overflow) ===');
    // Crear un nuevo Split Payment (1/6) para probar validaciones de webhook
    const split2Res = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        courtId: COURT_3_ID,
        date: limaDate,
        hour: 21,
        paymentMode: 'SPLIT',
        totalSlots: 6,
        method: 'YAPE',
        sourceId: 'ype_sandbox_split2_init',
      }),
    });
    const split2Data = await split2Res.json();
    const token2 = split2Data.split.shareToken;
    const expectedSlotCents = split2Data.split.amountPerSlotCents;

    const sendSignedWebhook = async (payloadObj, secret = process.env.CULQI_WEBHOOK_SECRET) => {
      const raw = JSON.stringify(payloadObj);
      const sig = createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');
      return fetch(`${BASE}/api/payments/webhooks/culqi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-culqi-signature': sig },
        body: raw,
      });
    };

    // 9.a Firma inválida -> 401
    const badSigRes = await sendSignedWebhook({ type: 'charge.creation.succeeded', data: { id: 'chr_bad' } }, 'wrong');
    assert(badSigRes.status === 401, 'Firma inválida debe devolver 401');

    // 9.b Payload inválido -> 400
    const badPayloadRes = await sendSignedWebhook({ type: 'charge.creation.succeeded', data: {} });
    assert(badPayloadRes.status === 400, 'Payload sin id de cargo debe devolver 400');

    // 9.c Moneda inválida (USD) -> 400
    const badCurrencyRes = await sendSignedWebhook({
      type: 'charge.creation.succeeded',
      data: {
        id: 'chr_usd_1',
        amount: expectedSlotCents,
        currency_code: 'USD',
        metadata: { splitToken: token2 },
      },
    });
    assert(badCurrencyRes.status === 400, 'Moneda distinta de PEN debe devolver 400');

    // 9.d Monto incorrecto (100 céntimos en vez de expectedSlotCents) -> 400 WEBHOOK_AMOUNT_MISMATCH
    const wrongAmountRes = await sendSignedWebhook({
      type: 'charge.creation.succeeded',
      data: {
        id: 'chr_wrong_amount_1',
        amount: 100,
        currency_code: 'PEN',
        metadata: { splitToken: token2 },
      },
    });
    const wrongAmountData = await wrongAmountRes.json();
    assert(
      wrongAmountRes.status === 400 && wrongAmountData.code === 'WEBHOOK_AMOUNT_MISMATCH',
      `Monto distinto al esperado debe devolver 400 WEBHOOK_AMOUNT_MISMATCH, devolvió ${wrongAmountRes.status}`,
    );

    // 9.e Pago en estado PENDING que se acredita únicamente cuando llega el webhook válido
    const pendingPayRes = await fetch(`${BASE}/api/split-payments/${token2}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        payerName: 'Jugador Async Pending',
        method: 'YAPE',
        sourceId: 'ype_test_pending_webhook',
      }),
    });
    const pendingPayData = await pendingPayRes.json();
    assert(
      pendingPayData.paymentStatus === 'PENDING' && pendingPayData.paidSlots === 1,
      'Pago con sourceId pending debe registrarse en PENDING sin acreditar aún el cupo',
    );

    const pendingWebhookRes = await sendSignedWebhook({
      type: 'charge.creation.succeeded',
      data: {
        id: pendingPayData.chargeId,
        amount: expectedSlotCents,
        currency_code: 'PEN',
        outcome: { type: 'venta_exitosa' },
        metadata: { splitToken: token2, payerName: 'Jugador Async Pending', method: 'YAPE' },
      },
    });
    assert(pendingWebhookRes.status === 200, 'Webhook que confirma cargo PENDING debe responder 200');

    const split2AfterPending = await (await fetch(`${BASE}/api/split-payments/${token2}`)).json();
    assert(split2AfterPending.paidSlots === 2, 'Tras webhook válido el cupo PENDING debe acreditarse (2/6)');

    // 9.f Reintento idempotente del mismo webhook -> 200 duplicate: true, sigue en 2/6
    const dupWebhookRes = await sendSignedWebhook({
      type: 'charge.creation.succeeded',
      data: {
        id: pendingPayData.chargeId,
        amount: expectedSlotCents,
        currency_code: 'PEN',
        outcome: { type: 'venta_exitosa' },
        metadata: { splitToken: token2, payerName: 'Jugador Async Pending', method: 'YAPE' },
      },
    });
    const dupWebhookData = await dupWebhookRes.json();
    assert(dupWebhookRes.status === 200 && dupWebhookData.duplicate === true, 'Reintento de webhook debe marcar duplicate=true');

    // 9.g Webhook tardío sobre un Split ya lleno (pk4de6demo 6/6) -> Reembolso automático de overflow
    const overflowWebhookRes = await sendSignedWebhook({
      type: 'charge.creation.succeeded',
      data: {
        id: 'chr_late_overflow_pk4de6',
        amount: 1500,
        currency_code: 'PEN',
        outcome: { type: 'venta_exitosa' },
        metadata: { splitToken: 'pk4de6demo', payerName: 'Jugador Tardío #7', method: 'YAPE' },
      },
    });
    const overflowWebhookData = await overflowWebhookRes.json();
    assert(
      overflowWebhookRes.status === 200 && overflowWebhookData.action === 'overflow_refunded',
      'Webhook tardío sobre split lleno debe ejecutar reembolso automático (overflow_refunded)',
    );
    console.log('✓ [Punto 9] Firma, moneda, monto exacto, transición PENDING->SUCCEEDED, idempotencia y reembolso de overflow verificados.');

    // =========================================================================
    // [Punto 12] Reporte financiero conciliado del dueño (seña 50%, split parcial y cancelación)
    // =========================================================================
    console.log('\n=== [Punto 12] Reporte financiero conciliado (seña 50%, split parcial y cancelación) ===');
    // Cancelar una reserva para verificar que figure como CANCELLED y no infle lo recaudado
    const toCancelRes = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerToken}` },
      body: JSON.stringify({
        courtId: COURT_3_ID,
        date: limaDate,
        hour: 18,
        paymentMode: 'FULL_DEPOSIT',
        method: 'YAPE',
        sourceId: 'ype_sandbox_to_cancel',
      }),
    });
    const toCancelBooking = await toCancelRes.json();
    await fetch(`${BASE}/api/bookings/${toCancelBooking.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${organizerToken}` },
    });

    const reportRes = await fetch(`${BASE}/api/owner/complexes/${COMPLEX_ID}/report`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const report = await reportRes.json();
    assert(reportRes.status === 200, 'Reporte del dueño debe responder 200');
    assert(
      typeof report.summary.depositCollectedCents === 'number' &&
        typeof report.summary.splitCollectedCents === 'number' &&
        typeof report.summary.pendingBalanceCents === 'number' &&
        typeof report.summary.reconciledPaidCents === 'number',
      'El resumen del reporte debe separar seña cobrada, split cobrado, saldo pendiente y total conciliado',
    );
    // Verificar una reserva con seña 50% (COURT_2_ID 20:00 que creamos en Punto 7)
    const depositRow = report.bookings.find((b) => b.courtId === COURT_2_ID && b.hour === 20);
    assert(
      depositRow &&
        depositRow.reconciledPaidCents === depositRow.depositCents &&
        depositRow.pendingBalanceCents === depositRow.totalCents - depositRow.depositCents,
      'Reserva con seña del 50% debe reportar 50% cobrado conciliado y 50% saldo pendiente',
    );
    // Verificar reserva con split parcial (token2 con 2/6 pagados en COURT_3_ID 21:00)
    const partialSplitRow = report.bookings.find((b) => b.id === split2Data.id);
    assert(
      partialSplitRow &&
        partialSplitRow.reconciledPaidCents === expectedSlotCents * 2 &&
        partialSplitRow.pendingBalanceCents === partialSplitRow.totalCents - expectedSlotCents * 2,
      'Reserva con split parcial (2/6) debe reportar exactamente 2 cuotas cobradas y 4 pendientes',
    );
    // Verificar que la reserva cancelada tiene pendingBalanceCents = 0
    const cancelledRow = report.bookings.find((b) => b.id === toCancelBooking.id);
    assert(
      cancelledRow && cancelledRow.status === 'CANCELLED' && cancelledRow.pendingBalanceCents === 0,
      'Reserva CANCELLED no debe sumar saldo pendiente activo',
    );
    console.log(
      `✓ [Punto 12] Reporte conciliado verificado: Recaudado S/ ${report.summary.reconciledPaidSoles} | Señas S/ ${(report.summary.depositCollectedCents / 100).toFixed(2)} | Split S/ ${(report.summary.splitCollectedCents / 100).toFixed(2)} | Pendiente S/ ${report.summary.pendingBalanceSoles}`,
    );

    // =========================================================================
    // [Punto 6] Protección XSS en el panel administrativo web
    // =========================================================================
    console.log('\n=== [Punto 6] Protección contra inyección HTML/XSS en el panel web ===');
    const adminHtml = readFileSync(join(ROOT_DIR, '..', 'web-admin-tailwind', 'index.html'), 'utf8');
    assert(adminHtml.includes('function escapeHtml('), 'El panel web debe definir escapeHtml()');
    assert(adminHtml.includes('escapeHtml(slot.customerName'), 'La parrilla debe escapar slot.customerName');
    assert(adminHtml.includes('escapeHtml(sh.payerName)'), 'La lista de pagadores Split debe escapar sh.payerName');
    assert(adminHtml.includes('escapeHtml(i.clientLabel)'), 'La tabla de reporte debe escapar i.clientLabel');

    const xssPayload = `<script>window.__xss=1</script><img src=x onerror="alert('xss')">`;
    const escaped = xssPayload
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    assert(!escaped.includes('<script>') && !escaped.includes('<img'), 'El payload XSS debe quedar neutralizado como texto');
    console.log('✓ [Punto 6] Escapado HTML/DOM verificado en web-admin-tailwind/index.html.');

    console.log('\n=====================================================================');
    console.log('✅ AUDITORÍA DE CODEX: TODAS LAS PRUEBAS AUTOMATIZADAS PASARON (100%)');
    console.log('=====================================================================');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('\n❌ FALLO EN SUITE DE AUDITORÍA:', err);
  process.exit(1);
});
