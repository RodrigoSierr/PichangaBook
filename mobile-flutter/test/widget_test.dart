import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:pichangabook_mobile/main.dart';
import 'package:pichangabook_mobile/services/realtime_api_service.dart';

http.Response _jsonResponse(Object payload, int statusCode) {
  return http.Response.bytes(
    utf8.encode(jsonEncode(payload)),
    statusCode,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}

MockClient _createIsolatedMockClient({
  bool allowDemoFallback = false,
  String currentRole = 'PLAYER',
  List<Map<String, dynamic>>? capturedPatchPayloads,
  List<Map<String, dynamic>>? capturedInvitePayloads,
}) {
  return MockClient((http.Request req) async {
    final path = req.url.path;

    if (path == '/api/health') {
      return _jsonResponse(
        {
          'status': 'ok',
          'databaseDriver': 'pglite',
          'limaDate': '2026-11-08',
          'demoMode': allowDemoFallback,
          'allowDemoFallback': allowDemoFallback,
        },
        200,
      );
    }

    if (path == '/api/auth/demo-session') {
      if (!allowDemoFallback) {
        return _jsonResponse(
          {
            'code': 'DEMO_SESSION_DISABLED',
            'message': 'Las sesiones rápidas de demostración están deshabilitadas.',
          },
          403,
        );
      }
      return _jsonResponse(
        {
          'accessToken': 'jwt_demo_token',
          'user': {
            'id': '00000000-0000-4000-a000-000000000021',
            'fullName': 'Diego Salas',
            'role': currentRole,
            'phoneMasked': '+51 9•• ••• 333',
            'trustScore': 92,
          },
        },
        200,
      );
    }

    if (path == '/api/auth/me' && req.method == 'GET') {
      return _jsonResponse(
        {
          'id': '00000000-0000-4000-a000-000000000021',
          'fullName': 'Piero Cáceres',
          'role': currentRole,
          'phoneMasked': '+51 9•• ••• 101',
          'trustScore': 95,
        },
        200,
      );
    }

    if (path == '/api/auth/me' && req.method == 'PATCH') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      capturedPatchPayloads?.add(body);
      return _jsonResponse(
        {
          'accessToken': 'jwt_preserved_role_token',
          'user': {
            'id': '00000000-0000-4000-a000-000000000021',
            'fullName': body['fullName'] ?? 'Piero Cáceres',
            'role': currentRole,
            'phoneMasked': '+51 9•• ••• 101',
            'trustScore': 95,
          },
        },
        200,
      );
    }

    if (path == '/api/complexes') {
      return _jsonResponse(
        [
          {
            'id': '00000000-0000-4000-b000-00000000c001',
            'name': 'Complejo Deportivo El Misti',
            'ruc': '20601458722',
            'businessName': 'INVERSIONES DEPORTIVAS EL MISTI S.A.C.',
            'verificationStatus': 'VERIFIED',
            'districtCode': 'CAYMA',
            'districtName': 'Cayma',
            'address': 'Av. Ejército 1020, Cayma',
            'lat': -16.3615,
            'lng': -71.5468,
            'photos': ['/media/court-1.jpg'],
            'amenities': ['Estacionamiento', 'Iluminación LED'],
            'rating': '4.9',
            'reviewsCount': 3,
            'courtsCount': 3,
            'minPriceCents': 6000,
            'maxPriceCents': 13000,
            'distanceKm': 2.4,
          },
        ],
        200,
      );
    }

    if (path.startsWith('/api/complexes/')) {
      return _jsonResponse(
        {
          'id': '00000000-0000-4000-b000-00000000c001',
          'name': 'Complejo Deportivo El Misti',
          'ruc': '20601458722',
          'address': 'Av. Ejército 1020, Cayma',
          'amenities': ['Estacionamiento'],
          'courts': [
            {
              'id': '00000000-0000-4000-c000-00000000d011',
              'name': 'Cancha 1 · Fútbol 6',
              'playersPerSide': 6,
              'priceCents': 6000,
              'pricePeakCents': 9000,
              'openHour': 7,
              'closeHour': 23,
            },
          ],
          'reviews': [],
        },
        200,
      );
    }

    if (path.endsWith('/availability')) {
      return _jsonResponse(
        {
          'court': {
            'id': '00000000-0000-4000-c000-00000000d011',
            'name': 'Cancha 1 · Fútbol 6',
          },
          'date': '2026-11-08',
          'slots': [
            {
              'courtId': '00000000-0000-4000-c000-00000000d011',
              'date': '2026-11-08',
              'hour': 19,
              'label': '19:00',
              'status': 'FREE',
              'priceCents': 9000,
            },
          ],
        },
        200,
      );
    }

    if (path.startsWith('/api/split-payments/')) {
      return _jsonResponse(
        {
          'id': 'sp-1',
          'bookingId': '00000000-0000-4000-e000-0000000000b2',
          'shareToken': 'pk4de6demo',
          'totalSlots': 6,
          'paidSlots': 4,
          'remainingSlots': 2,
          'amountPerSlotCents': 1500,
          'totalCents': 9000,
          'status': 'OPEN',
          'bookingStatus': 'HELD',
          'date': '2026-11-08',
          'hour': 20,
          'hourLabel': '20:00',
          'courtId': '00000000-0000-4000-c000-00000000d011',
          'courtName': 'Cancha 1 · Fútbol 6',
          'complexId': '00000000-0000-4000-b000-00000000c001',
          'complexName': 'Complejo Deportivo El Misti',
          'districtName': 'Cayma',
          'organizerName': 'Diego Salas',
          'progressLabel': 'Cupos pagados: 4 de 6',
          'whatsappUrl': 'https://wa.me/?text=Split',
          'shares': [],
        },
        200,
      );
    }

    if (path == '/api/substitutes') {
      return _jsonResponse(
        [
          {
            'id': '00000000-0000-4000-9000-000000000501',
            'userId': '00000000-0000-4000-a000-000000000031',
            'fullName': 'Renzo Valdivia',
            'phoneMasked': '+51 9•• ••• 101',
            'trustScore': 97,
            'position': 'ARQUERO',
            'skillLevel': 5,
            'punctualityScore': '98.50',
            'matchesPlayed': 64,
            'noShows': 1,
            'districtCode': 'CAYMA',
            'districtName': 'Cayma',
            'bio': 'Arquero verificado Arequipa.',
            'clipUrl': '/media/clips/arquero.mp4',
            'clipPosterUrl': '/media/player-arquero.jpg',
            'clipDurationS': 22,
            'isVerified': true,
            'isAvailable': true,
          },
        ],
        200,
      );
    }

    if (path.endsWith('/invite') && req.method == 'POST') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      capturedInvitePayloads?.add(body);
      return _jsonResponse(
        {
          'invitation': {'id': 'inv-1', 'bookingId': body['bookingId']},
          'substitute': {'id': '00000000-0000-4000-9000-000000000501', 'fullName': 'Renzo Valdivia'},
          'relay': {'id': 'rel-1', 'proxyNumber': '+51 (054) 6470-101'},
          'messages': [
            {
              'id': 'msg-1',
              'senderName': 'Piero Cáceres',
              'body': body['message'] ?? 'Hola',
              'wasRedacted': false,
              'createdAt': '2026-11-08T19:00:00Z',
            },
          ],
        },
        200,
      );
    }

    if (path == '/api/bookings/my') {
      return _jsonResponse(
        [
          {
            'id': '00000000-0000-4000-e000-0000000000b2',
            'courtId': '00000000-0000-4000-c000-00000000d011',
            'courtName': 'Cancha 1 · Fútbol 6',
            'complexId': '00000000-0000-4000-b000-00000000c001',
            'complexName': 'Complejo Deportivo El Misti',
            'districtName': 'Cayma',
            'status': 'HELD',
            'channel': 'APP',
            'paymentMode': 'SPLIT',
            'date': '2026-11-08',
            'hour': 20,
            'hourLabel': '20:00',
            'totalCents': 9000,
            'depositCents': 9000,
            'shareToken': 'pk4de6demo',
            'paidSlots': 4,
            'totalSlots': 6,
          },
        ],
        200,
      );
    }

    return _jsonResponse({'ok': true}, 200);
  });
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('PichangaBookApp renderiza navegación principal y oculta opciones demo en modo productivo',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final api = RealtimeApiService(
      baseUrl: 'http://localhost:3000',
      httpClient: _createIsolatedMockClient(allowDemoFallback: false),
      enableWebSocket: false,
    );

    await tester.pumpWidget(PichangaBookApp(api: api));
    await tester.pumpAndSettle();

    expect(find.text('PichangaBook Arequipa'), findsOneWidget);
    expect(find.text('Complejo Deportivo El Misti'), findsWidgets);

    // En modo productivo (allowDemoFallback = false) no se inicia sesión demo automática
    expect(api.isAuthenticated, isFalse);
    expect(find.text('Acceder'), findsOneWidget);

    // Al abrir la hoja de autenticación, no debe mostrarse el cambio rápido de rol demo ni Firebase inactivo
    await tester.tap(find.text('Acceder'));
    await tester.pumpAndSettle();
    expect(find.text('Verificación por celular (OTP SMS)'), findsOneWidget);
    expect(find.text('Cambio rápido de cuenta verificada (Modo Sandbox)'), findsNothing);
  });

  testWidgets('Protección de rol y convocatoria de suplente asociada a reserva activa',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final patchPayloads = <Map<String, dynamic>>[];
    final invitePayloads = <Map<String, dynamic>>[];

    final api = RealtimeApiService(
      baseUrl: 'http://localhost:3000',
      httpClient: _createIsolatedMockClient(
        allowDemoFallback: true,
        currentRole: 'PLAYER',
        capturedPatchPayloads: patchPayloads,
        capturedInvitePayloads: invitePayloads,
      ),
      enableWebSocket: false,
    );

    await tester.pumpWidget(PichangaBookApp(api: api));
    await tester.pumpAndSettle();

    expect(api.currentUser?.role, 'PLAYER');

    // Actualizar perfil no envía campo role y preserva el rol autorizado
    final updated = await api.updateProfile(fullName: 'Piero Actualizado');
    expect(updated.role, 'PLAYER');
    expect(patchPayloads.single.containsKey('role'), isFalse);

    // Navegar a Suplentes y convocar enviando bookingId activo
    await tester.tap(find.text('Suplentes'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Renzo Valdivia · ARQUERO'), findsOneWidget);

    await tester.tap(find.text('Convocar'));
    await tester.pumpAndSettle();
    expect(find.text('Abrir Chat Seguro'), findsOneWidget);

    await tester.tap(find.text('Abrir Chat Seguro'));
    await tester.pumpAndSettle();

    expect(invitePayloads, hasLength(1));
    expect(invitePayloads.single['bookingId'], '00000000-0000-4000-e000-0000000000b2');
    expect(find.textContaining('Relay Seguro · Renzo Valdivia'), findsOneWidget);
  });
}
