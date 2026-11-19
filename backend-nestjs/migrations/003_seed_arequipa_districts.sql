-- =============================================================================
--  Migración 003: Garantizar catálogo maestro de 10 distritos de Arequipa en producción
-- =============================================================================

INSERT INTO districts (code, name, lat, lng, is_key_zone) VALUES
  ('CAYMA',             'Cayma',                        -16.3640, -71.5470, TRUE),
  ('CERRO_COLORADO',    'Cerro Colorado',               -16.3660, -71.5790, TRUE),
  ('YANAHUARA',         'Yanahuara',                    -16.3880, -71.5430, TRUE),
  ('JLBYR',             'José Luis Bustamante y Rivero',-16.4250, -71.5220, TRUE),
  ('SACHACA',           'Sachaca',                      -16.4220, -71.5650, TRUE),
  ('AREQUIPA',          'Arequipa (Cercado)',           -16.3989, -71.5350, TRUE),
  ('MIRAFLORES',        'Miraflores',                   -16.3920, -71.5180, TRUE),
  ('ALTO_SELVA_ALEGRE', 'Alto Selva Alegre',            -16.3770, -71.5200, TRUE),
  ('PAUCARPATA',        'Paucarpata',                   -16.4280, -71.5050, TRUE),
  ('HUNTER',            'Jacobo Hunter',                -16.4410, -71.5580, TRUE)
ON CONFLICT (code) DO NOTHING;
