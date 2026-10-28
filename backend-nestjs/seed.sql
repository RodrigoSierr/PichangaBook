-- =============================================================================
--  PichangaBook Arequipa · Datos semilla para la demo del MVP
--  (IDs fijos para que el panel web y la app espejo apunten al mismo complejo)
--  Las reservas se generan relativas a "hoy" en hora de Lima con pb_lima_slot().
-- =============================================================================

-- Distritos de Arequipa (centroides aproximados)
INSERT INTO districts (code, name, lat, lng, is_key_zone) VALUES
  ('CAYMA',             'Cayma',                       -16.3640, -71.5470, TRUE),
  ('CERRO_COLORADO',    'Cerro Colorado',              -16.3660, -71.5790, TRUE),
  ('YANAHUARA',         'Yanahuara',                   -16.3880, -71.5430, TRUE),
  ('JLBYR',             'José Luis Bustamante y Rivero',-16.4250, -71.5220, TRUE),
  ('SACHACA',           'Sachaca',                     -16.4220, -71.5650, TRUE),
  ('AREQUIPA',          'Arequipa (Cercado)',          -16.3989, -71.5350, FALSE),
  ('MIRAFLORES',        'Miraflores',                  -16.3920, -71.5180, FALSE),
  ('ALTO_SELVA_ALEGRE', 'Alto Selva Alegre',           -16.3770, -71.5200, FALSE),
  ('PAUCARPATA',        'Paucarpata',                  -16.4280, -71.5050, FALSE),
  ('SOCABAYA',          'Socabaya',                    -16.4560, -71.5280, FALSE);

-- Usuarios (teléfonos ficticios). Rol diferenciado: OWNER (dueño) / ORGANIZER / PLAYER
INSERT INTO users (id, full_name, role, phone_e164, phone_verified_at, auth_provider, trust_score) VALUES
  ('00000000-0000-4000-a000-000000000001', 'Admin PichangaBook', 'ADMIN',     '+51900000001', now(), 'DEMO', 100),
  ('00000000-0000-4000-a000-000000000011', 'Carlos Huamán',      'OWNER',     '+51959111222', now(), 'DEMO', 90),
  ('00000000-0000-4000-a000-000000000012', 'Lucía Paredes',      'OWNER',     '+51959111333', now(), 'DEMO', 88),
  ('00000000-0000-4000-a000-000000000013', 'Jorge Quispe',       'OWNER',     '+51959111444', now(), 'DEMO', 85),
  ('00000000-0000-4000-a000-000000000021', 'Diego Salas',        'ORGANIZER', '+51958222333', now(), 'DEMO', 92),
  ('00000000-0000-4000-a000-000000000022', 'Andrea Cornejo',     'ORGANIZER', '+51958222444', now(), 'DEMO', 95),
  ('00000000-0000-4000-a000-000000000031', 'Renzo Valdivia',     'PLAYER',    '+51957333101', now(), 'DEMO', 97),
  ('00000000-0000-4000-a000-000000000032', 'Kevin Zegarra',      'PLAYER',    '+51957333102', now(), 'DEMO', 91),
  ('00000000-0000-4000-a000-000000000033', 'Bruno Chávez',       'PLAYER',    '+51957333103', now(), 'DEMO', 89),
  ('00000000-0000-4000-a000-000000000034', 'Piero Medina',       'PLAYER',    '+51957333104', now(), 'DEMO', 94),
  ('00000000-0000-4000-a000-000000000035', 'Fabián Ccama',       'PLAYER',    '+51957333105', now(), 'DEMO', 80),
  ('00000000-0000-4000-a000-000000000036', 'Luis Apaza',         'PLAYER',    '+51957333106', now(), 'DEMO', 86);

-- Complejos deportivos (RUC con dígito verificador válido - módulo 11 SUNAT)
INSERT INTO complexes (id, owner_id, name, ruc, business_name, license_doc_url, license_doc_uploaded_at,
                       verification_status, verified_at, district_code, address, lat, lng, photos, amenities) VALUES
  ('00000000-0000-4000-b000-00000000c001', '00000000-0000-4000-a000-000000000011',
   'Complejo Deportivo El Misti', '20601458722', 'INVERSIONES DEPORTIVAS EL MISTI S.A.C.',
   '/uploads/demo/ruc-el-misti.pdf', now() - INTERVAL '20 days', 'VERIFIED', now() - INTERVAL '18 days',
   'CAYMA', 'Av. Ejército 1020, Cayma', -16.361500, -71.546800,
   ARRAY['/media/court-1.jpg','/media/court-2.jpg','/media/court-4.jpg'],
   ARRAY['Estacionamiento','Vestuarios','Duchas','Iluminación LED','Cafetería']),
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000012',
   'La Canchita de Yanahuara', '20455987122', 'CANCHITA YANAHUARA E.I.R.L.',
   '/uploads/demo/ruc-yanahuara.pdf', now() - INTERVAL '40 days', 'VERIFIED', now() - INTERVAL '38 days',
   'YANAHUARA', 'Calle Jerusalén 304, Yanahuara', -16.387200, -71.542200,
   ARRAY['/media/court-2.jpg','/media/court-3.jpg'],
   ARRAY['Vestuarios','Iluminación LED','Mirador']),
  ('00000000-0000-4000-b000-00000000c003', '00000000-0000-4000-a000-000000000013',
   'Sintéticos Cerro Colorado', '20608771230', 'SINTETICOS DEL SUR S.R.L.',
   '/uploads/demo/licencia-cerro.pdf', now() - INTERVAL '10 days', 'VERIFIED', now() - INTERVAL '8 days',
   'CERRO_COLORADO', 'Av. Aviación 1450, Cerro Colorado', -16.359000, -71.576500,
   ARRAY['/media/court-4.jpg','/media/court-1.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Tribuna']),
  ('00000000-0000-4000-b000-00000000c004', '00000000-0000-4000-a000-000000000013',
   'Arena Bustamante', '20712345676', 'ARENA BUSTAMANTE S.A.C.',
   '/uploads/demo/ruc-arena.pdf', now() - INTERVAL '60 days', 'VERIFIED', now() - INTERVAL '58 days',
   'JLBYR', 'Av. Dolores 215, J.L. Bustamante y Rivero', -16.423500, -71.520500,
   ARRAY['/media/court-3.jpg','/media/court-2.jpg'],
   ARRAY['Techada','Vestuarios','Cafetería']),
  ('00000000-0000-4000-b000-00000000c005', '00000000-0000-4000-a000-000000000012',
   'Fútbol Park Cayma Norte', '20499887761', 'FUTBOL PARK AQP S.A.C.',
   '/uploads/demo/ruc-park.pdf', now() - INTERVAL '30 days', 'VERIFIED', now() - INTERVAL '29 days',
   'CAYMA', 'Av. Cayma 650, Cayma', -16.354800, -71.543600,
   ARRAY['/media/court-1.jpg','/media/court-3.jpg'],
   ARRAY['Estacionamiento','Iluminación LED']),
  -- Segunda sede del dueño demo: aún SIN documento → muestra el flujo de validación documental
  ('00000000-0000-4000-b000-00000000c006', '00000000-0000-4000-a000-000000000011',
   'El Misti · Sede Sachaca', '20555012340', 'INVERSIONES DEPORTIVAS EL MISTI S.A.C.',
   NULL, NULL, 'PENDING', NULL,
   'SACHACA', 'Av. Fernandini 410, Sachaca', -16.421000, -71.566500,
   ARRAY['/media/court-2.jpg'], ARRAY['Iluminación LED']);

-- Canchas
INSERT INTO courts (id, complex_id, name, players_per_side, price_cents, price_peak_cents, open_hour, close_hour) VALUES
  ('00000000-0000-4000-c000-00000000d011', '00000000-0000-4000-b000-00000000c001', 'Cancha 1 · Fútbol 6', 6, 6000,  9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d012', '00000000-0000-4000-b000-00000000c001', 'Cancha 2 · Fútbol 6', 6, 6000,  9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d013', '00000000-0000-4000-b000-00000000c001', 'Cancha 3 · Fútbol 8', 8, 9000, 13000, 7, 23),
  ('00000000-0000-4000-c000-00000000d021', '00000000-0000-4000-b000-00000000c002', 'Cancha A · Fútbol 5', 5, 5000,  7000, 8, 23),
  ('00000000-0000-4000-c000-00000000d022', '00000000-0000-4000-b000-00000000c002', 'Cancha B · Fútbol 7', 7, 7000, 10000, 8, 23),
  ('00000000-0000-4000-c000-00000000d031', '00000000-0000-4000-b000-00000000c003', 'Losa 1 · Fútbol 6',   6, 5000,  8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d032', '00000000-0000-4000-b000-00000000c003', 'Losa 2 · Fútbol 6',   6, 5000,  8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d041', '00000000-0000-4000-b000-00000000c004', 'Arena Techada · F6',  6, 7000, 10000, 8, 24),
  ('00000000-0000-4000-c000-00000000d042', '00000000-0000-4000-b000-00000000c004', 'Arena Aire Libre · F8', 8, 9000, 12000, 8, 24),
  ('00000000-0000-4000-c000-00000000d051', '00000000-0000-4000-b000-00000000c005', 'Cancha Norte · F6',   6, 5500,  8500, 7, 23),
  ('00000000-0000-4000-c000-00000000d052', '00000000-0000-4000-b000-00000000c005', 'Cancha Sur · F6',     6, 5500,  8500, 7, 23),
  ('00000000-0000-4000-c000-00000000d061', '00000000-0000-4000-b000-00000000c006', 'Cancha Única · F6',   6, 5000,  8000, 7, 23);

-- Reservas de hoy y mañana (Complejo El Misti = complejo de la demo)
INSERT INTO bookings (id, court_id, organizer_id, created_by, channel, status, payment_mode,
                      starts_at, ends_at, total_cents, deposit_cents, customer_name, notes, hold_expires_at) VALUES
  ('00000000-0000-4000-e000-0000000000b1', '00000000-0000-4000-c000-00000000d011', '00000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000022',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(0,19), pb_lima_slot(0,20), 9000, 4500, NULL, 'Pichanga ex-alumnos UCSP', NULL),
  -- Split payment en curso: "Cupos pagados: 4 de 6"
  ('00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-c000-00000000d011', '00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000021',
   'APP', 'HELD', 'SPLIT', pb_lima_slot(0,20), pb_lima_slot(0,21), 9000, 9000, NULL, 'Revancha del jueves', now() + INTERVAL '12 hours'),
  ('00000000-0000-4000-e000-0000000000b3', '00000000-0000-4000-c000-00000000d011', NULL, '00000000-0000-4000-a000-000000000011',
   'RECEPTION', 'BLOCKED', NULL, pb_lima_slot(0,21), pb_lima_slot(0,22), 9000, 9000, 'Sr. Málaga (pago en efectivo)', 'Venta en recepción', NULL),
  ('00000000-0000-4000-e000-0000000000b4', '00000000-0000-4000-c000-00000000d012', '00000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000022',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(0,18), pb_lima_slot(0,19), 9000, 4500, NULL, NULL, NULL),
  ('00000000-0000-4000-e000-0000000000b5', '00000000-0000-4000-c000-00000000d012', NULL, '00000000-0000-4000-a000-000000000011',
   'PHONE', 'BLOCKED', NULL, pb_lima_slot(0,19), pb_lima_slot(0,20), 9000, 0, 'Liga Interbancaria', 'Reserva telefónica', NULL),
  ('00000000-0000-4000-e000-0000000000b6', '00000000-0000-4000-c000-00000000d013', '00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000021',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(0,20), pb_lima_slot(0,21), 13000, 6500, NULL, NULL, NULL),
  ('00000000-0000-4000-e000-0000000000b7', '00000000-0000-4000-c000-00000000d013', NULL, '00000000-0000-4000-a000-000000000011',
   'RECEPTION', 'BLOCKED', NULL, pb_lima_slot(0,22), pb_lima_slot(0,23), 13000, 13000, 'Empresa Sodimac (convenio)', NULL, NULL),
  ('00000000-0000-4000-e000-0000000000b8', '00000000-0000-4000-c000-00000000d011', '00000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000022',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(1,20), pb_lima_slot(1,21), 9000, 4500, NULL, NULL, NULL),
  -- Otros complejos
  ('00000000-0000-4000-e000-0000000000c1', '00000000-0000-4000-c000-00000000d021', '00000000-0000-4000-a000-000000000021', '00000000-0000-4000-a000-000000000021',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(0,19), pb_lima_slot(0,20), 7000, 3500, NULL, NULL, NULL),
  ('00000000-0000-4000-e000-0000000000c2', '00000000-0000-4000-c000-00000000d041', NULL, '00000000-0000-4000-a000-000000000013',
   'RECEPTION', 'BLOCKED', NULL, pb_lima_slot(0,20), pb_lima_slot(0,21), 10000, 10000, 'Walk-in', NULL, NULL),
  ('00000000-0000-4000-e000-0000000000c3', '00000000-0000-4000-c000-00000000d031', '00000000-0000-4000-a000-000000000022', '00000000-0000-4000-a000-000000000022',
   'APP', 'CONFIRMED', 'FULL_DEPOSIT', pb_lima_slot(0,21), pb_lima_slot(0,22), 8000, 4000, NULL, NULL, NULL);

-- Split payment 4 de 6 (S/ 90.00 / 6 = S/ 15.00 por cupo)
INSERT INTO split_payments (id, booking_id, organizer_id, mode, total_slots, paid_slots, amount_per_slot_cents,
                            total_cents, share_token, status, expires_at) VALUES
  ('00000000-0000-4000-f000-0000000000a1', '00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-a000-000000000021',
   'SPLIT', 6, 4, 1500, 9000, 'pk4de6demo', 'OPEN', now() + INTERVAL '12 hours');

INSERT INTO payment_shares (split_payment_id, payer_user_id, payer_name, method, provider, provider_charge_id, amount_cents, paid_at) VALUES
  ('00000000-0000-4000-f000-0000000000a1', '00000000-0000-4000-a000-000000000021', 'Diego Salas (organizador)', 'YAPE', 'CULQI', 'chr_demo_0001', 1500, now() - INTERVAL '50 minutes'),
  ('00000000-0000-4000-f000-0000000000a1', NULL, 'Mauricio T.',    'PLIN', 'CULQI', 'chr_demo_0002', 1500, now() - INTERVAL '41 minutes'),
  ('00000000-0000-4000-f000-0000000000a1', NULL, 'José Luis R.',   'CARD', 'CULQI', 'chr_demo_0003', 1500, now() - INTERVAL '27 minutes'),
  ('00000000-0000-4000-f000-0000000000a1', NULL, 'Ernesto V.',     'YAPE', 'CULQI', 'chr_demo_0004', 1500, now() - INTERVAL '9 minutes');

-- Bolsa de suplentes verificados (clips de 15-30 s; en producción viven en Cloudinary/S3)
INSERT INTO substitute_profiles (id, user_id, position, skill_level, punctuality_score, matches_played, no_shows,
                                 district_code, bio, clip_provider, clip_public_id, clip_url, clip_poster_url,
                                 clip_duration_s, is_verified, is_available) VALUES
  ('00000000-0000-4000-9000-000000000501', '00000000-0000-4000-a000-000000000031', 'ARQUERO',    5, 98.50, 64, 1,
   'CAYMA', 'Arquero de reflejos rápidos. Ex Sub-20 FBC Melgar.', 'LOCAL_DEMO', 'pichangabook/clips/arquero',
   '/media/clips/arquero.mp4', '/media/player-arquero.jpg', 22, TRUE, TRUE),
  ('00000000-0000-4000-9000-000000000502', '00000000-0000-4000-a000-000000000032', 'DELANTERO',  4, 95.00, 41, 2,
   'YANAHUARA', 'Nueve de área, buen juego aéreo.', 'LOCAL_DEMO', 'pichangabook/clips/delantero',
   '/media/clips/delantero.mp4', '/media/player-delantero.jpg', 18, TRUE, TRUE),
  ('00000000-0000-4000-9000-000000000503', '00000000-0000-4000-a000-000000000033', 'DEFENSA',    4, 92.30, 52, 4,
   'CERRO_COLORADO', 'Central zurdo, marca fuerte y salida limpia.', 'LOCAL_DEMO', 'pichangabook/clips/defensa',
   '/media/clips/defensa.mp4', '/media/player-defensa.jpg', 25, TRUE, TRUE),
  ('00000000-0000-4000-9000-000000000504', '00000000-0000-4000-a000-000000000034', 'MEDIOCAMPO', 5, 99.10, 77, 0,
   'JLBYR', 'Volante creativo, pase filtrado.', 'LOCAL_DEMO', 'pichangabook/clips/mediocampo',
   '/media/clips/mediocampo.mp4', '/media/player-mediocampo.jpg', 28, TRUE, TRUE),
  ('00000000-0000-4000-9000-000000000505', '00000000-0000-4000-a000-000000000035', 'DELANTERO',  3, 81.40, 23, 5,
   'SACHACA', 'Extremo veloz.', 'LOCAL_DEMO', 'pichangabook/clips/delantero',
   '/media/clips/delantero.mp4', '/media/player-delantero.jpg', 18, FALSE, TRUE),
  ('00000000-0000-4000-9000-000000000506', '00000000-0000-4000-a000-000000000036', 'MEDIOCAMPO', 4, 90.00, 35, 3,
   'CAYMA', 'Contención y recuperación.', 'LOCAL_DEMO', 'pichangabook/clips/mediocampo',
   '/media/clips/mediocampo.mp4', '/media/player-mediocampo.jpg', 28, TRUE, TRUE);

-- Reseñas de la comunidad
INSERT INTO reviews (complex_id, user_id, rating, comment, created_at) VALUES
  ('00000000-0000-4000-b000-00000000c001', '00000000-0000-4000-a000-000000000021', 5, 'Grass sintético nuevo y buena iluminación. Reservar por la app fue al toque.', now() - INTERVAL '3 days'),
  ('00000000-0000-4000-b000-00000000c001', '00000000-0000-4000-a000-000000000022', 5, 'Respetaron la hora exacta, cero cruces con otra reserva.', now() - INTERVAL '6 days'),
  ('00000000-0000-4000-b000-00000000c001', '00000000-0000-4000-a000-000000000031', 4, 'Buenos vestuarios. El estacionamiento se llena los viernes.', now() - INTERVAL '9 days'),
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000021', 4, 'Cancha chica pero con vista al Misti.', now() - INTERVAL '2 days'),
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000034', 5, 'Ideal para fútbol 5.', now() - INTERVAL '12 days'),
  ('00000000-0000-4000-b000-00000000c003', '00000000-0000-4000-a000-000000000033', 4, 'Buen precio para la zona.', now() - INTERVAL '4 days'),
  ('00000000-0000-4000-b000-00000000c004', '00000000-0000-4000-a000-000000000022', 5, 'Techada: se juega aunque llueva en febrero.', now() - INTERVAL '5 days'),
  ('00000000-0000-4000-b000-00000000c005', '00000000-0000-4000-a000-000000000032', 3, 'Le falta mantenimiento a las redes.', now() - INTERVAL '7 days');

-- Bitácora inicial (feed de actividad del panel del dueño)
INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload, created_at) VALUES
  ('00000000-0000-4000-e000-0000000000b1', '00000000-0000-4000-b000-00000000c001', 'CONFIRMED', 'APP',       '00000000-0000-4000-a000-000000000022', '{"hour":19,"court":"Cancha 1 · Fútbol 6"}', now() - INTERVAL '2 hours'),
  ('00000000-0000-4000-e000-0000000000b5', '00000000-0000-4000-b000-00000000c001', 'BLOCKED',   'PHONE',     '00000000-0000-4000-a000-000000000011', '{"hour":19,"court":"Cancha 2 · Fútbol 6"}', now() - INTERVAL '95 minutes'),
  ('00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-b000-00000000c001', 'CREATED',   'APP',       '00000000-0000-4000-a000-000000000021', '{"hour":20,"court":"Cancha 1 · Fútbol 6","mode":"SPLIT"}', now() - INTERVAL '55 minutes'),
  ('00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-b000-00000000c001', 'PAYMENT',   'APP',       NULL, '{"hour":20,"paid":4,"total":6}', now() - INTERVAL '9 minutes'),
  ('00000000-0000-4000-e000-0000000000b3', '00000000-0000-4000-b000-00000000c001', 'BLOCKED',   'RECEPTION', '00000000-0000-4000-a000-000000000011', '{"hour":21,"court":"Cancha 1 · Fútbol 6"}', now() - INTERVAL '5 minutes');
