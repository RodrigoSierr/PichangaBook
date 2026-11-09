const BASE = process.env.API_URL || 'http://localhost:3000';
const COURT_2_ID = '00000000-0000-4000-c000-00000000d012';

/**
 * Prueba de concurrencia autenticada:
 * 1. Obtiene tokens JWT reales para OWNER y ORGANIZER.
 * 2. Verifica que llamadas sin token devuelvan HTTP 401 Unauthorized.
 * 3. Dispara 8 peticiones simultáneas sobre el mismo turno (Cancha 2 · 22:00)
 *    combinando App Móvil (ORGANIZER + sourceId válido) y Bloqueo en Recepción (OWNER).
 * 4. Verifica que PostgreSQL (EXCLUDE USING gist) acepte EXACTAMENTE 1 (HTTP 201)
 *    y rechace las 7 restantes con HTTP 409 Conflict (SLOT_TAKEN).
 */
async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const date = health.limaDate;

  const ownerAuth = await (
    await fetch(`${BASE}/api/auth/demo-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'OWNER' }),
    })
  ).json();

  const organizerAuth = await (
    await fetch(`${BASE}/api/auth/demo-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'ORGANIZER' }),
    })
  ).json();

  // Verificar rechazo de petición sin JWT (401)
  const unauthStatus = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      courtId: COURT_2_ID,
      date,
      hour: 22,
      paymentMode: 'FULL_DEPOSIT',
      sourceId: 'ype_sandbox_unauth',
    }),
  }).then((r) => r.status);

  if (unauthStatus !== 401) {
    throw new Error(`Se esperaba HTTP 401 sin token y se recibió ${unauthStatus}`);
  }

  const requests = Array.from({ length: 8 }, (_, idx) => {
    const isReception = idx % 2 === 0;
    const url = isReception ? `${BASE}/api/bookings/reception-block` : `${BASE}/api/bookings`;
    const token = isReception ? ownerAuth.accessToken : organizerAuth.accessToken;
    const body = isReception
      ? { courtId: COURT_2_ID, date, hour: 22, channel: 'RECEPTION', customerName: `Walk-in #${idx}` }
      : {
          courtId: COURT_2_ID,
          date,
          hour: 22,
          paymentMode: 'FULL_DEPOSIT',
          method: 'YAPE',
          sourceId: `ype_sandbox_conc_${idx}`,
        };
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }).then((r) => r.status);
  });

  const statuses = await Promise.all(requests);
  const created = statuses.filter((s) => s === 201).length;
  const conflicts = statuses.filter((s) => s === 409).length;

  console.log('Códigos HTTP recibidos (8 peticiones paralelas autenticadas):', statuses.join(', '));
  console.log(`Exitosas (201): ${created} | Conflictos evitados (409): ${conflicts} | Guard 401 verificado`);

  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (created !== 1 || conflicts !== 7) {
    throw new Error('Fallo en control de concurrencia');
  }
  console.log('✓ Garantía ACID anti doble-booking y AuthGuard verificadas con éxito.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
