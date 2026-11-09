import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:pichangabook_mobile/config/app_config.dart';
import 'package:pichangabook_mobile/main.dart';
import 'package:pichangabook_mobile/models/models.dart';
import 'package:pichangabook_mobile/services/realtime_api_service.dart';

http.Response jsonUtf8Response(Object payload, int statusCode) {
  return http.Response.bytes(
    utf8.encode(jsonEncode(payload)),
    statusCode,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}

MockClient buildMockHttpClient() {
  int paidSlots = 4;

  return MockClient((http.Request req) async {
    final path = req.url.path;

    if (path == '/api/health') {
      return jsonUtf8Response(
        {
          'status': 'ok',
          'databaseDriver': 'pglite',
          'limaDate': '2026-11-06',
          'demoMode': true,
          'allowDemoFallback': true,
        },
        200,
      );
    }

    if (path == '/api/auth/demo-session' || path == '/api/auth/otp/verify') {
      return jsonUtf8Response(
        {
          'accessToken': 'jwt_test_token_123',
          'user': {
            'id': '00000000-0000-4000-a000-000000000021',
            'fullName': 'Diego Salas',
            'role': 'ORGANIZER',
            'phoneMasked': '+51 9•• ••• 333',
            'trustScore': 92,
          },
        },
        200,
      );
    }

    if (path == '/api/auth/otp/request') {
      return jsonUtf8Response(
        {
          'expiresInSeconds': 300,
          'provider': 'DEMO',
          'devCode': '123456',
          'demoOtp': '123456',
        },
        200,
      );
    }

    if (path == '/api/auth/me') {
      return jsonUtf8Response(
        {
          'id': '00000000-0000-4000-a000-000000000021',
          'fullName': 'Diego Salas',
          'role': 'ORGANIZER',
          'phoneMasked': '+51 9•• ••• 333',
          'trustScore': 92,
          'bookingsCount': 2,
          'ownedComplexesCount': 0,
        },
        200,
      );
    }

    if (path == '/api/complexes') {
      return jsonUtf8Response(
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
      return jsonUtf8Response(
        {
          'id': '00000000-0000-4000-b000-00000000c001',
          'name': 'Complejo Deportivo El Misti',
          'ruc': '20601458722',
          'address': 'Av. Ejército 1020, Cayma',
          'amenities': ['Estacionamiento', 'Iluminación LED'],
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
          'reviews': [
            {
              'id': 'rev-1',
              'rating': 5,
              'comment': 'Excelente grass sintético e iluminación.',
              'authorName': 'Diego Salas',
              'createdAt': '2026-11-05',
            },
          ],
        },
        200,
      );
    }

    if (path.endsWith('/availability')) {
      return jsonUtf8Response(
        {
          'court': {
            'id': '00000000-0000-4000-c000-00000000d011',
            'name': 'Cancha 1 · Fútbol 6',
          },
          'date': '2026-11-06',
          'slots': [
            {
              'courtId': '00000000-0000-4000-c000-00000000d011',
              'date': '2026-11-06',
              'hour': 18,
              'label': '18:00',
              'status': 'FREE',
              'priceCents': 9000,
            },
            {
              'courtId': '00000000-0000-4000-c000-00000000d011',
              'date': '2026-11-06',
              'hour': 20,
              'label': '20:00',
              'status': 'HELD',
              'priceCents': 9000,
              'split': {'paid': paidSlots, 'total': 6, 'shareToken': 'pk4de6demo'},
            },
          ],
        },
        200,
      );
    }

    if (path == '/api/split-payments/pk4de6demo') {
      return jsonUtf8Response(
        {
          'id': 'sp-1',
          'bookingId': 'bk-1',
          'shareToken': 'pk4de6demo',
          'totalSlots': 6,
          'paidSlots': paidSlots,
          'remainingSlots': 6 - paidSlots,
          'amountPerSlotCents': 1500,
          'totalCents': 9000,
          'status': paidSlots >= 6 ? 'COMPLETED' : 'OPEN',
          'bookingStatus': paidSlots >= 6 ? 'CONFIRMED' : 'HELD',
          'date': '2026-11-06',
          'hour': 20,
          'hourLabel': '20:00',
          'courtId': '00000000-0000-4000-c000-00000000d011',
          'courtName': 'Cancha 1 · Fútbol 6',
          'complexId': '00000000-0000-4000-b000-00000000c001',
          'complexName': 'Complejo Deportivo El Misti',
          'districtName': 'Cayma',
          'organizerName': 'Diego Salas',
          'progressLabel': 'Cupos pagados: $paidSlots de 6',
          'whatsappUrl': 'https://wa.me/?text=DemoSplit',
          'shares': [
            {
              'id': 'sh-1',
              'payerName': 'Diego Salas (organizador)',
              'method': 'YAPE',
              'providerChargeId': 'chr_demo_0001',
              'amountCents': 1500,
              'paidAt': '2026-11-06T19:00:00Z',
            },
          ],
        },
        200,
      );
    }

    if (path == '/api/split-payments/pk4de6demo/pay' && req.method == 'POST') {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      final sourceId = (body['sourceId'] ?? '').toString();
      if (sourceId.contains('declined')) {
        return jsonUtf8Response(
          {
            'code': 'PAYMENT_DECLINED',
            'message': 'El pago fue rechazado por fondos insuficientes.',
          },
          400,
        );
      }
      paidSlots += 1;
      return jsonUtf8Response(
        {
          'id': 'sp-1',
          'bookingId': 'bk-1',
          'shareToken': 'pk4de6demo',
          'totalSlots': 6,
          'paidSlots': paidSlots,
          'remainingSlots': 6 - paidSlots,
          'amountPerSlotCents': 1500,
          'totalCents': 9000,
          'status': paidSlots >= 6 ? 'COMPLETED' : 'OPEN',
          'bookingStatus': paidSlots >= 6 ? 'CONFIRMED' : 'HELD',
          'date': '2026-11-06',
          'hour': 20,
          'hourLabel': '20:00',
          'courtId': '00000000-0000-4000-c000-00000000d011',
          'courtName': 'Cancha 1 · Fútbol 6',
          'complexId': '00000000-0000-4000-b000-00000000c001',
          'complexName': 'Complejo Deportivo El Misti',
          'districtName': 'Cayma',
          'organizerName': 'Diego Salas',
          'progressLabel': 'Cupos pagados: $paidSlots de 6',
          'whatsappUrl': 'https://wa.me/?text=DemoSplit',
          'shares': [
            {
              'id': 'sh-1',
              'payerName': 'Diego Salas (organizador)',
              'method': 'YAPE',
              'providerChargeId': 'chr_demo_0001',
              'amountCents': 1500,
              'paidAt': '2026-11-06T19:00:00Z',
            },
            {
              'id': 'sh-2',
              'payerName': body['payerName'],
              'method': body['method'],
              'providerChargeId': 'chr_demo_0005',
              'amountCents': 1500,
              'paidAt': '2026-11-06T19:05:00Z',
            },
          ],
          'lastCharge': {'status': 'succeeded', 'userMessage': 'Cargo aprobado'},
        },
        200,
      );
    }

    if (path == '/api/substitutes') {
      return jsonUtf8Response(
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
            'bio': 'Arquero de reflejos rápidos. Ex Sub-20 FBC Melgar.',
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

    if (path == '/api/bookings/my') {
      return jsonUtf8Response(
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
            'date': '2026-11-06',
            'hour': 20,
            'hourLabel': '20:00',
            'totalCents': 9000,
            'depositCents': 9000,
            'shareToken': 'pk4de6demo',
            'paidSlots': paidSlots,
            'totalSlots': 6,
          },
        ],
        200,
      );
    }

    return jsonUtf8Response({'ok': true}, 200);
  });
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('Unit: AppEnvironmentConfig y modelos parsean datos correctamente', () {
    expect(AppEnvironmentConfig.resolveApiBaseUrl(), isNotEmpty);

    final complex = SportsComplex.fromJson({
      'id': 'c1',
      'name': 'Complejo El Misti',
      'ruc': '20601458722',
      'districtName': 'Cayma',
      'minPriceCents': 6000,
      'rating': '4.9',
    });
    expect(complex.minPriceSoles, '60');
    expect(complex.rating, closeTo(4.9, 0.01));
  });

  test('Unit: RealtimeApiService autentica con OTP, persiste JWT y maneja rechazos de pago', () async {
    final api = RealtimeApiService(
      baseUrl: 'http://localhost:3000',
      httpClient: buildMockHttpClient(),
      enableWebSocket: false,
    );

    final otp = await api.requestOtp('+51958222333');
    expect(otp['devCode'], '123456');

    final user = await api.verifyOtp(
      phone: '+51958222333',
      code: '123456',
      fullName: 'Diego Salas',
      role: 'ORGANIZER',
    );
    expect(user.role, 'ORGANIZER');
    expect(api.isAuthenticated, isTrue);

    expect(
      () => api.paySplitSlot(
        token: 'pk4de6demo',
        payerName: 'Jugador Test',
        sourceId: 'tok_test_declined_card',
      ),
      throwsA(isA<ApiException>()),
    );
  });

  testWidgets('Widget: Flujo completo Mapa AQP -> Parrilla -> Split Payment -> Suplentes -> Mis Reservas',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final api = RealtimeApiService(
      baseUrl: 'http://localhost:3000',
      httpClient: buildMockHttpClient(),
      enableWebSocket: false,
    );

    await tester.pumpWidget(PichangaBookApp(api: api));
    await tester.pumpAndSettle();

    // 1. Verifica vista Mapa de Arequipa y complejo verificado
    expect(find.text('Complejo Deportivo El Misti'), findsWidgets);
    expect(find.textContaining('RUC 20601458722'), findsOneWidget);

    // 2. Navegar a pestaña Reservar (Parrilla Horaria)
    await tester.tap(find.byIcon(Icons.sports_soccer).last);
    await tester.pumpAndSettle();
    expect(find.text('Disponible · Reservar'), findsOneWidget);
    expect(find.text('Split 4/6'), findsWidgets);

    // 3. Navegar a pestaña Split Payment y abonar un cupo (4/6 -> 5/6)
    await tester.tap(find.text('Split 4/6').last);
    await tester.pumpAndSettle();
    expect(find.text('Cupos pagados: 4 de 6'), findsOneWidget);

    final payBtn = find.text('Abonar YAPE S/ 15.00');
    await tester.ensureVisible(payBtn);
    await tester.tap(payBtn);
    await tester.pumpAndSettle();
    expect(find.text('Cupos pagados: 5 de 6'), findsOneWidget);

    // 4. Navegar a pestaña Suplentes
    await tester.tap(find.text('Suplentes'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Renzo Valdivia · ARQUERO'), findsOneWidget);
    expect(find.textContaining('98.5% Puntualidad'), findsOneWidget);

    // 5. Navegar a pestaña Mis Reservas
    await tester.tap(find.text('Mis Reservas'));
    await tester.pumpAndSettle();
    expect(find.text('Mis Reservas y Pichangas'), findsOneWidget);
    expect(find.textContaining('Cancelar / Liberar turno'), findsOneWidget);
  });
}
