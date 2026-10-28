import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Servicio de comunicación REST + WebSockets (Socket.io) con el backend NestJS.
class RealtimeApiService {
  final String baseUrl;
  late final io.Socket socket;

  RealtimeApiService({this.baseUrl = 'http://localhost:3000'});

  void connect({
    required String complexId,
    required void Function(Map<String, dynamic>) onSlotUpdated,
    required void Function(Map<String, dynamic>) onSplitUpdated,
  }) {
    socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setQuery({'complexId': complexId})
          .enableAutoConnect()
          .build(),
    );

    socket.onConnect((_) {
      socket.emit('complex:join', {'complexId': complexId});
      socket.emit('split:join', {'token': 'pk4de6demo'});
    });

    socket.on('slot:updated', (data) {
      if (data is Map) onSlotUpdated(Map<String, dynamic>.from(data));
    });

    socket.on('split:updated', (data) {
      if (data is Map) onSplitUpdated(Map<String, dynamic>.from(data));
    });
  }

  Future<List<dynamic>> fetchComplexes({String district = 'ALL'}) async {
    final uri = Uri.parse('$baseUrl/api/complexes?district=$district&lat=-16.3989&lng=-71.5350');
    final res = await http.get(uri);
    return jsonDecode(res.body) as List<dynamic>;
  }

  Future<Map<String, dynamic>> fetchCourtAvailability(String courtId, {String? date}) async {
    final q = date != null ? '?date=$date' : '';
    final res = await http.get(Uri.parse('$baseUrl/api/courts/$courtId/availability$q'));
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> fetchSplitPayment(String token) async {
    final res = await http.get(Uri.parse('$baseUrl/api/split-payments/$token'));
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> paySplitSlot({
    required String token,
    required String payerName,
    String method = 'YAPE',
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/split-payments/$token/pay'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'payerName': payerName, 'method': method}),
    );
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<List<dynamic>> fetchSubstitutes({String position = 'ALL'}) async {
    final res = await http.get(Uri.parse('$baseUrl/api/substitutes?position=$position'));
    return jsonDecode(res.body) as List<dynamic>;
  }

  void dispose() {
    socket.dispose();
  }
}
