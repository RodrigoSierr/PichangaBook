-- =============================================================================
--  PichangaBook Arequipa · Esquema relacional PostgreSQL (MVP · Avance 28-oct-2026)
--  Formación de Empresas de Base Tecnológica I · UCSP
--  Autores: Rodrigo Sierra · Samuel Iman
--
--  Principios de diseño
--   * ACID: toda operación de reserva/pago corre dentro de una transacción.
--   * Anti doble-booking a nivel de motor: restricción EXCLUDE (GiST) sobre el
--     rango horario de cada cancha. Aunque dos clientes (app + recepción)
--     intenten tomar el mismo turno en el mismo milisegundo, PostgreSQL acepta
--     solo una fila; la otra recibe SQLSTATE 23P01 (exclusion_violation).
--   * Privacidad: el teléfono real (E.164) nunca se expone por la API; se
--     publica únicamente la columna generada `phone_masked`.
--   * Dinero en céntimos (INTEGER) para evitar errores de coma flotante.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- igualdad (=) dentro de índices GiST

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
CREATE TYPE user_role           AS ENUM ('PLAYER', 'ORGANIZER', 'OWNER', 'ADMIN');
CREATE TYPE verification_status AS ENUM ('PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED');
CREATE TYPE booking_status      AS ENUM ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'BLOCKED', 'CANCELLED');
CREATE TYPE booking_channel     AS ENUM ('APP', 'RECEPTION', 'PHONE', 'WHATSAPP');
CREATE TYPE payment_mode        AS ENUM ('FULL_DEPOSIT', 'SPLIT');
CREATE TYPE split_status        AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED', 'CANCELLED');
CREATE TYPE payment_method      AS ENUM ('CARD', 'YAPE', 'PLIN');
CREATE TYPE payment_provider    AS ENUM ('CULQI', 'MERCADO_PAGO');
CREATE TYPE share_status        AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');
CREATE TYPE player_position     AS ENUM ('ARQUERO', 'DEFENSA', 'MEDIOCAMPO', 'DELANTERO');
CREATE TYPE media_provider      AS ENUM ('CLOUDINARY', 'S3', 'LOCAL_DEMO');
CREATE TYPE invitation_status   AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- -----------------------------------------------------------------------------
-- Catálogo de distritos de Arequipa (centroide para el mapa / filtros)
-- -----------------------------------------------------------------------------
CREATE TABLE districts (
    code        VARCHAR(32)  PRIMARY KEY,               -- p.ej. 'CAYMA'
    name        VARCHAR(80)  NOT NULL UNIQUE,
    lat         NUMERIC(9,6) NOT NULL,
    lng         NUMERIC(9,6) NOT NULL,
    is_key_zone BOOLEAN      NOT NULL DEFAULT FALSE      -- distritos foco del MVP
);

-- -----------------------------------------------------------------------------
-- Usuarios (registro diferenciado por rol + OTP SMS)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name          VARCHAR(120) NOT NULL,
    role               user_role    NOT NULL,
    phone_e164         VARCHAR(16)  NOT NULL UNIQUE
                       CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    -- Enmascarado: +51 9•• ••• 222  (lo único que ve un tercero)
    phone_masked       VARCHAR(24)  GENERATED ALWAYS AS (
                         left(phone_e164, 3) || ' ' || substr(phone_e164, 4, 1)
                         || '•• ••• ' || right(phone_e164, 3)
                       ) STORED,
    phone_verified_at  TIMESTAMPTZ,                      -- se llena tras validar OTP
    auth_provider      VARCHAR(20)  NOT NULL DEFAULT 'FIREBASE',  -- FIREBASE | SUPABASE | DEMO
    auth_uid           VARCHAR(128) UNIQUE,              -- uid de Firebase/Supabase
    email              VARCHAR(160),
    avatar_url         TEXT,
    trust_score        SMALLINT     NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
    is_banned          BOOLEAN      NOT NULL DEFAULT FALSE,   -- trolls / cuentas falsas
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Complejos deportivos (validación documental: RUC / licencia municipal)
-- -----------------------------------------------------------------------------
CREATE TABLE complexes (
    id                   UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id             UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name                 VARCHAR(120)        NOT NULL,
    ruc                  CHAR(11)            NOT NULL UNIQUE
                         CHECK (ruc ~ '^(10|15|17|20)[0-9]{9}$'),
    business_name        VARCHAR(160),                    -- razón social SUNAT
    license_doc_url      TEXT,                            -- PDF/imagen de RUC o licencia
    license_doc_uploaded_at TIMESTAMPTZ,
    verification_status  verification_status NOT NULL DEFAULT 'PENDING',
    verification_notes   TEXT,
    verified_at          TIMESTAMPTZ,
    district_code        VARCHAR(32)         NOT NULL REFERENCES districts(code),
    address              VARCHAR(200)        NOT NULL,
    lat                  NUMERIC(9,6)        NOT NULL CHECK (lat BETWEEN -17.0 AND -16.0),
    lng                  NUMERIC(9,6)        NOT NULL CHECK (lng BETWEEN -72.0 AND -71.0),
    google_place_id      VARCHAR(128),
    photos               TEXT[]              NOT NULL DEFAULT '{}',
    amenities            TEXT[]              NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX idx_complexes_district ON complexes (district_code);
CREATE INDEX idx_complexes_owner    ON complexes (owner_id);

-- -----------------------------------------------------------------------------
-- Canchas
-- -----------------------------------------------------------------------------
CREATE TABLE courts (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    complex_id         UUID        NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,
    name               VARCHAR(60) NOT NULL,
    surface            VARCHAR(30) NOT NULL DEFAULT 'SINTETICO',
    players_per_side   SMALLINT    NOT NULL DEFAULT 6 CHECK (players_per_side BETWEEN 5 AND 11),
    price_cents        INTEGER     NOT NULL CHECK (price_cents > 0),        -- tarifa diurna / hora
    price_peak_cents   INTEGER     NOT NULL CHECK (price_peak_cents > 0),   -- 18:00 en adelante
    open_hour          SMALLINT    NOT NULL DEFAULT 7  CHECK (open_hour BETWEEN 0 AND 23),
    close_hour         SMALLINT    NOT NULL DEFAULT 23 CHECK (close_hour BETWEEN 1 AND 24),
    is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
    UNIQUE (complex_id, name),
    CHECK (close_hour > open_hour)
);

-- -----------------------------------------------------------------------------
-- Reservas y bloqueos (app, recepción, teléfono)
-- -----------------------------------------------------------------------------
CREATE TABLE bookings (
    id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id         UUID            NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    organizer_id     UUID            REFERENCES users(id),     -- NULL en ventas presenciales
    created_by       UUID            REFERENCES users(id),     -- dueño/recepcionista u organizador
    channel          booking_channel NOT NULL,
    status           booking_status  NOT NULL,
    payment_mode     payment_mode,
    starts_at        TIMESTAMPTZ     NOT NULL,
    ends_at          TIMESTAMPTZ     NOT NULL,
    total_cents      INTEGER         NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    deposit_cents    INTEGER         NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
    customer_name    VARCHAR(120),                             -- cliente walk-in
    notes            VARCHAR(280),
    hold_expires_at  TIMESTAMPTZ,                              -- turnos HELD (split pendiente)
    version          INTEGER         NOT NULL DEFAULT 1,       -- bloqueo optimista
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),

    -- >>> Garantía anti doble-booking <<<
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        court_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status IN ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'BLOCKED'))
);
CREATE INDEX idx_bookings_court_time ON bookings (court_id, starts_at);
CREATE INDEX idx_bookings_organizer  ON bookings (organizer_id);
CREATE INDEX idx_bookings_hold       ON bookings (hold_expires_at) WHERE status = 'HELD';

-- Bitácora inmutable de eventos (alimenta el feed "en vivo" del panel del dueño)
CREATE TABLE booking_events (
    id          BIGSERIAL       PRIMARY KEY,
    booking_id  UUID            NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    complex_id  UUID            NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,
    event_type  VARCHAR(40)     NOT NULL,   -- CREATED | BLOCKED | RELEASED | PAYMENT | CONFIRMED | EXPIRED
    channel     booking_channel NOT NULL,
    actor_id    UUID            REFERENCES users(id),
    payload     JSONB           NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_events_complex ON booking_events (complex_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Pago híbrido: seña completa o Split Payment (cobro fraccionado por WhatsApp)
-- -----------------------------------------------------------------------------
CREATE TABLE split_payments (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id             UUID         NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    organizer_id           UUID         NOT NULL REFERENCES users(id),
    mode                   payment_mode NOT NULL,
    total_slots            SMALLINT     NOT NULL CHECK (total_slots BETWEEN 1 AND 22),
    paid_slots             SMALLINT     NOT NULL DEFAULT 0,
    amount_per_slot_cents  INTEGER      NOT NULL CHECK (amount_per_slot_cents > 0),
    total_cents            INTEGER      NOT NULL CHECK (total_cents > 0),
    share_token            VARCHAR(32)  NOT NULL UNIQUE,      -- link público /pay/{token}
    status                 split_status NOT NULL DEFAULT 'OPEN',
    expires_at             TIMESTAMPTZ  NOT NULL,
    completed_at           TIMESTAMPTZ,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (paid_slots BETWEEN 0 AND total_slots)              -- "Cupos pagados: 4 de 6"
);

-- Cada cupo pagado (idempotencia por id de cargo de la pasarela)
CREATE TABLE payment_shares (
    id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    split_payment_id    UUID             NOT NULL REFERENCES split_payments(id) ON DELETE CASCADE,
    payer_user_id       UUID             REFERENCES users(id),
    payer_name          VARCHAR(120)     NOT NULL,
    method              payment_method   NOT NULL,
    provider            payment_provider NOT NULL DEFAULT 'CULQI',
    provider_charge_id  VARCHAR(80)      NOT NULL UNIQUE,     -- evita doble abono si el webhook se repite
    amount_cents        INTEGER          NOT NULL CHECK (amount_cents > 0),
    status              share_status     NOT NULL DEFAULT 'PAID',
    paid_at             TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_shares_split ON payment_shares (split_payment_id);

-- -----------------------------------------------------------------------------
-- Bolsa de suplentes verificados (core del pivote)
-- -----------------------------------------------------------------------------
CREATE TABLE substitute_profiles (
    id                 UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID            NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    position           player_position NOT NULL,
    skill_level        SMALLINT        NOT NULL DEFAULT 3 CHECK (skill_level BETWEEN 1 AND 5),
    punctuality_score  NUMERIC(5,2)    NOT NULL DEFAULT 100 CHECK (punctuality_score BETWEEN 0 AND 100),
    matches_played     INTEGER         NOT NULL DEFAULT 0,
    no_shows           INTEGER         NOT NULL DEFAULT 0,
    district_code      VARCHAR(32)     REFERENCES districts(code),
    bio                VARCHAR(200),
    clip_provider      media_provider  NOT NULL DEFAULT 'CLOUDINARY',
    clip_public_id     VARCHAR(200),                -- public_id Cloudinary / key S3
    clip_url           TEXT,                        -- URL de streaming optimizada (q_auto, w_480)
    clip_poster_url    TEXT,
    clip_duration_s    SMALLINT CHECK (clip_duration_s BETWEEN 15 AND 30),
    is_verified        BOOLEAN         NOT NULL DEFAULT FALSE,
    is_available       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_substitutes_lookup ON substitute_profiles (position, is_available, punctuality_score DESC);

CREATE TABLE substitute_invitations (
    id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    substitute_id  UUID              NOT NULL REFERENCES substitute_profiles(id) ON DELETE CASCADE,
    organizer_id   UUID              NOT NULL REFERENCES users(id),
    booking_id     UUID              REFERENCES bookings(id) ON DELETE SET NULL,
    status         invitation_status NOT NULL DEFAULT 'SENT',
    created_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
    UNIQUE (substitute_id, booking_id)
);

-- -----------------------------------------------------------------------------
-- Reseñas de la comunidad
-- -----------------------------------------------------------------------------
CREATE TABLE reviews (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    complex_id  UUID        NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id),
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     VARCHAR(400),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (complex_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Contacto protegido (chat interno / VoIP con número proxy)
-- -----------------------------------------------------------------------------
CREATE TABLE contact_relays (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id      UUID        NOT NULL REFERENCES users(id),
    user_b_id      UUID        NOT NULL REFERENCES users(id),
    booking_id     UUID        REFERENCES bookings(id) ON DELETE SET NULL,
    proxy_number   VARCHAR(20) NOT NULL,          -- número virtual VoIP temporal
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (user_a_id <> user_b_id)
);

CREATE TABLE relay_messages (
    id          BIGSERIAL    PRIMARY KEY,
    relay_id    UUID         NOT NULL REFERENCES contact_relays(id) ON DELETE CASCADE,
    sender_id   UUID         NOT NULL REFERENCES users(id),
    body        VARCHAR(500) NOT NULL,             -- ya sanitizado (teléfonos redactados)
    was_redacted BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_relay_messages ON relay_messages (relay_id, created_at);

-- -----------------------------------------------------------------------------
-- Vistas de apoyo
-- -----------------------------------------------------------------------------
CREATE VIEW v_complex_ratings AS
SELECT c.id AS complex_id,
       COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating_avg,
       COUNT(r.id)                                    AS reviews_count
FROM complexes c
LEFT JOIN reviews r ON r.complex_id = c.id
GROUP BY c.id;

-- Hora local de Lima (UTC-5, sin horario de verano) independiente de la TZ de sesión
CREATE FUNCTION pb_lima_slot(day_offset INTEGER, slot_hour INTEGER)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
    SELECT ((((now() AT TIME ZONE 'UTC') - INTERVAL '5 hours')::date + day_offset)
            + make_time(slot_hour, 0, 0)) AT TIME ZONE 'UTC' + INTERVAL '5 hours'
$$;
