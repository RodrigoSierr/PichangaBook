# ⚽ PichangaBook Arequipa — Presentación Avance MVP (28 octubre 2026)

**Curso:** Formación de Empresas de Base Tecnológica I — Universidad Católica San Pablo (UCSP)  
**Integrantes:** Rodrigo Sierra · Samuel Iman  
**Prototipo de referencia en Figma:** [Diseño de Alta Fidelidad](https://www.figma.com/design/JSWjCZWJUp021pyKt4UNI5/Untitled?node-id=0-1&t=ok2yvvmVHRqFFUcK-1)

---

## 1. Estructura del Monorepo

```text
PichangaBook v.1/
├── docker-compose.yml               # Orquestación PostgreSQL 16 + API NestJS
├── render.yaml                      # Manifiesto Cloud Hosting con HTTPS/SSL
├── backend-nestjs/                  # API REST + WebSockets (NestJS + TypeScript + PostgreSQL)
│   ├── schema.sql                   # Esquema ACID + EXCLUDE USING gist anti doble-booking
│   ├── seed.sql                     # Datos semilla de Arequipa (distritos, canchas, split 4/6, suplentes)
│   ├── docker-compose.yml           # Compose local para levantar desde /backend-nestjs
│   ├── Dockerfile                   # Imagen multi-stage Node 22 Alpine
│   ├── public/media/                # Fotos de canchas y clips H.264 (15-30s) de suplentes
│   ├── scripts/
│   │   ├── realtime-smoke-test.mjs  # Prueba integral REST + Socket.io + Split + Enmascaramiento
│   │   └── concurrency-test.mjs     # Prueba de 8 reservas simultáneas (1x 201 + 7x 409 Conflict)
│   └── src/
│       ├── auth/                    # OTP SMS (Firebase/Supabase/Demo) y registro diferenciado
│       ├── complexes/               # Mapa Arequipa, validación RUC módulo 11 y parrilla horaria
│       ├── bookings/                # Transacciones ACID, Split Payment, Webhook Culqi y BookingsGateway
│       ├── substitutes/             # Bolsa de suplentes (clips 15-30s) y chat/VoIP enmascarado
│       ├── integrations/            # Google Maps API, Cloudinary/S3 signed uploads y Culqi HMAC
│       └── database/                # Driver dual PostgreSQL (pg.Pool + PGlite WASM embebido)
├── web-admin-tailwind/              # Panel Web Omnicanal para Dueños (HTML5 + Tailwind CSS + Socket.io)
│   └── index.html
└── mobile-flutter/                  # App Móvil para Jugadores y Organizadores (Flutter / Dart)
    ├── pubspec.yaml
    ├── demo-app-mobile.html         # Espejo interactivo en vivo conectado al backend
    └── lib/
        ├── main.dart
        ├── services/realtime_api_service.dart
        └── screens/
            ├── arequipa_map_screen.dart
            ├── court_detail_screen.dart
            ├── split_payment_screen.dart
            └── substitutes_pool_screen.dart
```

---

## 2. Instrucciones Rápidas para Levantar la Demo en Vivo

### Opción A — Ejecución Inmediata (Zero-Config con PostgreSQL Embebido WASM)
No requiere tener Docker corriendo: el backend levanta PostgreSQL embebido (`@electric-sql/pglite` con la extensión `btree_gist`) y aplica automáticamente `schema.sql` + `seed.sql`:

```bash
cd "backend-nestjs"
npm run build
npm run start:prod
```

Una vez iniciado en `http://localhost:3000`, abre **dos ventanas en paralelo**:
1. **Ventana Izquierda (Panel Web del Dueño / Recepción):** `http://localhost:3000/admin/`
2. **Ventana Derecha (App Móvil Espejo del Jugador / Organizador):** `http://localhost:3000/mobile/`

### Opción B — Con Docker Compose (PostgreSQL 16 + NestJS Contenedorizados)
```bash
docker compose up --build
```

### Pruebas Automatizadas en Consola (para mostrar durante la sustentación)
```bash
cd "backend-nestjs"
npm run test:realtime      # Verifica Socket.io, Split 4/6 -> 5/6 y enmascaramiento telefónico
npm run test:concurrency   # Dispara 8 reservas al mismo milisegundo -> 1 HTTP 201 y 7 HTTP 409
```
*(Incluimos el botón **↺ Reset Demo** en la barra superior del Panel del Dueño o `POST /api/demo/reset` para restaurar todo a su estado inicial cuantas veces sea necesario).*

---

## 3. Guion de Demostración en Vivo (Paso a Paso frente al Jurado)

1. **Sincronización Omnicanal en Tiempo Real y Prevención de Doble Booking (Socket.io + ACID):**
   - Coloca lado a lado `http://localhost:3000/admin/` (Recepción) y `http://localhost:3000/mobile/` (pestaña **⚽ Reservar**).
   - En el **Panel del Dueño**, haz clic sobre cualquier turno **● LIBRE** (ej. `17:00` en *Cancha 1 · Fútbol 6*) o en el botón amarillo **«Bloqueo Rápido (Venta en Recepción)»** y confirma.
   - Observa cómo en **menos de 50 ms** el turno pasa a **🔒 Ocupado (RECEP.)** en la **App Móvil** vía `BookingsGateway` (`slot:updated`) y se registra en la bitácora en vivo.
   - Haz clic en **«Liberar»** desde Recepción y observa cómo vuelve a habilitarse instantáneamente en la app móvil.

2. **Sistema Híbrido de Pagos y Split Payment («Cupos pagados: 4 de 6»):**
   - En la **App Móvil**, abre la pestaña **💸 Split 4/6**.
   - Muestra el contador visual en vivo **«Cupos pagados: 4 de 6»** (`S/ 60.00 / S/ 90.00`), el botón **📲 Enviar a WhatsApp** (que genera el mensaje con link de cobro fraccionado) y los 4 pagos previos verificados con Culqi.
   - Haz clic en **«Abonar S/ 15»** (con Yape, Plin o Tarjeta). Tanto en la App Móvil como en el monitor derecho del Panel del Dueño la barra sube en vivo a **«Cupos pagados: 5 de 6»** y, al abonar el sexto cupo, el turno pasa automáticamente de `HELD` a `CONFIRMED` (**6 de 6**).

3. **Bolsa de Suplentes Verificados con Clips de 15–30 s y Contacto Enmascarado:**
   - En la **App Móvil**, entra a **🎬 Suplentes**, filtra por posición (**🧤 Arquero**, **⚡ Delantero**, etc.) y reproduce el **minirreproductor de video (18s–28s)** para validar el nivel técnico del jugador.
   - Haz clic en **«⚡ Convocar Ahora (Chat / VoIP Enmascarado)»**: se abre el canal seguro con número virtual proxy (`+51 (054) 64X-XXX`) manteniendo oculto el celular real (`+51 9•• ••• 101`). Escribe un mensaje que incluya un número de celular (ej. `Mi número es 958222333`) y observa cómo el backend lo sanitiza automáticamente a `[número oculto 🔒]`.

4. **Validación Documental Antifraude (RUC SUNAT + Licencia Municipal):**
   - En el **Panel del Dueño**, prueba el validador de **Módulo 11 SUNAT** (`20601458722` válido vs `20601458729` inválido), cambia el selector superior de sede a **«El Misti · Sede Sachaca (RUC Pendiente)»** y haz clic en **«Subir RUC / Licencia»** para ver la transición en tiempo real `PENDING` → `IN_REVIEW` → `VERIFIED`.
