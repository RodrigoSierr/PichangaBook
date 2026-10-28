import { io } from 'socket.io-client';

const BASE = process.env.API_URL || 'http://localhost:3000';
const COMPLEX_ID = '00000000-0000-4000-b000-00000000c001';
const COURT_1_ID = '00000000-0000-4000-c000-00000000d011';

async function main() {
  console.log('=== 1. Health & PostgreSQL Check ===');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log('Health:', health.status, '| Driver:', health.databaseDriver, '| Fecha Lima:', health.limaDate);

  console.log('\n=== 2. Conectando cliente WebSocket (Socket.io) ===');
  const socket = io(BASE, { query: { complexId: COMPLEX_ID }, transports: ['websocket'] });
  const eventsReceived = [];
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  socket.on('slot:updated', (p) => eventsReceived.push({ type: 'slot:updated', ...p }));
  socket.on('split:updated', (p) => eventsReceived.push({ type: 'split:updated', ...p }));

  console.log('Socket conectado id =', socket.id);

  console.log('\n=== 3. Bloqueo Rápido en Recepción (17:00) y prueba de Doble Booking ===');
  const blockRes = await fetch(`${BASE}/api/bookings/reception-block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId: COURT_1_ID,
      date: health.limaDate,
      hour: 17,
      channel: 'RECEPTION',
      customerName: 'Cliente Demo Recepción',
    }),
  });
  const blockJson = await blockRes.json();
  console.log('Bloqueo recepción HTTP', blockRes.status, '->', blockJson.status, blockJson.label);

  // Intento simultáneo desde la App Móvil en el MISMO turno (debe ser rechazado 409 por PostgreSQL EXCLUDE GiST)
  const conflictRes = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId: COURT_1_ID,
      date: health.limaDate,
      hour: 17,
      paymentMode: 'FULL_DEPOSIT',
    }),
  });
  const conflictJson = await conflictRes.json();
  console.log('Intento doble-booking HTTP', conflictRes.status, '->', conflictJson.code, conflictJson.message);

  console.log('\n=== 4. Split Payment (4/6 -> 5/6) con Webhook Culqi HMAC-SHA256 ===');
  const payRes = await fetch(`${BASE}/api/split-payments/pk4de6demo/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payerName: 'Rodrigo Sierra (UCSP)', method: 'YAPE' }),
  });
  const payJson = await payRes.json();
  console.log('Split actualizado:', payJson.progressLabel);

  console.log('\n=== 5. Bolsa de Suplentes + Enmascaramiento Antifraude en Chat/VoIP ===');
  const subs = await (await fetch(`${BASE}/api/substitutes?position=ARQUERO`)).json();
  const inv = await (
    await fetch(`${BASE}/api/substitutes/${subs[0].id}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hola crack, mi celular es 958222333 llámame' }),
    })
  ).json();
  console.log('Proxy VoIP:', inv.relay.proxyNumber, '| Mensaje sanitizado:', inv.messages[0].body);

  // Restaurar estado semilla para dejar lista la demo
  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 150));

  console.log('\n=== 6. Eventos WebSocket recibidos en vivo ===');
  console.log('Total eventos Socket.io:', eventsReceived.length);
  socket.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
