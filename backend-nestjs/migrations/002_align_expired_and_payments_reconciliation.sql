-- =============================================================================
--  Migración 002: Alinear enum booking_status ('EXPIRED'), coordinación de cupos
--  en split_payments y trazabilidad/conciliación de intentos de cobro y reembolsos
-- =============================================================================

-- 1. Alinear enum booking_status para que BookingsService.expireStaleHolds() sea válido
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 2. Añadir columna reserved_slots a split_payments para evitar sobrecupos en pagos concurrentes
ALTER TABLE split_payments
  ADD COLUMN IF NOT EXISTS reserved_slots SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'split_payments_reserved_slots_bounds_chk'
  ) THEN
    ALTER TABLE split_payments
      ADD CONSTRAINT split_payments_reserved_slots_bounds_chk
      CHECK (reserved_slots >= 0 AND paid_slots + reserved_slots <= total_slots);
  END IF;
END $$;

-- 3. Crear tabla payment_attempts para trazabilidad, idempotencia y compensación de cargos
CREATE TABLE IF NOT EXISTS payment_attempts (
    id                  UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key     VARCHAR(120)     NOT NULL UNIQUE,
    booking_id          UUID             REFERENCES bookings(id) ON DELETE SET NULL,
    split_payment_id    UUID             REFERENCES split_payments(id) ON DELETE SET NULL,
    user_id             UUID             REFERENCES users(id) ON DELETE SET NULL,
    payer_name          VARCHAR(120)     NOT NULL,
    purpose             VARCHAR(32)      NOT NULL,
    method              payment_method   NOT NULL,
    provider            payment_provider NOT NULL DEFAULT 'CULQI',
    source_id           VARCHAR(120)     NOT NULL,
    amount_cents        INTEGER          NOT NULL CHECK (amount_cents > 0),
    currency            CHAR(3)          NOT NULL DEFAULT 'PEN',
    provider_charge_id  VARCHAR(80)      UNIQUE,
    status              VARCHAR(32)      NOT NULL DEFAULT 'INITIATED'
                        CHECK (status IN (
                          'INITIATED',
                          'PENDING',
                          'SUCCEEDED',
                          'FAILED',
                          'COMPENSATING',
                          'REFUNDED',
                          'COMPENSATION_FAILED'
                        )),
    simulated           BOOLEAN          NOT NULL DEFAULT FALSE,
    refund_id           VARCHAR(80),
    refund_reason       TEXT,
    refunded_at         TIMESTAMPTZ,
    error_code          VARCHAR(64),
    error_message       TEXT,
    metadata            JSONB            NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_booking ON payment_attempts (booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_split   ON payment_attempts (split_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_charge  ON payment_attempts (provider_charge_id);

-- 4. Añadir columnas de conciliación y reembolso a payment_shares
ALTER TABLE payment_shares
  ADD COLUMN IF NOT EXISTS attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
