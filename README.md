# ⚽ PichangaBook Arequipa — Plataforma Omnicanal de Reservas y Suplentes Verificados

**Curso:** Formación de Empresas de Base Tecnológica I — Universidad Católica San Pablo (UCSP)  
**Integrantes:** Rodrigo Sierra · Samuel Iman  
**Prototipo de referencia en Figma:** [Diseño de Alta Fidelidad](https://www.figma.com/design/JSWjCZWJUp021pyKt4UNI5/Untitled?node-id=0-1&t=ok2yvvmVHRqFFUcK-1)

---

## 1. Estructura del Monorepo

```text
PichangaBook v.1/
├── docker-compose.yml               # Orquestación PostgreSQL 16 + API NestJS
├── render.yaml                      # Manifiesto Cloud Hosting con HTTPS/SSL
├── IMPLEMENTATION_PROGRESS.md       # Seguimiento y evidencia de los 17 puntos de la auditoría de Codex
├── docs/
│   └── PLAN_IMPLEMENTACION_MVP.md   # Auditoría técnica, matriz de integraciones y resultados de pruebas
├── backend-nestjs/                  # API REST + WebSockets (NestJS + TypeScript + PostgreSQL)
│   ├── .env.example                 # Variables de entorno (DB, JWT, Culqi, HMAC, Firebase, Cloudinary)
│   ├── schema.sql                   # Esquema ACID (14 tablas incl. payment_attempts) + EXCLUDE USING gist
│   ├── migrations/                  # Migraciones incrementales versionadas (schema_migrations)
│   │   └── 002_align_expired_and_payments_reconciliation.sql
│   ├── seed.sql                     # Datos semilla de Arequipa (cargados solo cuando ALLOW_DEMO_FALLBACK=true)
│   ├── scripts/
│   │   ├── codex-audit-test.mjs     # Suite integral de verificación de los puntos de la auditoría de Codex
│   │   ├── realtime-smoke-test.mjs  # Prueba de humo RBAC + Pagos + Webhook HMAC + Socket.io + Relay
│   │   └── concurrency-test.mjs     # Prueba de 8 reservas simultáneas (1x 201 + 7x 409 + Guard 401)
│   └── src/
│       ├── config/                  # Configuración tipada y validación de arranque productivo
│       ├── auth/                    # OTP SMS, Firebase ID Token (RS256), JWT AuthGuard y @Roles
│       ├── complexes/               # Mapa Arequipa, RUC módulo 11, documentos privados y aprobación ADMIN
│       ├── bookings/                # Reservas ACID, Split Payment con cupos reservados, reembolsos y Gateway
│       ├── substitutes/             # Bolsa de suplentes (clips 15-30s) y chat/VoIP aislado por participante
│       ├── integrations/            # Culqi (cargos, idempotencia, reembolsos y HMAC) y almacenamiento privado
│       └── database/                # Driver dual PostgreSQL (pg.Pool + PGlite WASM) y migrador incremental
├── web-admin-tailwind/              # Panel Web Omnicanal para Dueños (HTML5 + Tailwind CSS + Socket.io)
│   └── index.html
└── mobile-flutter/                  # App Móvil para Jugadores y Organizadores (Flutter / Dart)
    ├── pubspec.yaml
    ├── android/                     # Configuración de firma Release (key.properties.example) y permisos
    ├── demo-app-mobile.html         # Espejo interactivo en vivo conectado al backend
    ├── test/
    │   ├── widget_test.dart         # Pruebas de navegación, modo no-demo, protección de rol y suplentes
    │   └── app_test.dart            # Pruebas unitarias y flujo completo de pantallas (5/5 PASS en total)
    └── lib/
        ├── main.dart
        ├── config/app_config.dart
        ├── theme/app_theme.dart
        ├── models/models.dart
        ├── services/realtime_api_service.dart
        └── screens/
            ├── auth_sheet.dart
            ├── arequipa_map_screen.dart
            ├── court_detail_screen.dart
            ├── split_payment_screen.dart
            ├── substitutes_pool_screen.dart
            └── my_bookings_screen.dart
```

---

## 2. Configuración e Instalación

### 2.1 Variables de Entorno del Backend (`backend-nestjs/.env`)
Copia `backend-nestjs/.env.example` a `backend-nestjs/.env`. Por seguridad, el modo de demostración está **desactivado por defecto** (`ALLOW_DEMO_FALLBACK=false`):
- En **modo estricto / producción (`ALLOW_DEMO_FALLBACK=false`)**: no se cargan datos semilla de demostración, `/api/auth/otp/request` no devuelve ni registra códigos OTP en consola, y los endpoints `/api/auth/demo-session` y `/api/demo/reset` responden `403 Forbidden`. Además, si `NODE_ENV=production`, `validateStartupConfig()` exige `DATABASE_URL`, `JWT_SECRET` seguro y rechaza `AUTH_PROVIDER=DEMO`.
- En **modo demostración local (`ALLOW_DEMO_FALLBACK=true` fuera de producción)**: si no se define `DATABASE_URL`, levanta PGlite WASM embebido con la extensión `btree_gist`, ejecuta las migraciones versionadas (`schema_migrations`), carga `seed.sql` si la base está vacía y habilita el simulador determinista de pagos/reembolsos de Culqi.

| Variable | Propósito | Valor por defecto |
| :--- | :--- | :--- |
| `NODE_ENV` | Entorno de ejecución (`development` \| `production`) | `development` |
| `PORT` | Puerto HTTP y WebSocket | `3000` |
| `ALLOW_DEMO_FALLBACK` | Habilita funciones de demostración y sandbox local (solo fuera de producción) | `false` *(opt-in)* |
| `DATABASE_URL` | Cadena de conexión PostgreSQL 16 (obligatoria en `production`) | *(vacío → PGlite en dev)* |
| `JWT_SECRET` | Secreto HMAC-SHA256 para firmar tokens JWT (mín. 16 caracteres en producción) | *(requerido en prod)* |
| `MEDIA_SIGNING_SECRET` | Secreto HMAC-SHA256 para firmar URLs temporales de documentos privados | *(hereda `JWT_SECRET`)* |
| `CULQI_SECRET_KEY` | Llave privada de Culqi (`sk_test_...` / `sk_live_...`) para cargos y reembolsos reales | *(vacío → requiere `ALLOW_DEMO_FALLBACK=true` para sandbox)* |
| `CULQI_WEBHOOK_SECRET` | Secreto HMAC-SHA256 para validar `x-culqi-signature` sobre `req.rawBody` | `pichangabook-webhook-demo` |
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase para verificar tokens RS256 en `POST /api/auth/firebase` | *(opcional)* |
| `FIREBASE_PUBLIC_KEY` | Certificado/llave pública PEM para verificación local RS256 de Firebase | *(opcional; descarga de Google si no se define)* |

### 2.2 Ejecución del Backend y Paneles Web

#### Modo Demostración Local (con PGlite embebido y datos semilla de Arequipa)
```bash
cd "backend-nestjs"
npm install
npm run build
npm run start:demo
```

#### Modo Productivo / Estricto (sin funciones demo ni exposición de OTP)
```bash
cd "backend-nestjs"
npm run build
npm run start:prod
```

Una vez iniciado en `http://localhost:3000`:
1. **Panel Web del Dueño / Recepción (`OWNER`):** `http://localhost:3000/admin/`
2. **Espejo Web Móvil (`ORGANIZER` / `PLAYER`):** `http://localhost:3000/mobile/`
3. **Healthcheck de base de datos e integraciones:** `http://localhost:3000/api/health`

### 2.3 Ejecución y Compilación de la App Móvil Flutter (`mobile-flutter/`)
```bash
cd "mobile-flutter"
flutter pub get

# Análisis estático y suite de pruebas (5/5 tests)
flutter analyze
flutter test

# Compilar APK Android Release firmado (requiere android/key.properties o variables PICHANGA_KEYSTORE_*)
flutter build apk --release --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

---

## 3. Suite de Pruebas Automatizadas Reproducibles

### 3.1 Suite Integral de Auditoría de Codex (15 Puntos de Backend, BD, Pagos, WebSockets y XSS)
```bash
cd "backend-nestjs"
npm run build
npm run test:audit
```
Verifica automáticamente:
- **Punto 1:** Expiración de holds vencidos (`EXPIRED` en `bookings` y `split_payments`) y liberación como `FREE` en la parrilla horaria.
- **Punto 2:** Aislamiento de salas WebSocket `relay:<id>` con verificación JWT de participante y bloqueo `403` a terceros (sin retransmisión a `demo:global`).
- **Punto 3:** Bloqueo de escalamiento de rol (`PLAYER` → `OWNER`) en `PATCH /api/auth/me` y preservación del rol en el JWT.
- **Punto 4:** Restricción de `PATCH /api/complexes/:id/verification` exclusivamente a `@Roles('ADMIN')` (`403` para el propietario del complejo).
- **Punto 5:** Modo demo opt-in (`allowDemoFallback = false` por defecto), validación de arranque productivo, omisión de `devCode`/`demoOtp` en respuestas OTP y bloqueo `403` de `/api/auth/demo-session` y `/api/demo/reset`.
- **Punto 6:** Escapado HTML (`escapeHtml` / `textContent`) contra XSS en `web-admin-tailwind/index.html`.
- **Punto 7:** Coordinación cobro vs. reserva con bloqueo previo `PENDING_PAYMENT`, auditoría en `payment_attempts`, idempotencia y reembolso automático (`REFUNDED` con `refund_id`) ante conflicto post-cobro.
- **Punto 8:** Coordinación de pagos simultáneos por el último cupo de un Split Payment (`reserved_slots` bajo `FOR UPDATE`) y reembolso automático ante sobrecupo vía webhook (`overflow_refunded`).
- **Punto 9:** Validación estricta de webhooks Culqi (firma HMAC-SHA256 sobre `rawBody`, moneda `PEN`, monto exacto en céntimos, transición `PENDING` → `SUCCEEDED` e idempotencia ante duplicados).
- **Punto 10:** Almacenamiento privado de documentos de verificación (`private-storage/complex-docs`), límite Multer de `5 MB` (`413`), retiro de `/uploads` público (`404`) y descarga autorizada vía URL firmada HMAC temporal.
- **Punto 11:** Validación de `bookingId` existente (`404`), propio (`403`) y activo (`409` en expiradas/canceladas) en `POST /api/substitutes/:id/invite`.
- **Punto 12:** Reporte financiero conciliado (`GET /api/owner/complexes/:id/report`) separando valor bruto activo, señas cobradas (`depositCollectedCents`), cuotas split cobradas (`splitCollectedCents`), saldo pendiente (`pendingBalanceCents`) y reservas canceladas.
- **Punto 14:** Migraciones incrementales versionadas (`schema_migrations`) en instalación limpia (`0` filas demo cuando `seedDemo: false`) y sobre bases de datos preexistentes.
- **Punto 15:** Verificación criptográfica RS256 de Firebase ID Tokens (token válido `200`, expirado `401 FIREBASE_TOKEN_EXPIRED` y sin celular `401 FIREBASE_PHONE_UNVERIFIED`).

### 3.2 Pruebas de Humo y Concurrencia sobre Servidor en Vivo
```bash
cd "backend-nestjs"
PORT=3099 ALLOW_DEMO_FALLBACK=true node dist/main.js &
API_URL=http://localhost:3099 npm run test:realtime
API_URL=http://localhost:3099 npm run test:concurrency
```

### 3.3 Pruebas de Flutter y Verificación de Firma Android Release
```bash
cd "mobile-flutter"
flutter analyze && flutter test
flutter build apk --release --dart-define=API_BASE_URL=http://10.0.2.2:3000
apksigner verify --print-certs build/app/outputs/flutter-apk/app-release.apk
```
