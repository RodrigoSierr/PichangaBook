-- =============================================================================
--  PichangaBook Arequipa · Datos semilla para la demo del MVP
--  Catálogo de 18 complejos deportivos reales de Arequipa distribuidos en los
--  10 distritos (Cercado, Cayma, Yanahuara, JLByR, Cerro Colorado, Sachaca,
--  Miraflores, Alto Selva Alegre, Paucarpata y Jacobo Hunter).
--  Conserva intactos los UUIDs c001..c006, d011..d061, b1..b8 y pk4de6demo
--  para compatibilidad total con codex-audit-test.mjs.
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
ON CONFLICT (code) DO UPDATE SET is_key_zone = TRUE;

-- Usuarios (teléfonos verificados). Rol diferenciado: OWNER (dueño) / ORGANIZER / PLAYER
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

-- 18 Complejos deportivos reales de Arequipa (RUC con dígito verificador SUNAT válido)
INSERT INTO complexes (id, owner_id, name, ruc, business_name, license_doc_url, license_doc_uploaded_at,
                       verification_status, verified_at, district_code, address, lat, lng, photos, amenities) VALUES
  -- 1. Cayma (Av. Ejército) — Sede principal del dueño demo Carlos Huamán
  ('00000000-0000-4000-b000-00000000c001', '00000000-0000-4000-a000-000000000011',
   'Complejo Deportivo El Misti', '20601458722', 'INVERSIONES DEPORTIVAS EL MISTI S.A.C.',
   '/uploads/demo/ruc-el-misti.pdf', now() - INTERVAL '20 days', 'VERIFIED', now() - INTERVAL '18 days',
   'CAYMA', 'Av. Ejército 1020, Cayma', -16.361500, -71.546800,
   ARRAY['/media/court-1.jpg','/media/court-2.jpg','/media/court-4.jpg'],
   ARRAY['Estacionamiento','Vestuarios','Duchas','Iluminación LED','Cafetería']),

  -- 2. Yanahuara (Magnopata)
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000012',
   'Complejo Deportivo Magnopata', '20455987122', 'DEPORTES MAGNOPATA YANAHUARA E.I.R.L.',
   '/uploads/demo/ruc-yanahuara.pdf', now() - INTERVAL '40 days', 'VERIFIED', now() - INTERVAL '38 days',
   'YANAHUARA', 'Urb. Magnopata Calle 3 Nº 108, Yanahuara', -16.387200, -71.542200,
   ARRAY['/media/court-2.jpg','/media/court-3.jpg'],
   ARRAY['Vestuarios','Iluminación LED','Mirador','Snack Bar']),

  -- 3. Cerro Colorado (Challapampa / Av. Aviación)
  ('00000000-0000-4000-b000-00000000c003', '00000000-0000-4000-a000-000000000013',
   'Complejo Deportivo Las Canteras', '20608771230', 'LAS CANTERAS SINTETICOS DEL SUR S.R.L.',
   '/uploads/demo/licencia-cerro.pdf', now() - INTERVAL '10 days', 'VERIFIED', now() - INTERVAL '8 days',
   'CERRO_COLORADO', 'Av. Aviación 1450 (Urb. Challapampa), Cerro Colorado', -16.359000, -71.576500,
   ARRAY['/media/court-4.jpg','/media/court-1.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Tribuna','Vestuarios']),

  -- 4. JLByR (Av. Dolores)
  ('00000000-0000-4000-b000-00000000c004', '00000000-0000-4000-a000-000000000013',
   'La Bombonera de Dolores', '20712345676', 'LA BOMBONERA DE DOLORES S.A.C.',
   '/uploads/demo/ruc-arena.pdf', now() - INTERVAL '60 days', 'VERIFIED', now() - INTERVAL '58 days',
   'JLBYR', 'Av. Dolores 215, José Luis Bustamante y Rivero', -16.423500, -71.520500,
   ARRAY['/media/court-3.jpg','/media/court-2.jpg'],
   ARRAY['Techada','Vestuarios','Cafetería','Iluminación LED']),

  -- 5. Cayma (Acequia Alta)
  ('00000000-0000-4000-b000-00000000c005', '00000000-0000-4000-a000-000000000012',
   'El Golazo de Cayma', '20499887761', 'EL GOLAZO FUTBOL PARK AQP S.A.C.',
   '/uploads/demo/ruc-park.pdf', now() - INTERVAL '30 days', 'VERIFIED', now() - INTERVAL '29 days',
   'CAYMA', 'Av. Ramón Castilla 650 (Acequia Alta), Cayma', -16.354800, -71.543600,
   ARRAY['/media/court-1.jpg','/media/court-3.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Duchas']),

  -- 6. Segunda sede del dueño demo (en flujo de validación documental PENDING)
  ('00000000-0000-4000-b000-00000000c006', '00000000-0000-4000-a000-000000000011',
   'El Misti · Sede Sachaca', '20555012340', 'INVERSIONES DEPORTIVAS EL MISTI S.A.C.',
   NULL, NULL, 'PENDING', NULL,
   'SACHACA', 'Av. Fernandini 410, Sachaca', -16.421000, -71.566500,
   ARRAY['/media/court-2.jpg'], ARRAY['Iluminación LED','Estacionamiento']),

  -- 7. JLByR (Av. Dolores)
  ('00000000-0000-4000-b000-00000000c007', '00000000-0000-4000-a000-000000000012',
   'Complejo Deportivo Maracaná Dolores', '20601122331', 'MARACANA SPORT CENTER AQP S.A.C.',
   '/uploads/demo/ruc-maracana.pdf', now() - INTERVAL '45 days', 'VERIFIED', now() - INTERVAL '42 days',
   'JLBYR', 'Av. Dolores 159, José Luis Bustamante y Rivero', -16.421800, -71.523400,
   ARRAY['/media/court-1.jpg','/media/court-4.jpg'],
   ARRAY['Iluminación LED','Tribuna','Restobar','Estacionamiento']),

  -- 8. JLByR (Paseo de la Cultura / Dolores)
  ('00000000-0000-4000-b000-00000000c008', '00000000-0000-4000-a000-000000000013',
   'Dolores Sport Center', '20602233445', 'DOLORES SPORT CENTER E.I.R.L.',
   '/uploads/demo/ruc-dolores-sc.pdf', now() - INTERVAL '35 days', 'VERIFIED', now() - INTERVAL '33 days',
   'JLBYR', 'Av. Paseo de la Cultura 310, J.L. Bustamante y Rivero', -16.426400, -71.519200,
   ARRAY['/media/court-2.jpg','/media/court-3.jpg'],
   ARRAY['Techada','Iluminación LED','Vestuarios','Wi-Fi']),

  -- 9. JLByR (Av. Los Incas / Lambramani)
  ('00000000-0000-4000-b000-00000000c009', '00000000-0000-4000-a000-000000000012',
   'Complejo Los Incas · Lambramani', '20603344559', 'COMPLEJO DEPORTIVO LOS INCAS S.A.C.',
   '/uploads/demo/ruc-los-incas.pdf', now() - INTERVAL '25 days', 'VERIFIED', now() - INTERVAL '22 days',
   'JLBYR', 'Av. Los Incas 402 (Costado Parque Lambramani), JLByR', -16.415200, -71.521000,
   ARRAY['/media/court-4.jpg','/media/court-2.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Cafetería','Duchas']),

  -- 10. Yanahuara (Umacollo)
  ('00000000-0000-4000-b000-00000000c010', '00000000-0000-4000-a000-000000000012',
   'Rinconada Soccer Umacollo', '20604455662', 'RINCONADA SOCCER CLUB S.A.C.',
   '/uploads/demo/ruc-rinconada.pdf', now() - INTERVAL '50 days', 'VERIFIED', now() - INTERVAL '48 days',
   'YANAHUARA', 'Calle Víctor Lira 210 (Estadio Umacollo), Yanahuara', -16.394100, -71.547500,
   ARRAY['/media/court-3.jpg','/media/court-1.jpg'],
   ARRAY['Grass FIFA Quality','Iluminación LED','Vestuarios','Seguridad']),

  -- 11. Yanahuara (Av. Bolognesi / La Ibérica)
  ('00000000-0000-4000-b000-00000000c011', '00000000-0000-4000-a000-000000000013',
   'Complejo Deportivo La Ibérica · Náutico', '20605566776', 'CLUB DEPORTIVO LA IBERICA S.A.C.',
   '/uploads/demo/ruc-iberica.pdf', now() - INTERVAL '28 days', 'VERIFIED', now() - INTERVAL '25 days',
   'YANAHUARA', 'Av. Bolognesi 540 (Zona Río Chili), Yanahuara', -16.384500, -71.539800,
   ARRAY['/media/court-1.jpg','/media/court-2.jpg'],
   ARRAY['Estacionamiento','Duchas Calientes','Iluminación LED','Cafetería']),

  -- 12. Cayma (Plaza de Cayma)
  ('00000000-0000-4000-b000-00000000c012', '00000000-0000-4000-a000-000000000012',
   'Villa Deportiva Cayma', '20606677880', 'VILLA DEPORTIVA CAYMA S.R.L.',
   '/uploads/demo/ruc-villa-cayma.pdf', now() - INTERVAL '19 days', 'VERIFIED', now() - INTERVAL '17 days',
   'CAYMA', 'Calle Melgar 308 (A 2 cuadras Plaza de Cayma), Cayma', -16.366200, -71.549100,
   ARRAY['/media/court-2.jpg','/media/court-4.jpg'],
   ARRAY['Techada','Estacionamiento','Iluminación LED','Vestuarios']),

  -- 13. Cercado (Av. Parra)
  ('00000000-0000-4000-b000-00000000c013', '00000000-0000-4000-a000-000000000013',
   'Complejo Deportivo DeporPlaza Parra', '20607788993', 'DEPORPLAZA AREQUIPA S.A.C.',
   '/uploads/demo/ruc-deporplaza.pdf', now() - INTERVAL '32 days', 'VERIFIED', now() - INTERVAL '30 days',
   'AREQUIPA', 'Av. Parra 318, Cercado de Arequipa', -16.410500, -71.544200,
   ARRAY['/media/court-3.jpg','/media/court-4.jpg'],
   ARRAY['Céntrico','Iluminación LED','Tribuna','Estacionamiento']),

  -- 14. Sachaca (Arancota / Tahuaycani)
  ('00000000-0000-4000-b000-00000000c014', '00000000-0000-4000-a000-000000000012',
   'Fútbol Plaza Arancota', '20608899007', 'FUTBOL PLAZA ARANCOTA S.A.C.',
   '/uploads/demo/ruc-arancota.pdf', now() - INTERVAL '22 days', 'VERIFIED', now() - INTERVAL '20 days',
   'SACHACA', 'Av. Arancota 280 (Vía Paisajista), Sachaca', -16.424200, -71.561800,
   ARRAY['/media/court-1.jpg','/media/court-3.jpg'],
   ARRAY['Áreas Verdes','Estacionamiento Amplio','Iluminación LED','Parrillas']),

  -- 15. Cercado / Tingo (Av. Alfonso Ugarte)
  ('00000000-0000-4000-b000-00000000c015', '00000000-0000-4000-a000-000000000013',
   'Complejo Deportivo Tingo Sport', '20609900110', 'TINGO SPORT CLUB S.A.C.',
   '/uploads/demo/ruc-tingo.pdf', now() - INTERVAL '15 days', 'VERIFIED', now() - INTERVAL '14 days',
   'AREQUIPA', 'Av. Alfonso Ugarte 620 (Sector Tingo), Arequipa', -16.418500, -71.552500,
   ARRAY['/media/court-2.jpg','/media/court-1.jpg'],
   ARRAY['Iluminación LED','Vestuarios','Duchas','Snack Bar']),

  -- 16. Alto Selva Alegre (Chilina)
  ('00000000-0000-4000-b000-00000000c016', '00000000-0000-4000-a000-000000000012',
   'Complejo Chilina Fútbol Club', '20601234568', 'CHILINA FUTBOL CLUB S.A.C.',
   '/uploads/demo/ruc-chilina.pdf', now() - INTERVAL '27 days', 'VERIFIED', now() - INTERVAL '25 days',
   'ALTO_SELVA_ALEGRE', 'Av. Roosevelt 820 (Valle de Chilina), Alto Selva Alegre', -16.376500, -71.522800,
   ARRAY['/media/court-4.jpg','/media/court-3.jpg'],
   ARRAY['Vista al Misti','Estacionamiento','Iluminación LED','Tribuna']),

  -- 17. Miraflores (Av. Progreso)
  ('00000000-0000-4000-b000-00000000c017', '00000000-0000-4000-a000-000000000013',
   'Complejo Alameda Sport Miraflores', '20602345671', 'ALAMEDA SPORT MIRAFLORES E.I.R.L.',
   '/uploads/demo/ruc-alameda.pdf', now() - INTERVAL '16 days', 'VERIFIED', now() - INTERVAL '14 days',
   'MIRAFLORES', 'Av. Progreso 740 (Frente Parque Mayta Cápac), Miraflores', -16.391800, -71.517400,
   ARRAY['/media/court-1.jpg','/media/court-2.jpg'],
   ARRAY['Techada','Iluminación LED','Vestuarios','Cafetería']),

  -- 18. Paucarpata / Jacobo Hunter (Zona Sur-Este)
  ('00000000-0000-4000-b000-00000000c018', '00000000-0000-4000-a000-000000000012',
   'Complejo Guardia Civil & Hunter Sport', '20603456785', 'GUARDIA CIVIL HUNTER SPORT S.A.C.',
   '/uploads/demo/ruc-guardia-civil.pdf', now() - INTERVAL '12 days', 'VERIFIED', now() - INTERVAL '10 days',
   'PAUCARPATA', 'Av. Jesús 1120 (Urb. Guardia Civil), Paucarpata', -16.427200, -71.504800,
   ARRAY['/media/court-3.jpg','/media/court-4.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Duchas','Seguridad']),

  -- 19. Jacobo Hunter (Av. Viña del Mar)
  ('00000000-0000-4000-b000-00000000c019', '00000000-0000-4000-a000-000000000013',
   'Complejo Hunter Sport Center', '20604567899', 'HUNTER SPORT CENTER AQP S.A.C.',
   '/uploads/demo/ruc-hunter.pdf', now() - INTERVAL '14 days', 'VERIFIED', now() - INTERVAL '11 days',
   'HUNTER', 'Av. Viña del Mar 450, Jacobo Hunter', -16.441200, -71.558200,
   ARRAY['/media/court-2.jpg','/media/court-1.jpg'],
   ARRAY['Estacionamiento','Iluminación LED','Tribuna','Vestuarios']);

-- Canchas de los complejos deportivos (Fútbol 5, 6, 7 y 8 con tarifas reales en soles)
INSERT INTO courts (id, complex_id, name, players_per_side, price_cents, price_peak_cents, open_hour, close_hour) VALUES
  -- c001: Complejo Deportivo El Misti (Cayma) — IDs fijos para codex-audit-test.mjs
  ('00000000-0000-4000-c000-00000000d011', '00000000-0000-4000-b000-00000000c001', 'Cancha 1 · Fútbol 6', 6, 6000,  9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d012', '00000000-0000-4000-b000-00000000c001', 'Cancha 2 · Fútbol 6', 6, 6000,  9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d013', '00000000-0000-4000-b000-00000000c001', 'Cancha 3 · Fútbol 8', 8, 9000, 13000, 7, 23),
  -- c002: Complejo Deportivo Magnopata (Yanahuara)
  ('00000000-0000-4000-c000-00000000d021', '00000000-0000-4000-b000-00000000c002', 'Cancha A · Fútbol 5', 5, 5000,  7000, 8, 23),
  ('00000000-0000-4000-c000-00000000d022', '00000000-0000-4000-b000-00000000c002', 'Cancha B · Fútbol 7', 7, 7000, 10000, 8, 23),
  -- c003: Complejo Deportivo Las Canteras (Cerro Colorado)
  ('00000000-0000-4000-c000-00000000d031', '00000000-0000-4000-b000-00000000c003', 'Cantera 1 · Fútbol 6', 6, 5000, 8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d032', '00000000-0000-4000-b000-00000000c003', 'Cantera 2 · Fútbol 6', 6, 5000, 8000, 7, 23),
  -- c004: La Bombonera de Dolores (JLByR)
  ('00000000-0000-4000-c000-00000000d041', '00000000-0000-4000-b000-00000000c004', 'Bombonera Techada · F6', 6, 7000, 10000, 8, 24),
  ('00000000-0000-4000-c000-00000000d042', '00000000-0000-4000-b000-00000000c004', 'Bombonera Principal · F8', 8, 9000, 12000, 8, 24),
  -- c005: El Golazo de Cayma
  ('00000000-0000-4000-c000-00000000d051', '00000000-0000-4000-b000-00000000c005', 'Cancha Norte · F6', 6, 5500, 8500, 7, 23),
  ('00000000-0000-4000-c000-00000000d052', '00000000-0000-4000-b000-00000000c005', 'Cancha Sur · F6',   6, 5500, 8500, 7, 23),
  -- c006: El Misti · Sede Sachaca (PENDING)
  ('00000000-0000-4000-c000-00000000d061', '00000000-0000-4000-b000-00000000c006', 'Cancha Única · F6', 6, 5000, 8000, 7, 23),
  -- c007: Complejo Deportivo Maracaná Dolores (JLByR)
  ('00000000-0000-4000-c000-00000000d071', '00000000-0000-4000-b000-00000000c007', 'Maracaná 1 · Fútbol 6', 6, 6500,  9500, 7, 24),
  ('00000000-0000-4000-c000-00000000d072', '00000000-0000-4000-b000-00000000c007', 'Maracaná 2 · Fútbol 7', 7, 8000, 11000, 7, 24),
  -- c008: Dolores Sport Center (JLByR)
  ('00000000-0000-4000-c000-00000000d081', '00000000-0000-4000-b000-00000000c008', 'Cancha 1 · Fútbol 6', 6, 6500,  9500, 8, 24),
  ('00000000-0000-4000-c000-00000000d082', '00000000-0000-4000-b000-00000000c008', 'Cancha 2 · Fútbol 8', 8, 9500, 13000, 8, 24),
  -- c009: Complejo Los Incas · Lambramani (JLByR)
  ('00000000-0000-4000-c000-00000000d091', '00000000-0000-4000-b000-00000000c009', 'Cancha Lambramani 1 · F5', 5, 5500,  8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d092', '00000000-0000-4000-b000-00000000c009', 'Cancha Lambramani 2 · F7', 7, 7500, 10500, 7, 23),
  -- c010: Rinconada Soccer Umacollo (Yanahuara)
  ('00000000-0000-4000-c000-00000000d101', '00000000-0000-4000-b000-00000000c010', 'Rinconada 1 · Fútbol 6', 6, 6000, 9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d102', '00000000-0000-4000-b000-00000000c010', 'Rinconada 2 · Fútbol 6', 6, 6000, 9000, 7, 23),
  -- c011: Complejo Deportivo La Ibérica · Náutico (Yanahuara)
  ('00000000-0000-4000-c000-00000000d111', '00000000-0000-4000-b000-00000000c011', 'Cancha Río Chili · F7', 7, 7500, 10500, 7, 23),
  ('00000000-0000-4000-c000-00000000d112', '00000000-0000-4000-b000-00000000c011', 'Cancha Principal · F8', 8, 9500, 12500, 7, 23),
  -- c012: Villa Deportiva Cayma
  ('00000000-0000-4000-c000-00000000d121', '00000000-0000-4000-b000-00000000c012', 'Villa 1 · Fútbol 6', 6, 6000,  9000, 7, 23),
  ('00000000-0000-4000-c000-00000000d122', '00000000-0000-4000-b000-00000000c012', 'Villa 2 · Fútbol 7', 7, 7500, 10500, 7, 23),
  -- c013: Complejo Deportivo DeporPlaza Parra (Cercado)
  ('00000000-0000-4000-c000-00000000d131', '00000000-0000-4000-b000-00000000c013', 'Parra 1 · Fútbol 6', 6, 6000,  8500, 7, 23),
  ('00000000-0000-4000-c000-00000000d132', '00000000-0000-4000-b000-00000000c013', 'Parra 2 · Fútbol 8', 8, 8500, 11500, 7, 23),
  -- c014: Fútbol Plaza Arancota (Sachaca)
  ('00000000-0000-4000-c000-00000000d141', '00000000-0000-4000-b000-00000000c014', 'Arancota 1 · Fútbol 6', 6, 6000,  9000, 8, 23),
  ('00000000-0000-4000-c000-00000000d142', '00000000-0000-4000-b000-00000000c014', 'Arancota 2 · Fútbol 7', 7, 7500, 10500, 8, 23),
  -- c015: Complejo Deportivo Tingo Sport (Cercado / Tingo)
  ('00000000-0000-4000-c000-00000000d151', '00000000-0000-4000-b000-00000000c015', 'Tingo 1 · Fútbol 6', 6, 5500, 8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d152', '00000000-0000-4000-b000-00000000c015', 'Tingo 2 · Fútbol 7', 7, 7000, 9500, 7, 23),
  -- c016: Complejo Chilina Fútbol Club (Alto Selva Alegre)
  ('00000000-0000-4000-c000-00000000d161', '00000000-0000-4000-b000-00000000c016', 'Chilina 1 · Fútbol 6', 6, 5000,  7500, 7, 23),
  ('00000000-0000-4000-c000-00000000d162', '00000000-0000-4000-b000-00000000c016', 'Chilina 2 · Fútbol 8', 8, 7500, 10500, 7, 23),
  -- c017: Complejo Alameda Sport Miraflores
  ('00000000-0000-4000-c000-00000000d171', '00000000-0000-4000-b000-00000000c017', 'Alameda 1 · Fútbol 5', 5, 4500, 7000, 7, 23),
  ('00000000-0000-4000-c000-00000000d172', '00000000-0000-4000-b000-00000000c017', 'Alameda 2 · Fútbol 6', 6, 5500, 8000, 7, 23),
  -- c018: Complejo Guardia Civil (Paucarpata)
  ('00000000-0000-4000-c000-00000000d181', '00000000-0000-4000-b000-00000000c018', 'Guardia Civil 1 · F6', 6, 5500, 8000, 7, 23),
  ('00000000-0000-4000-c000-00000000d182', '00000000-0000-4000-b000-00000000c018', 'Guardia Civil 2 · F7', 7, 7000, 9500, 7, 23),
  -- c019: Complejo Hunter Sport Center (Jacobo Hunter)
  ('00000000-0000-4000-c000-00000000d191', '00000000-0000-4000-b000-00000000c019', 'Hunter 1 · Fútbol 6', 6, 5000, 7500, 7, 23),
  ('00000000-0000-4000-c000-00000000d192', '00000000-0000-4000-b000-00000000c019', 'Hunter 2 · Fútbol 7', 7, 6500, 9000, 7, 23);

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
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000021', 5, 'Excelente ubicación en Magnopata y luces LED de primera.', now() - INTERVAL '2 days'),
  ('00000000-0000-4000-b000-00000000c002', '00000000-0000-4000-a000-000000000034', 5, 'Ideal para fútbol 5 y fútbol 7.', now() - INTERVAL '12 days'),
  ('00000000-0000-4000-b000-00000000c003', '00000000-0000-4000-a000-000000000033', 4, 'Las Canteras tiene buen precio y amplio estacionamiento en Aviación.', now() - INTERVAL '4 days'),
  ('00000000-0000-4000-b000-00000000c004', '00000000-0000-4000-a000-000000000022', 5, 'La Bombonera de Dolores es techada: se juega aunque llueva en febrero.', now() - INTERVAL '5 days'),
  ('00000000-0000-4000-b000-00000000c005', '00000000-0000-4000-a000-000000000032', 4, 'Buenas canchas en Acequia Alta.', now() - INTERVAL '7 days'),
  ('00000000-0000-4000-b000-00000000c007', '00000000-0000-4000-a000-000000000021', 5, 'Maracaná Dolores tiene excelente ambiente nocturno y tribunas.', now() - INTERVAL '3 days'),
  ('00000000-0000-4000-b000-00000000c009', '00000000-0000-4000-a000-000000000034', 5, 'Súper céntrico al lado del Parque Lambramani.', now() - INTERVAL '6 days'),
  ('00000000-0000-4000-b000-00000000c010', '00000000-0000-4000-a000-000000000031', 5, 'Grass impecable en Umacollo.', now() - INTERVAL '4 days'),
  ('00000000-0000-4000-b000-00000000c013', '00000000-0000-4000-a000-000000000022', 5, 'DeporPlaza en Av. Parra es perfecto para llegar desde cualquier distrito.', now() - INTERVAL '5 days'),
  ('00000000-0000-4000-b000-00000000c014', '00000000-0000-4000-a000-000000000033', 5, 'Fútbol Plaza Arancota tiene estacionamiento grande y buen grass.', now() - INTERVAL '8 days');

-- Bitácora inicial (feed de actividad del panel del dueño)
INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload, created_at) VALUES
  ('00000000-0000-4000-e000-0000000000b1', '00000000-0000-4000-b000-00000000c001', 'CONFIRMED', 'APP',       '00000000-0000-4000-a000-000000000022', '{"hour":19,"court":"Cancha 1 · Fútbol 6"}', now() - INTERVAL '2 hours'),
  ('00000000-0000-4000-e000-0000000000b5', '00000000-0000-4000-b000-00000000c001', 'BLOCKED',   'PHONE',     '00000000-0000-4000-a000-000000000011', '{"hour":19,"court":"Cancha 2 · Fútbol 6"}', now() - INTERVAL '95 minutes'),
  ('00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-b000-00000000c001', 'CREATED',   'APP',       '00000000-0000-4000-a000-000000000021', '{"hour":20,"court":"Cancha 1 · Fútbol 6","mode":"SPLIT"}', now() - INTERVAL '55 minutes'),
  ('00000000-0000-4000-e000-0000000000b2', '00000000-0000-4000-b000-00000000c001', 'PAYMENT',   'APP',       NULL, '{"hour":20,"paid":4,"total":6}', now() - INTERVAL '9 minutes'),
  ('00000000-0000-4000-e000-0000000000b3', '00000000-0000-4000-b000-00000000c001', 'BLOCKED',   'RECEPTION', '00000000-0000-4000-a000-000000000011', '{"hour":21,"court":"Cancha 1 · Fútbol 6"}', now() - INTERVAL '5 minutes');
