const BASE = process.env.API_URL || 'http://localhost:3000';
const COURT_2_ID = '00000000-0000-4000-c000-00000000d012';

/**
 * Prueba de concurrencia: dispara 8 peticiones simultáneas sobre el mismo turno
 * (Cancha 2 · 22:00) combinando App Móvil y Bloqueo en Recepción.
 * Verifica que PostgreSQL (EXCLUDE USING gist) acepte EXACTAMENTE 1 (HTTP 201)
 * y rechace las 7 restantes con HTTP 409 Conflict (SLOT_TAKEN).
 */
async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const date = health.limaDate;

  const requests = Array.from({ length: 8 }, (_, idx) => {
    const isReception = idx % 2 === 0;
    const url = isReception ? `${BASE}/api/bookings/reception-block` : `${BASE}/api/bookings`;
    const body = isReception
      ? { courtId: COURT_2_ID, date, hour: 22, channel: 'RECEPTION', customerName: `Walk-in #${idx}` }
      : { courtId: COURT_2_ID, date, hour: 22, paymentMode: 'FULL_DEPOSIT' };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.status);
  });

  const statuses = await Promise.all(requests);
  const created = statuses.filter((s) => s === 201).length;
  const conflicts = statuses.filter((s) => s === 409).length;

  console.log('Códigos HTTP recibidos (8 peticiones paralelas):', statuses.join(', '));
  console.log(`Exitosas (201): ${created} | Conflictos evitados (409): ${conflicts}`);

  await fetch(`${BASE}/api/demo/reset`, { method: 'POST' });
  if (created !== 1 || conflicts !== 7) {
    throw new Error('Fallo en control de concurrencia');
  }
  console.log('✓ Garantía ACID anti doble-booking verificada con éxito.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
