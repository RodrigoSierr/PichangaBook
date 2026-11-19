# Guía Rápida de Despliegue 100% Gratuito (Render Free + Neon / Supabase + Cron-Job.org)

Esta guía paso a paso te permite desplegar **PichangaBook Arequipa** en producción con **costo $0/mes**, sirviendo desde un único contenedor HTTPS tanto la **API REST + Socket.IO** como el **Panel Web de Propietarios (`/admin/`)** y la **Vista Móvil Web (`/mobile/`)**, con base de datos PostgreSQL persistente y protección contra el disco efímero y el *spin-down* del plan gratuito.

---

## 1. Crear la Base de Datos PostgreSQL Gratis (Neon.tech o Supabase)

Render ofrece PostgreSQL gratuito solo por 30 días, por lo que usamos **Neon.tech** o **Supabase** (ambos con capa gratuita permanente y soporte nativo para la extensión `btree_gist`).

### Opción A — Neon.tech (Recomendada por velocidad serverless)
1. Ingresa a [https://neon.tech](https://neon.tech) y crea una cuenta gratuita.
2. Crea un proyecto nuevo llamado `pichangabook-arequipa` (región recomendada: **AWS US East** o **São Paulo**).
3. En el **Dashboard → Connection Details**, copia la cadena de conexión (**Connection string**):
   ```text
   postgresql://neondb_owner:TU_PASSWORD@ep-ejemplo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Opción B — Supabase
1. Ingresa a [https://supabase.com](https://supabase.com) y crea un proyecto gratuito en la región **South America (São Paulo)**.
2. Ve a **Project Settings → Database → Connection string → URI** (modo *Session* en puerto `5432` para soportar migraciones y transacciones ACID con `FOR UPDATE`).
3. Copia la URL y reemplaza `[YOUR-PASSWORD]` por la contraseña que definiste al crear el proyecto:
   ```text
   postgresql://postgres.tu-proyecto:TU_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
   ```

> **Nota sobre SSL y Migraciones:** No necesitas ejecutar SQL manualmente. El backend detecta automáticamente `neon.tech`, `supabase.co`, `render.com` o `sslmode=require` y activa `ssl: { rejectUnauthorized: false }`. Además, al iniciar con `DB_AUTO_MIGRATE=true`, crea automáticamente la extensión `btree_gist`, ejecuta `schema.sql` y aplica las migraciones `001` a `004` (incluyendo los 10 distritos maestros de Arequipa).

---

## 2. Desplegar el Servidor Unificado en Render (Plan Free)

El archivo [Dockerfile](file:///c:/Users/sierr/OneDrive/Documents/PichangaBook/Dockerfile) y [render.yaml](file:///c:/Users/sierr/OneDrive/Documents/PichangaBook/render.yaml) en la raíz del repositorio empaquetan todo el sistema en un único servicio web gratuito (`plan: free`):

### Opción 1 — Despliegue automático con Blueprint (`render.yaml`)
1. Sube este repositorio a tu cuenta de **GitHub**.
2. Ingresa a [https://dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
3. Conecta tu repositorio `PichangaBook`. Render detectará automáticamente `render.yaml`.
4. Render generará automáticamente los secretos criptográficos (`JWT_SECRET`, `MEDIA_SIGNING_SECRET`, `CULQI_WEBHOOK_SECRET`) y te pedirá completar las variables con `sync: false`.
5. Pega tu cadena de Neon o Supabase en **`DATABASE_URL`**.
6. Haz clic en **Apply** para iniciar el despliegue.

### Opción 2 — Creación manual como Web Service en Render
1. En Render Dashboard haz clic en **New +** → **Web Service** y selecciona tu repositorio de GitHub.
2. Configura:
   - **Runtime:** `Docker`
   - **Dockerfile Path:** `./Dockerfile`
   - **Instance Type:** `Free` ($0/mes)
3. En **Environment Variables**, agrega:
   - `NODE_ENV` = `production`
   - `ALLOW_DEMO_FALLBACK` = `false`
   - `DB_SEED_DEMO` = `false`
   - `DB_AUTO_MIGRATE` = `true`
   - `DB_SSL` = `true`
   - `DATABASE_URL` = *(pega tu URL de Neon.tech o Supabase)*
   - `JWT_SECRET` = *(cadena aleatoria segura de al menos 32 caracteres)*
   - `MEDIA_SIGNING_SECRET` = *(cadena aleatoria segura de al menos 32 caracteres)*
   - `CULQI_WEBHOOK_SECRET` = *(secreto de webhook de Culqi o cadena segura de 32 caracteres)*
   - `PUBLIC_URL` = `https://<tu-servicio>.onrender.com`
   - `CORS_ORIGINS` = `https://<tu-servicio>.onrender.com`

### URLs Públicas una vez desplegado
Bajo el mismo dominio HTTPS de Render (sin conflictos de CORS):
- **Healthcheck y Estado:** `https://<tu-servicio>.onrender.com/api/health`
- **Panel Web Propietarios / Recepción:** `https://<tu-servicio>.onrender.com/admin/`
- **App Móvil Web (Jugadores / Organizadores):** `https://<tu-servicio>.onrender.com/mobile/`

---

## 3. Evitar que el Servidor se Duerma (Ping Gratuito en `cron-job.org`)

El plan gratuito de Render apaga el contenedor tras 15 minutos sin tráfico (*spin-down*), haciendo que la primera petición tarde ~40 segundos. Para mantenerlo activo 24/7 gratis:

1. Crea una cuenta gratuita en [https://cron-job.org](https://cron-job.org).
2. Haz clic en **Create Cronjob**:
   - **Title:** `PichangaBook Keep-Alive`
   - **URL:** `https://<tu-servicio>.onrender.com/api/health`
   - **Execution schedule:** Cada **10 minutos** (`*/10 * * * *`)
   - **Request method:** `GET`
   - **Timeout:** `30 seconds`
3. Guarda y activa el cronjob. Cada 10 minutos consultará `/api/health`, manteniendo despiertos tanto el contenedor de Render como la conexión al pool de PostgreSQL.

---

## 4. Protección frente al Disco Efímero de Render Free

En el plan gratuito de Render, el sistema de archivos local del contenedor se reinicia en cada *redeploy*. Para garantizar que las fichas RUC y licencias municipales (`PDF`/`JPG`/`PNG`) subidas por los dueños de complejos nunca devuelvan `404`:

1. Al subir un documento en `POST /api/complexes/:id/verification-document`, `MediaService` guarda el archivo en `private-storage/complex-docs/` **y además respalda automáticamente el binario codificado en Base64 y su MIME type en PostgreSQL** (`complexes.license_doc_base64` y `complexes.license_doc_mime`, añadidos en la migración `004_backup_verification_documents_db.sql`).
2. Si el contenedor de Render se reinicia y borra `private-storage/`, la siguiente descarga firmada (`GET /api/complexes/:id/verification-document/download`) restaura automáticamente el PDF desde PostgreSQL, reconstruye la caché en disco y entrega el documento sin interrupción.
