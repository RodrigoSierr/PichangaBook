# PichangaBook Arequipa — Registro de Implementación y Verificación (Auditoría de Codex · 17 Puntos)

**Fecha de verificación final:** 8 de noviembre de 2026  
**Estado global:** **17 / 17 puntos completados y verificados con pruebas ejecutadas (`100 % PASS`)**

---

## 1. Resumen Ejecutivo por Fase y Punto de Auditoría

| # | Fase | Punto de la Auditoría de Codex | Estado | Archivos Modificados / Creados | Prueba Ejecutada y Resultado Real |
| :-: | :--- | :--- | :---: | :--- | :--- |
| **1** | **FASE 2** | **Alinear el estado de expiración (`EXPIRED` en `booking_status`)** | **Completado y Verificado** | `backend-nestjs/schema.sql`, `backend-nestjs/migrations/002_align_expired_and_payments_reconciliation.sql`, `backend-nestjs/src/bookings/bookings.service.ts` | `npm run test:audit` → Crea hold vencido, ejecuta `expireStaleHolds()`, verifica `status = 'EXPIRED'` en BD y `status = 'FREE'` en `/api/courts/:id/availability`. |
| **2** | **FASE 5** | **Aislar el chat en tiempo real (`relay:join` con JWT y sin `demo:global`)** | **Completado y Verificado** | `backend-nestjs/src/bookings/bookings.gateway.ts`, `backend-nestjs/src/bookings/bookings.service.ts`, `mobile-flutter/lib/services/realtime_api_service.dart` | `npm run test:audit` → Conecta 3 clientes Socket.io (Organizador, Suplente y Tercero); verifica que el tercero recibe `status: 403` en `relay:join` y `0` mensajes en `relay:<id>` y `demo:global`. |
| **3** | **FASE 1** | **Cerrar el escalamiento de rol (`PATCH /api/auth/me`)** | **Completado y Verificado** | `backend-nestjs/src/auth/dto/auth.dto.ts`, `backend-nestjs/src/auth/auth.service.ts`, `mobile-flutter/lib/services/realtime_api_service.dart`, `mobile-flutter/lib/screens/my_bookings_screen.dart` | `npm run test:audit` + `flutter test` → Intenta `PATCH /api/auth/me` con `{ role: 'OWNER' }` desde cuenta `PLAYER`; verifica que usuario y nuevo JWT conservan `PLAYER` y rutas `@Roles('OWNER')` responden `403`. |
| **4** | **FASE 1 / 4** | **Restringir aprobación documental a `ADMIN` (`PATCH /complexes/:id/verification`)** | **Completado y Verificado** | `backend-nestjs/src/complexes/complexes.controller.ts`, `backend-nestjs/src/complexes/complexes.service.ts` | `npm run test:audit` → Verifica que `OWNER` puede subir/consultar su documento (`201`/`200`), recibe `403` al intentar auto-asignar `VERIFIED`, y `ADMIN` aprueba con `200`. |
| **5** | **FASE 1** | **Hacer demo opt-in y local (`allowDemoFallback = false` por defecto)** | **Completado y Verificado** | `backend-nestjs/src/config/app.config.ts`, `backend-nestjs/src/auth/otp.service.ts`, `backend-nestjs/src/app.controller.ts` | `npm run test:audit` → Verifica `allowDemoFallback === false` por defecto, rechazo de `validateStartupConfig()` en producción inválida, `/api/auth/otp/request` sin `devCode`/`demoOtp` y bloqueo `403` de `/api/auth/demo-session` y `/api/demo/reset`. |
| **6** | **FASE 6** | **Proteger datos del panel contra XSS (`escapeHtml` / `textContent`)** | **Completado y Verificado** | `web-admin-tailwind/index.html`, `mobile-flutter/demo-app-mobile.html` | `npm run test:audit` → Verifica escapado de `customerName`, `payerName`, `courtName`, `clientLabel` y eventos del feed, además de `.textContent` en `showToast()`. |
| **7** | **FASE 2 / 3** | **Resolver cobro vs. reserva (bloqueo previo `PENDING_PAYMENT`, `payment_attempts`, idempotencia y reembolso automático)** | **Completado y Verificado** | `backend-nestjs/src/bookings/bookings.service.ts`, `backend-nestjs/src/integrations/culqi.service.ts`, `backend-nestjs/schema.sql` | `npm run test:audit` + `npm run test:concurrency` → Dos reservas concurrentes producen `[201, 409]` con `0` cargos huérfanos; fallo post-cobro dispara `compensateBookingCharge()` dejando `status = 'REFUNDED'` y `refund_id` trazable. |
| **8** | **FASE 3** | **Resolver carreras en pagos divididos (`reserved_slots` bajo `FOR UPDATE` y reembolso de sobrecupo)** | **Completado y Verificado** | `backend-nestjs/src/bookings/bookings.service.ts`, `backend-nestjs/schema.sql`, `backend-nestjs/migrations/002_align_expired_and_payments_reconciliation.sql` | `npm run test:audit` → Dispara 4 pagos simultáneos cuando queda 1 solo cupo (`5/6`): exactamente 1 completa `6/6 COMPLETED` (`200`) y 3 reciben `409 SPLIT_SLOTS_FULL` sin cobro; un cargo excedente vía webhook se reembolsa automáticamente (`overflow_refunded`). |
| **9** | **FASE 3** | **Validar webhooks contra el pago esperado (firma HMAC, moneda `PEN`, monto exacto, `PENDING` → `SUCCEEDED` e idempotencia)** | **Completado y Verificado** | `backend-nestjs/src/bookings/bookings.service.ts`, `backend-nestjs/src/bookings/bookings.controller.ts`, `backend-nestjs/src/integrations/culqi.service.ts` | `npm run test:audit` → Prueba firma inválida (`401`), payload malformado (`400`), moneda `USD` (`400`), monto distinto (`400 WEBHOOK_AMOUNT_MISMATCH`), acreditación `PENDING` → `SUCCEEDED` (`200`) y duplicado idempotente (`200 duplicate: true`). |
| **10** | **FASE 4** | **Privatizar documentos de verificación (límite Multer 5 MB, retiro de `/uploads` público y firma HMAC temporal)** | **Completado y Verificado** | `backend-nestjs/src/main.ts`, `backend-nestjs/src/integrations/media.service.ts`, `backend-nestjs/src/complexes/complexes.controller.ts`, `backend-nestjs/src/complexes/complexes.service.ts` | `npm run test:audit` → Verifica que archivo `> 5 MB` devuelve `413`, `GET /uploads/...` devuelve `404`, descarga sin firma devuelve `401` y URL temporal HMAC descarga el PDF (`200`). |
| **11** | **FASE 5** | **Corregir invitaciones a suplentes (`bookingId` existente, activa y propia)** | **Completado y Verificado** | `backend-nestjs/src/substitutes/substitutes.service.ts`, `backend-nestjs/src/substitutes/dto/substitutes.dto.ts`, `mobile-flutter/lib/screens/substitutes_pool_screen.dart` | `npm run test:audit` + `flutter test` → Prueba `bookingId` inexistente (`404`), ajeno (`403`), expirado (`409`), cancelado (`409`) y propio activo (`200`/`201`). |
| **12** | **FASE 3 / 6** | **Corregir ingresos del reporte (`payment_shares` conciliados, seña, split, pendiente y cancelaciones)** | **Completado y Verificado** | `backend-nestjs/src/bookings/bookings.service.ts`, `web-admin-tailwind/index.html` | `npm run test:audit` → Verifica reserva con 50 % de seña (`reconciledPaidCents = 50 %`, `pendingBalanceCents = 50 %`), split parcial `2/6` (`2` cuotas cobradas y `4` pendientes) y reserva `CANCELLED` (`pendingBalanceCents = 0`). |
| **13** | **FASE 7** | **Reparar pruebas Flutter (`widget_test.dart` sobre `PichangaBookApp`)** | **Completado y Verificado** | `mobile-flutter/test/widget_test.dart`, `mobile-flutter/test/app_test.dart`, `mobile-flutter/lib/screens/auth_sheet.dart` | `flutter analyze` (`No issues found!`) y `flutter test` (`00:01 +5: All tests passed!`). |
| **14** | **FASE 8** | **Completar migraciones versionadas (`schema_migrations`) y seed condicional** | **Completado y Verificado** | `backend-nestjs/src/database/database.service.ts`, `backend-nestjs/migrations/002_align_expired_and_payments_reconciliation.sql` | `npm run test:audit` → Verifica instalación limpia con `seedDemo: false` (`0` distritos semilla, `001` y `002` aplicadas) y actualización no destructiva de una BD preexistente. |
| **15** | **FASE 1 / 7** | **Completar integración Firebase RS256 en backend y ocultar UI inactiva en Flutter** | **Completado y Verificado** | `backend-nestjs/src/auth/otp.service.ts`, `backend-nestjs/src/config/app.config.ts`, `mobile-flutter/lib/config/app_config.dart`, `mobile-flutter/lib/screens/auth_sheet.dart` | `npm run test:audit` + `flutter test` → Verifica token RS256 válido (`200`), expirado (`401 FIREBASE_TOKEN_EXPIRED`) y sin teléfono (`401 FIREBASE_PHONE_UNVERIFIED`); oculta mención/opción inactiva en `AuthSheet` salvo `--dart-define=FIREBASE_AUTH_ENABLED=true`. |
| **16** | **FASE 9** | **Preparar distribución Android (firma release, permisos y API keys por entorno)** | **Completado y Verificado** | `mobile-flutter/android/app/build.gradle.kts`, `mobile-flutter/android/app/src/main/AndroidManifest.xml`, `mobile-flutter/android/key.properties.example`, `mobile-flutter/.gitignore` | `flutter build apk --release --dart-define=API_BASE_URL=http://10.0.2.2:3000` (`✓ Built build/app/outputs/flutter-apk/app-release.apk (62.4MB)`) + `apksigner verify --print-certs` (`CN=PichangaBook Arequipa Release`). |
| **17** | **FASE 10** | **Actualizar documentación basada en evidencia** | **Completado y Verificado** | `README.md`, `docs/PLAN_IMPLEMENTACION_MVP.md`, `IMPLEMENTATION_PROGRESS.md` | Documentación alineada con estado real, matriz de integraciones (Live vs. Sandbox) y salidas reproducibles. |

---

## 2. Comandos Reproducibles y Resultados Verificados

### 2.1 Compilación y Suite Completa de Auditoría en Backend (`backend-nestjs/`)
```bash
cd "backend-nestjs"
npm run build
npm run test:audit
```
**Resultado obtenido (código de salida `0`):**
```text
=== [Punto 14] Migraciones incrementales versionadas y seed condicional ===
✓ [Punto 14] Instalación limpia (0 filas demo) y upgrade incremental verificados.
=== [Punto 5] Modo demo opt-in y validación de configuración productiva ===
✓ [Punto 5] Respuesta OTP sin código expuesto y bloqueo 403 de rutas demo verificados.
=== [Punto 15] Verificación Firebase ID Token (RS256 válido, expirado y sin teléfono) ===
✓ [Punto 15] Token válido (200), expirado (401) y sin celular verificado (401) comprobados.
=== [Punto 3] Bloqueo de escalamiento de rol (PLAYER -> OWNER) ===
✓ [Punto 3] Escalamiento PLAYER -> OWNER bloqueado y JWT mantiene rol PLAYER.
=== [Puntos 4 y 10] Restricción de aprobación a ADMIN y almacenamiento privado de documentos ===
✓ [Puntos 4 y 10] Auto-aprobación OWNER bloqueada (403), aprobación ADMIN (200) y almacenamiento privado verificados.
=== [Punto 1] Expiración de holds vencidos (EXPIRED) y liberación de disponibilidad ===
✓ [Punto 1] Hold vencido transicionado a EXPIRED y liberado como FREE en parrilla.
=== [Puntos 11 y 2] Invitaciones validadas por reserva activa y aislamiento de sala Relay ===
✓ [Puntos 11 y 2] Validaciones de reserva (404/403/409) y aislamiento WebSocket de Relay verificados.
=== [Punto 7] Concurrencia Cobro vs. Reserva e Idempotencia / Reversión Automática ===
✓ [Punto 7] Bloqueo previo al cobro y reembolso automático (REFUNDED) ante fallo post-cobro verificados.
=== [Punto 8] Carrera de múltiples pagos simultáneos por el último cupo de Split Payment ===
✓ [Punto 8] Carrera 4x por el último cupo resuelta: 1 ganador (6/6 COMPLETED) y 3 rechazados (409) sin sobrecobro.
=== [Punto 9] Validación de Webhooks Culqi (firma, moneda, monto exacto, PENDING->SUCCEEDED, duplicados y overflow) ===
✓ [Punto 9] Firma, moneda, monto exacto, transición PENDING->SUCCEEDED, idempotencia y reembolso de overflow verificados.
=== [Punto 12] Reporte financiero conciliado (seña 50%, split parcial y cancelación) ===
✓ [Punto 12] Reporte conciliado verificado: Recaudado S/ 688.34 | Señas S/ 245.00 | Split S/ 133.34 | Pendiente S/ 331.66
=== [Punto 6] Protección contra inyección HTML/XSS en el panel web ===
✓ [Punto 6] Escapado HTML/DOM verificado en web-admin-tailwind/index.html.
✅ AUDITORÍA DE CODEX: TODAS LAS PRUEBAS AUTOMATIZADAS PASARON (100%)
```

### 2.2 Pruebas de Humo en Tiempo Real y Concurrencia GiST (`backend-nestjs/`)
```bash
cd "backend-nestjs"
PORT=3099 ALLOW_DEMO_FALLBACK=true node dist/main.js &
API_URL=http://localhost:3099 npm run test:realtime
API_URL=http://localhost:3099 npm run test:concurrency
```
**Resultado obtenido (código de salida `0`):**
- `test:realtime`: JWT + RBAC (`401`/`403`), bloqueo en recepción (`201`), rechazo anti doble-booking (`409 SLOT_TAKEN`), rechazo `PAYMENT_DECLINED` (`400`), Split `4/6 -> 6/6 COMPLETED` vía webhook HMAC-SHA256 e idempotencia, invitación a suplente con `bookingId` activo y reporte conciliado.
- `test:concurrency`: `Códigos HTTP recibidos (8 peticiones paralelas autenticadas): 201, 409, 409, 409, 409, 409, 409, 409` (`Exitosas (201): 1 | Conflictos evitados (409): 7 | Guard 401 verificado`).

### 2.3 Análisis Estático, Pruebas de Widgets y Build Android Release (`mobile-flutter/`)
```bash
export PATH="/home/rtf-/.local/bin:$PATH"
cd "mobile-flutter"
flutter analyze && flutter test
flutter build apk --release --dart-define=API_BASE_URL=http://10.0.2.2:3000
apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk
```
**Resultado obtenido (código de salida `0`):**
- `flutter analyze`: `No issues found! (ran in 1.3s)`
- `flutter test`: `00:01 +5: All tests passed!` (`test/widget_test.dart` y `test/app_test.dart`)
- `flutter build apk --release`: `✓ Built build/app/outputs/flutter-apk/app-release.apk (62.4MB)`
- `apksigner verify --print-certs`: `Signer #1 certificate DN: CN=PichangaBook Arequipa Release, OU=Mobile, O=PichangaBook, L=Arequipa, ST=Arequipa, C=PE` (`SHA-256: 0d2d5b1c0908c42fc67acec255a9d4d1102718b426e476a1dfd3cfa8af3f46fd`)

---

## 3. Distinción Transparente: Implementación Real vs. Simulación Sandbox y Credenciales Externas

| Subsistema | Implementación Real Verificada en el Repositorio | Comportamiento sin Credenciales Externas (`ALLOW_DEMO_FALLBACK=false`, por defecto) | Comportamiento en Sandbox Local Opt-In (`ALLOW_DEMO_FALLBACK=true` fuera de producción) | Credenciales Externas para Producción Live |
| :--- | :--- | :--- | :--- | :--- |
| **Base de Datos y Migraciones** | Esquema relacional ACID (`schema.sql` + `migrations/002_*.sql`), tabla `schema_migrations`, restricción `EXCLUDE USING gist (bookings_no_overlap)` y bloqueos `FOR UPDATE`. | Si no hay `DATABASE_URL`, en desarrollo usa PGlite WASM sin cargar `seed.sql`; en `NODE_ENV=production` exige `DATABASE_URL` al arrancar. | Carga `seed.sql` sólo si la tabla `districts` está vacía y `ALLOW_DEMO_FALLBACK=true`. | `DATABASE_URL` (PostgreSQL 16 gestionado). |
| **Autenticación OTP y Firebase** | Emisión/verificación de desafíos OTP con límite de intentos, bloqueo de escalamiento de rol en `/api/auth/me` y verificación criptográfica RS256 de Firebase ID Tokens (`verifyFirebaseIdToken`). | No expone ni registra códigos OTP en respuestas HTTP ni consola; bloquea `/api/auth/demo-session` y `/api/demo/reset` con `403`. | Expone `devCode` en `/api/auth/otp/request` y habilita `/api/auth/demo-session` para pruebas locales. | `FIREBASE_PROJECT_ID`, `FIREBASE_PUBLIC_KEY` (o certs de Google) y proveedor SMS para envío de OTP. |
| **Pagos y Reembolsos (Culqi)** | Bloqueo previo `PENDING_PAYMENT`, reserva de cupo `reserved_slots`, tabla `payment_attempts`, llave de idempotencia `X-Culqi-Idempotency-Key`, cliente REST `POST /v2/charges` y `POST /v2/refunds`, y validación estricta de webhooks HMAC-SHA256 (moneda `PEN`, monto exacto e idempotencia). | Rechaza cargos sin `CULQI_SECRET_KEY` y marca reembolsos sin credenciales como `unverified_no_credentials` (`COMPENSATION_FAILED`). | Simula cargos y reembolsos deterministas (`chr_sandbox_*`, `ref_sandbox_*`, `tok_test_declined`, `ype_test_pending`) marcando `simulated: true`. | `CULQI_PUBLIC_KEY`, `CULQI_SECRET_KEY`, `CULQI_WEBHOOK_SECRET`. |
| **Documentos de Verificación RUC** | Validación algorítmica SUNAT Módulo 11, límite Multer de `5 MB`, almacenamiento privado fuera de `/public` (`private-storage/complex-docs`), descarga firmada con HMAC temporal y aprobación exclusiva por `@Roles('ADMIN')`. | Opera 100 % en almacenamiento privado local con permisos `0o600` y URLs temporales firmadas. | Igual que en modo estricto (nunca expone `/uploads` públicamente). | `MEDIA_SIGNING_SECRET` (y opcionalmente `CLOUDINARY_*` para clips de video). |
| **Distribución Android** | Configuración de firma `release` (`key.properties` / `PICHANGA_KEYSTORE_*`), bloqueo de compilación release sin keystore propio y permisos/metadatos en `AndroidManifest.xml`. | Exige `android/key.properties` o variables `PICHANGA_KEYSTORE_*` para `assembleRelease`. | Igual que en producción (no usa llaves `debug` en `release`). | `MAPS_API_KEY` (Google Maps SDK for Android) y keystore de producción en CI/CD. |
