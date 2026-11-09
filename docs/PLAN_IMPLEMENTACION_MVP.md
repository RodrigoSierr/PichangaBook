# PichangaBook Arequipa — Auditoría Técnica y Plan de Conversión a Aplicación Funcional

**Fecha de actualización:** 8 de noviembre de 2026  
**Autores:** Rodrigo Sierra, Samuel Iman  
**Arquitectura del Monorepo:**
- `backend-nestjs/`: API REST + WebSockets (NestJS + PostgreSQL / PGlite WASM + Socket.io)
- `mobile-flutter/`: Aplicación móvil Flutter (Dart) + configuración de distribución Android Release
- `web-admin-tailwind/`: Panel web omnicanal para dueños de complejos deportivos (`index.html`)

---

## 1. Estado de los 17 Puntos de la Auditoría Técnica de Codex

| # | Hallazgo de la Auditoría | Solución Técnica Implementada | Estado |
| :-: | :--- | :--- | :---: |
| **1** | `booking_status` en `schema.sql` no incluía `'EXPIRED'`, pero `expireStaleHolds()` lo asignaba. | Se añadió `'EXPIRED'` al enum `booking_status` en `backend-nestjs/schema.sql` y mediante la migración incremental `migrations/002_align_expired_and_payments_reconciliation.sql`. Se probó con un hold vencido verificando que pasa a `EXPIRED` y el turno vuelve a aparecer como `FREE`. | **Verificado** |
| **2** | `BookingsGateway` permitía `relay:join` sin validar participante y retransmitía eventos a `demo:global`. | `BookingsGateway.onJoinRelay()` ahora exige JWT y ejecuta `BookingsService.verifyRelayParticipant()` (`user_a_id`, `user_b_id` o `ADMIN`). Se eliminó la retransmisión de `relay:*` a `demo:global`. Probado con 3 sockets (2 participantes + 1 intruso rechazado con `403`). | **Verificado** |
| **3** | `AuthService.updateProfile()` y `UpdateProfileDto` permitían cambiar `role` vía `PATCH /api/auth/me`. | Se eliminó `role` de `UpdateProfileDto`, del `UPDATE users` en `AuthService.updateProfile()` y del diálogo de edición de perfil en Flutter (`MyBookingsScreen`), firmando siempre el JWT con el rol existente en BD. | **Verificado** |
| **4** | Un `OWNER` podía llamar `PATCH /api/complexes/:id/verification` y asignarse `VERIFIED`. | Se restringió `PATCH /api/complexes/:id/verification` exclusivamente a `@Roles('ADMIN')`, conservando el acceso de `OWNER`/`ADMIN` para la carga y consulta del documento de respaldo. | **Verificado** |
| **5** | Modo demo activo por defecto, exposición de OTP en respuesta/logs y rutas demo abiertas. | `AppConfig.allowDemoFallback` ahora es `false` por defecto y `validateStartupConfig()` valida el arranque en `production`. `OtpService` suprime `devCode`/`demoOtp` y logs fuera de demo; `/api/auth/demo-session` y `/api/demo/reset` devuelven `403` fuera de demo. | **Verificado** |
| **6** | Interpolación directa en `innerHTML` en `web-admin-tailwind/index.html` (riesgo XSS). | Se incorporó `escapeHtml()` en todas las plantillas dinámicas (`courtsContainer`, `eventsFeed`, `splitPayersList`, `complexMeta`, `modalCourtId`, `modalHour`, `reportTableBody`) y `.textContent` en `showToast()`. | **Verificado** |
| **7** | Carrera entre cobro en pasarela y creación de reserva (`createBooking`). | `createBooking()` ahora bloquea previamente el turno en BD con estado `PENDING_PAYMENT` (protegido por `EXCLUDE USING gist`), registra el intento en `payment_attempts`, envía `idempotencyKey` a Culqi y ejecuta `compensateBookingCharge()` (`culqi.refundCharge`) si falla la confirmación post-cobro. | **Verificado** |
| **8** | Carreras en pagos divididos sobre el último cupo (`paySplitSlot` / `recordVerifiedShare`). | Se añadió `reserved_slots` (con `CHECK (paid_slots + reserved_slots <= total_slots)`) bajo bloqueo `FOR UPDATE` antes de cobrar en pasarela, y reembolso automático (`overflow_refunded`) si llega un cargo asíncrono cuando el split ya se completó o expiró. | **Verificado** |
| **9** | `processCulqiWebhook()` no validaba monto exacto, moneda ni estado frente al pago esperado. | `processCulqiWebhook()` valida firma HMAC-SHA256 sobre `rawBody`, estructura del payload, moneda `PEN`, estado del cargo, referencia local (`payment_attempts` / `splitToken`) y monto exacto en céntimos (`WEBHOOK_AMOUNT_MISMATCH`), soportando `PENDING` → `SUCCEEDED` e idempotencia. | **Verificado** |
| **10** | Documentos RUC expuestos públicamente en `/uploads` y sin límite de tamaño en Multer. | Se configuró `limits: { fileSize: 5 MB }` en Multer (`413 Payload Too Large`), se retiró `/uploads` de los activos estáticos públicos en `main.ts` y `MediaService` guarda los documentos en `private-storage/complex-docs` (`0o600`) con descarga protegida por firma temporal HMAC o JWT de propietario/admin. | **Verificado** |
| **11** | `SubstitutesService.inviteSubstitute()` permitía crear invitaciones sin validar una reserva propia activa. | `inviteSubstitute()` exige `bookingId` UUID, verifica que exista (`404`), pertenezca al usuario autenticado (`403`) y esté en estado activo (`HELD` o `CONFIRMED` no expirado, `409`). | **Verificado** |
| **12** | `ownerReport()` sumaba `total_cents` sin conciliar pagos reales ni descontar saldos pendientes. | `ownerReport()` calcula los ingresos a partir de `payment_shares` con `status = 'PAID'`, separando `grossRevenueCents`, `reconciledPaidCents`, `depositCollectedCents`, `splitCollectedCents`, `receptionCollectedCents`, `pendingBalanceCents` y `refundedCents`. | **Verificado** |
| **13** | `mobile-flutter/test/widget_test.dart` conservaba `MyApp` y la prueba del contador por defecto. | Se reemplazó `widget_test.dart` por pruebas reales de `PichangaBookApp` (navegación, modo productivo sin opciones demo, protección de rol en actualización de perfil y convocatoria de suplente con `bookingId` activo). | **Verificado** |
| **14** | `DatabaseService` solo ejecutaba `schema.sql` + `seed.sql` si no existía `bookings`. | Se implementó un ejecutor de migraciones versionadas (`schema_migrations` + `migrations/*.sql`) que actualiza bases preexistentes sin pérdida de datos y carga `seed.sql` únicamente cuando `shouldSeedDemoData` es `true`. | **Verificado** |
| **15** | Integración de Firebase Auth incompleta en backend y mención inactiva en la UI móvil. | Se implementó verificación criptográfica RS256 de Firebase ID Tokens en `OtpService.verifyFirebaseIdToken()` (validando firma, `exp`, `aud`/`iss` y `phone_number`) y se ocultó la mención/opción de Firebase en `AuthSheet` salvo que se compile con `--dart-define=FIREBASE_AUTH_ENABLED=true`. | **Verificado** |
| **16** | `mobile-flutter/android/app/build.gradle.kts` firmaba `release` con llaves `debug` y faltaban permisos en `AndroidManifest.xml`. | Se configuró `signingConfigs.create("release")` leyendo `android/key.properties` o `PICHANGA_KEYSTORE_*` (bloqueando builds release sin keystore propio), se añadieron permisos (`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) y `com.google.android.geo.API_KEY` en `AndroidManifest.xml`, y se verificó el APK release firmado con `apksigner`. | **Verificado** |
| **17** | Documentación previa no diferenciaba integraciones reales vs. sandbox ni incluía salidas reproducibles de auditoría. | Se actualizaron `README.md`, `docs/PLAN_IMPLEMENTACION_MVP.md` e `IMPLEMENTATION_PROGRESS.md` con evidencia verificable, comandos reproducibles y estado real de cada integración. | **Verificado** |

---

## 2. Resumen de Verificación Reproducible

1. **Backend — Compilación y Suite de Auditoría (`backend-nestjs/`):**
   - `npm run build` → `0` errores TypeScript.
   - `npm run test:audit` → `100 % PASS` (Puntos 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14 y 15).
   - `npm run test:realtime` y `npm run test:concurrency` → `100 % PASS` (`1` reserva `201 Created` y `7` rechazos `409 Conflict` bajo ráfaga paralela).
2. **Móvil Flutter — Análisis, Pruebas y APK Release (`mobile-flutter/`):**
   - `flutter analyze` → `No issues found!`.
   - `flutter test` → `00:01 +5: All tests passed!` (`test/widget_test.dart` + `test/app_test.dart`).
   - `flutter build apk --release --dart-define=API_BASE_URL=http://10.0.2.2:3000` → `✓ Built build/app/outputs/flutter-apk/app-release.apk (62.4MB)`.
   - `apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk` → firmado con certificado Release `CN=PichangaBook Arequipa Release, OU=Mobile, O=PichangaBook, L=Arequipa, ST=Arequipa, C=PE`.
