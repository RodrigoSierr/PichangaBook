import { createHmac } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = process.env.API_URL || 'http://localhost:3000';
const COMPLEX_ID = '00000000-0000-4000-b000-00000000c001';
const COURT_1_ID = '00000000-0000-4000-c000-00000000d011';
const WEBHOOK_SECRET = process.env.CULQI_WEBHOOK_SECRET || 'pichangabook-webhook-demo';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  console.log('=== 1. Health & PostgreSQL Check ===');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log('Health:', health.status, '| Driver:', health.databaseDriver, '| Fecha Lima:', health.limaDate);
  assert(health.status === 'ok', 'Health status debe ser ok');

  console.log('\n=== 2. Autenticación JWT, OTP y Control de Roles (RBAC) ===');
  const otpReq = await (
    await fetch(`${BASE}/api/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+51958222333' }),
    })
  ).json();
  const otpCode = otpReq.devCode || otpReq.demoOtp;
  assert(Boolean(otpCode), 'Debe retornar devCode/demoOtp en modo sandbox');

  const otpVerify = await (
    await fetch(`${BASE}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '+51958222333',
        code: otpCode,
        fullName: 'Diego Salas',
        role: 'ORGANIZER',
      }),
    })
  ).json();
  assert(Boolean(otpVerify.accessToken), 'OTP verify debe emitir accessToken JWT');
  const organizerToken = otpVerify.accessToken;

  const ownerAuth = await (
    await fetch(`${BASE}/api/auth/demo-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'OWNER' }),
    })
  ).json();
  const ownerToken = ownerAuth.accessToken;
  assert(ownerAuth.user.role === 'OWNER', 'El rol de sesión demo OWNER debe ser OWNER');

  // Prueba RBAC: ORGANIZER no puede bloquear turnos de recepción ni ver el dashboard de dueño (403)
  const forbiddenRes = await fetch(`${BASE}/api/owner/complexes/${COMPLEX_ID}/dashboard`, {
    headers: { Authorization: `Bearer ${organizerToken}` },
  });
  assert(forbiddenRes.status === 403, `ORGANIZER en ruta OWNER debe recibir 403, recibió ${forbiddenRes.status}`);
  console.log('✓ JWT emitido y protección RBAC (401/403) verificada.');

  console.log('\n=== 3. Conectando cliente WebSocket (Socket.io) ===');
  const socket = io(BASE, {
    query: { complexId: COMPLEX_ID },
    auth: { token: ownerToken },
    transports: ['websocket'],
  });
  const eventsReceived = [];
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  socket.on('slot:updated', (p) => eventsReceived.push({ type: 'slot:updated', ...p }));
  socket.on('split:updated', (p) => eventsReceived.push({ type: 'split:updated', ...p }));
  console.log('Socket conectado id =', socket.id);

  console.log('\n=== 4. Bloqueo Rápido en Recepción (17:00) y prueba de Doble Booking ===');
  const blockRes = await fetch(`${BASE}/api/bookings/reception-block`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      courtId: COURT_1_ID,
      date: health.limaDate,
      hour: 17,
      channel: 'RECEPTION',
      customerName: 'Cliente Demo Recepción',
    }),
  });
  const blockJson = await blockRes.json();
  assert(blockRes.status === 201, `Bloqueo recepción esperado 201, recibido ${blockRes.status}`);
  console.log('Bloqueo recepción HTTP', blockRes.status, '->', blockJson.status, blockJson.label);

  // Intento simultáneo desde la App Móvil en el MISMO turno (debe ser rechazado 409 por PostgreSQL EXCLUDE GiST)
  const conflictRes = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${organizerToken}`,
    },
    body: JSON.stringify({
      courtId: COURT_1_ID,
      date: health.limaDate,
      hour: 17,
      paymentMode: 'FULL_DEPOSIT',
      sourceId: 'ype_sandbox_ok_conflict',
    }),
  });
  const conflictJson = await conflictRes.json();
  assert(conflictRes.status === 409, `Doble booking esperado 409, recibido ${conflictRes.status}`);
  console.log('Intento doble-booking HTTP', conflictRes.status, '->', conflictJson.code, conflictJson.message);

  console.log('\n=== 5. Validación de Pagos (sourceId requerido + rechazo de cargo declinado) ===');
  const declinedRes = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${organizerToken}`,
    },
    body: JSON.stringify({
      courtId: COURT_1_ID,
      date: health.limaDate,
      hour: 16,
      paymentMode: 'FULL_DEPOSIT',
      sourceId: 'tok_test_declined_card',
    }),
  });
  const declinedJson = await declinedRes.json();
  assert(declinedRes.status === 400 && declinedJson.code === 'PAYMENT_DECLINED', 'Cargo declinado debe devolver 400 PAYMENT_DECLINED');
  console.log('✓ Cargo declinado rechazado correctamente:', declinedJson.code);

  console.log('\n=== 6. Split Payment (4/6 -> 5/6) + Webhook Culqi HMAC-SHA256 & Idempotencia ===');
  const payRes = await fetch(`${BASE}/api/split-payments/pk4de6demo/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${organizerToken}`,
    },
    body: JSON.stringify({
      payerName: 'Rodrigo Sierra (UCSP)',
      payerPhone: '+51958999111',
      method: 'YAPE',
      sourceId: 'ype_sandbox_rodrigo_5',
    }),
  });
  const payJson = await payRes.json();
  assert(payRes.status === 200 && payJson.paidSlots === 5, `Paid slots esperado 5 (HTTP 200), recibido ${payJson.paidSlots} (${payRes.status})`);
  console.log('Split actualizado tras pago autenticado:', payJson.progressLabel);

  // Webhook sin firma debe fallar con 401
  const rawWebhookObj = {
    type: 'charge.creation.succeeded',
    data: {
      id: 'chr_webhook_final_slot_6',
      amount: 1500,
      currency_code: 'PEN',
      outcome: { type: 'venta_exitosa' },
      metadata: {
        splitToken: 'pk4de6demo',
        shareToken: 'pk4de6demo',
        payerName: 'Mateo Paredes (Webhook)',
        method: 'PLIN',
      },
    },
  };
  const rawBodyString = JSON.stringify(rawWebhookObj);

  const unsignedWebhookRes = await fetch(`${BASE}/api/payments/webhooks/culqi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBodyString,
  });
  assert(unsignedWebhookRes.status === 401, `Webhook sin firma debe devolver 401, devolvió ${unsignedWebhookRes.status}`);

  // Webhook con firma inválida debe fallar con 401
  const badSignature = createHmac('sha256', 'wrong_secret').update(Buffer.from(rawBodyString, 'utf8')).digest('hex');
  const badWebhookRes = await fetch(`${BASE}/api/payments/webhooks/culqi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-culqi-signature': badSignature,
    },
    body: rawBodyString,
  });
  assert(badWebhookRes.status === 401, `Webhook con firma inválida debe devolver 401, devolvió ${badWebhookRes.status}`);

  // Webhook con firma HMAC-SHA256 válida sobre rawBody (5/6 -> 6/6 COMPLETED y reserva CONFIRMED)
  const validSignature = createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(rawBodyString, 'utf8')).digest('hex');
  const signedWebhookRes = await fetch(`${BASE}/api/payments/webhooks/culqi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-culqi-signature': validSignature,
    },
    body: rawBodyString,
  });
  assert(signedWebhookRes.status === 200, `Webhook firmado debe devolver 200, devolvió ${signedWebhookRes.status}`);

  // Reenvío idéntico del mismo webhook (idempotencia por provider_charge_id): NO debe incrementar más allá de 6/6
  const duplicateWebhookRes = await fetch(`${BASE}/api/payments/webhooks/culqi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-culqi-signature': validSignature,
    },
    body: rawBodyString,
  });
  assert(duplicateWebhookRes.status === 200, 'Webhook duplicado debe ser idempotente (200)');

  const splitAfterWebhook = await (await fetch(`${BASE}/api/split-payments/pk4de6demo`)).json();
  assert(splitAfterWebhook.paidSlots === 6 && splitAfterWebhook.status === 'COMPLETED', 'Split debe quedar en 6/6 COMPLETED');
  console.log('✓ Webhook HMAC-SHA256 verificado e idempotencia confirmada:', splitAfterWebhook.progressLabel, splitAfterWebhook.status);

  console.log('\n=== 7. Bolsa de Suplentes + Enmascaramiento Antifraude en Chat/VoIP ===');
  const subs = await (await fetch(`${BASE}/api/substitutes?position=ARQUERO`)).json();
  const invRes = await fetch(`${BASE}/api/substitutes/${subs[0].id}/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${organizerToken}`,
    },
    body: JSON.stringify({
      bookingId: '00000000-0000-4000-e000-0000000000b2',
      message: 'Hola crack, mi celular es 958222333 llámame',
    }),
  });
  const inv = await invRes.json();
  assert(invRes.ok, `Invitación suplente esperada 200/201, recibió ${invRes.status}`);
  console.log('Proxy VoIP:', inv.relay.proxyNumber, '| Mensaje sanitizado:', inv.messages[0].body);

  console.log('\n=== 8. Reporte Financiero del Dueño y Mis Reservas ===');
  const reportRes = await fetch(`${BASE}/api/owner/complexes/${COMPLEX_ID}/report`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const reportJson = await reportRes.json();
  assert(reportRes.status === 200 && typeof reportJson.summary.confirmedRevenueSoles === 'number', 'Reporte de ingresos debe responder 200');
  console.log('✓ Reporte del complejo OK | Ingresos confirmados S/:', reportJson.summary.confirmedRevenueSoles);

  // Restaurar estado semilla para dejar lista la demo
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 150));

  console.log('\n=== 9. Eventos WebSocket recibidos en vivo ===');
  console.log('Total eventos Socket.io:', eventsReceived.length);
  assert(eventsReceived.length >= 2, 'Debe haber recibido eventos WebSocket en tiempo real');
  socket.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
