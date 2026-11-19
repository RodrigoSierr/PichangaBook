-- =============================================================================
--  Migración 004: Respaldo en PostgreSQL de documentos de verificación RUC/licencia
--  Garantiza que los PDFs/imágenes subidos por los dueños nunca devuelvan 404
--  tras un reinicio o redespliegue en contenedores con disco efímero (Render Free).
-- =============================================================================

ALTER TABLE complexes
  ADD COLUMN IF NOT EXISTS license_doc_mime VARCHAR(80),
  ADD COLUMN IF NOT EXISTS license_doc_base64 TEXT;
