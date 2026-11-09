import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../config/app_config.dart';
import '../models/models.dart';

class ApiException implements Exception {
  final int statusCode;
  final String code;
  final String message;

  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  @override
  String toString() => message;
}

/// Servicio centralizado REST + WebSockets (Socket.io) para PichangaBook Arequipa.
class RealtimeApiService extends ChangeNotifier {
  static const String _tokenStorageKey = 'pichangabook_jwt_token';
  static const String _userStorageKey = 'pichangabook_user_profile';

  final String baseUrl;
  final http.Client _http;
  final bool enableWebSocket;

  io.Socket? _socket;
  String? _accessToken;
  UserProfile? _currentUser;
  bool _socketConnected = false;
  bool _demoModeAvailable = true;
  String _limaDate = '';

  RealtimeApiService({
    String? baseUrl,
    http.Client? httpClient,
    this.enableWebSocket = true,
  })  : baseUrl = (baseUrl ?? AppEnvironmentConfig.resolveApiBaseUrl()).replaceAll(RegExp(r'/$'), ''),
        _http = httpClient ?? http.Client();

  String? get accessToken => _accessToken;
  UserProfile? get currentUser => _currentUser;
  bool get isAuthenticated => _accessToken != null && _currentUser != null;
  bool get socketConnected => _socketConnected;
  bool get demoModeAvailable => _demoModeAvailable;
  String get limaDate => _limaDate;

  Map<String, String> _headers({bool jsonBody = false}) {
    final headers = <String, String>{
      'Accept': 'application/json',
    };
    if (jsonBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (_accessToken != null && _accessToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_accessToken';
    }
    return headers;
  }

  dynamic _decodeResponse(http.Response res) {
    final raw = res.body.isNotEmpty ? jsonDecode(res.body) : <String, dynamic>{};
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return raw;
    }
    String message = 'Error de comunicación (${res.statusCode})';
    String code = 'HTTP_${res.statusCode}';
    if (raw is Map) {
      if (raw['code'] != null) code = raw['code'].toString();
      final msg = raw['message'];
      if (msg is List && msg.isNotEmpty) {
        message = msg.first.toString();
      } else if (msg != null) {
        message = msg.toString();
      }
    }
    throw ApiException(statusCode: res.statusCode, code: code, message: message);
  }

  /// Restaura la sesión JWT persistida o inicializa una sesión de demostración si el backend lo permite.
  Future<void> initializeSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final storedToken = prefs.getString(_tokenStorageKey);
      final storedUser = prefs.getString(_userStorageKey);
      if (storedToken != null && storedToken.isNotEmpty && storedUser != null) {
        _accessToken = storedToken;
        _currentUser = UserProfile.fromJson(jsonDecode(storedUser) as Map<String, dynamic>);
        notifyListeners();
      }
    } catch (_) {
      // Ignorar fallos de almacenamiento en entornos sin disco.
    }

    try {
      final health = await fetchHealth();
      _demoModeAvailable = health['allowDemoFallback'] == true || health['demoMode'] == true;
      _limaDate = (health['limaDate'] ?? '').toString();
      if (_accessToken != null) {
        await fetchMe();
      } else if (_demoModeAvailable) {
        await startDemoSession(role: 'ORGANIZER');
      }
    } catch (_) {
      // Mantiene el estado actual si el backend aún no responde.
    }
  }

  Future<void> _persistSession(String token, UserProfile user) async {
    _accessToken = token;
    _currentUser = user;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_tokenStorageKey, token);
      await prefs.setString(_userStorageKey, jsonEncode(user.toJson()));
    } catch (_) {}
  }

  Future<void> logout() async {
    _accessToken = null;
    _currentUser = null;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_tokenStorageKey);
      await prefs.remove(_userStorageKey);
    } catch (_) {}
  }

  void connect({
    required String complexId,
    String splitToken = AppEnvironmentConfig.defaultSplitToken,
    void Function(Map<String, dynamic>)? onSlotUpdated,
    void Function(Map<String, dynamic>)? onSplitUpdated,
    void Function(Map<String, dynamic>)? onRelayMessage,
  }) {
    if (!enableWebSocket) return;
    _socket?.dispose();

    final builder = io.OptionBuilder()
        .setTransports(['websocket'])
        .setQuery({'complexId': complexId})
        .enableAutoConnect();

    if (_accessToken != null && _accessToken!.isNotEmpty) {
      builder.setAuth({'token': _accessToken});
    }

    final socket = io.io(baseUrl, builder.build());
    _socket = socket;

    socket.onConnect((_) {
      _socketConnected = true;
      socket.emit('complex:join', {'complexId': complexId});
      socket.emit('split:join', {'token': splitToken});
      notifyListeners();
    });

    socket.onDisconnect((_) {
      _socketConnected = false;
      notifyListeners();
    });

    socket.on('slot:updated', (data) {
      if (data is Map && onSlotUpdated != null) {
        onSlotUpdated(Map<String, dynamic>.from(data));
      }
    });

    socket.on('split:updated', (data) {
      if (data is Map && onSplitUpdated != null) {
        onSplitUpdated(Map<String, dynamic>.from(data));
      }
    });

    socket.on('relay:message', (data) {
      if (data is Map && onRelayMessage != null) {
        onRelayMessage(Map<String, dynamic>.from(data));
      }
    });
  }

  void joinComplexRoom(String complexId) {
    _socket?.emit('complex:join', {'complexId': complexId});
  }

  void joinSplitRoom(String token) {
    _socket?.emit('split:join', {'token': token});
  }

  void joinRelayRoom(String relayId) {
    _socket?.emit('relay:join', {
      'relayId': relayId,
      if (_accessToken != null) 'token': _accessToken,
      if (_accessToken != null) 'accessToken': _accessToken,
    });
  }

  // ---------------------------------------------------------------------------
  // Salud y Autenticación
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> fetchHealth() async {
    final res = await _http.get(Uri.parse('$baseUrl/api/health'), headers: _headers());
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/auth/otp/request'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'phone': phone}),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<UserProfile> verifyOtp({
    required String phone,
    required String code,
    String? fullName,
    String? role,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/auth/otp/verify'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'phone': phone,
        'code': code,
        if (fullName != null && fullName.trim().isNotEmpty) 'fullName': fullName.trim(),
        if (role != null) 'role': role,
      }),
    );
    final data = Map<String, dynamic>.from(_decodeResponse(res) as Map);
    final user = UserProfile.fromJson(Map<String, dynamic>.from(data['user'] as Map));
    await _persistSession(data['accessToken'].toString(), user);
    return user;
  }

  Future<UserProfile> loginWithFirebase({
    required String idToken,
    String? fullName,
    String? role,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/auth/firebase'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'idToken': idToken,
        if (fullName != null && fullName.trim().isNotEmpty) 'fullName': fullName.trim(),
        if (role != null) 'role': role,
      }),
    );
    final data = Map<String, dynamic>.from(_decodeResponse(res) as Map);
    final user = UserProfile.fromJson(Map<String, dynamic>.from(data['user'] as Map));
    await _persistSession(data['accessToken'].toString(), user);
    return user;
  }

  Future<UserProfile> startDemoSession({String role = 'ORGANIZER'}) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/auth/demo-session'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'role': role}),
    );
    final data = Map<String, dynamic>.from(_decodeResponse(res) as Map);
    final user = UserProfile.fromJson(Map<String, dynamic>.from(data['user'] as Map));
    await _persistSession(data['accessToken'].toString(), user);
    return user;
  }

  Future<UserProfile> fetchMe() async {
    final res = await _http.get(Uri.parse('$baseUrl/api/auth/me'), headers: _headers());
    final data = Map<String, dynamic>.from(_decodeResponse(res) as Map);
    final user = UserProfile.fromJson(data);
    if (_accessToken != null) {
      await _persistSession(_accessToken!, user);
    }
    return user;
  }

  Future<UserProfile> updateProfile({String? fullName}) async {
    final res = await _http.patch(
      Uri.parse('$baseUrl/api/auth/me'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        if (fullName != null && fullName.trim().isNotEmpty) 'fullName': fullName.trim(),
      }),
    );
    final data = Map<String, dynamic>.from(_decodeResponse(res) as Map);
    final user = UserProfile.fromJson(Map<String, dynamic>.from(data['user'] as Map));
    await _persistSession(data['accessToken'].toString(), user);
    return user;
  }

  // ---------------------------------------------------------------------------
  // Complejos, Canchas y Disponibilidad
  // ---------------------------------------------------------------------------
  Future<List<Map<String, dynamic>>> fetchComplexes({
    String district = 'ALL',
    String search = '',
    double lat = -16.3989,
    double lng = -71.5350,
  }) async {
    final query = <String, String>{
      'district': district,
      'lat': lat.toString(),
      'lng': lng.toString(),
      if (search.trim().isNotEmpty) 'q': search.trim(),
    };
    final uri = Uri.parse('$baseUrl/api/complexes').replace(queryParameters: query);
    final res = await _http.get(uri, headers: _headers());
    final list = _decodeResponse(res) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<Map<String, dynamic>> fetchComplexDetail(String complexId, {String? date}) async {
    final query = date != null && date.isNotEmpty ? '?date=$date' : '';
    final res = await _http.get(
      Uri.parse('$baseUrl/api/complexes/$complexId$query'),
      headers: _headers(),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> fetchCourtAvailability(String courtId, {String? date}) async {
    final query = date != null && date.isNotEmpty ? '?date=$date' : '';
    final res = await _http.get(
      Uri.parse('$baseUrl/api/courts/$courtId/availability$query'),
      headers: _headers(),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> postReview({
    required String complexId,
    required int rating,
    required String comment,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/complexes/$complexId/reviews'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'rating': rating, 'comment': comment.trim()}),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  // ---------------------------------------------------------------------------
  // Reservas y Split Payment
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> createBooking({
    required String courtId,
    required String date,
    required int hour,
    required String paymentMode,
    required String sourceId,
    String method = 'YAPE',
    int totalSlots = 6,
    String? notes,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/bookings'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'courtId': courtId,
        'date': date,
        'hour': hour,
        'paymentMode': paymentMode,
        'method': method,
        'sourceId': sourceId,
        if (paymentMode == 'SPLIT') 'totalSlots': totalSlots,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      }),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> releaseBooking(String bookingId) async {
    final res = await _http.delete(
      Uri.parse('$baseUrl/api/bookings/$bookingId'),
      headers: _headers(),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<List<BookingRecord>> fetchMyBookings() async {
    final res = await _http.get(Uri.parse('$baseUrl/api/bookings/my'), headers: _headers());
    final list = _decodeResponse(res) as List<dynamic>;
    return list.map((e) => BookingRecord.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }

  Future<Map<String, dynamic>> fetchSplitPayment(String token) async {
    final res = await _http.get(Uri.parse('$baseUrl/api/split-payments/$token'), headers: _headers());
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> paySplitSlot({
    required String token,
    required String payerName,
    String method = 'YAPE',
    String? sourceId,
    String? payerPhone,
  }) async {
    final prefix = method == 'CARD' ? 'tok' : method == 'PLIN' ? 'pln' : 'ype';
    final resolvedSourceId = sourceId ?? '${prefix}_sandbox_${DateTime.now().millisecondsSinceEpoch}';
    final res = await _http.post(
      Uri.parse('$baseUrl/api/split-payments/$token/pay'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'payerName': payerName.trim(),
        'method': method,
        'sourceId': resolvedSourceId,
        if (payerPhone != null && payerPhone.trim().isNotEmpty) 'payerPhone': payerPhone.trim(),
      }),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  // ---------------------------------------------------------------------------
  // Bolsa de Suplentes y Relay Enmascarado
  // ---------------------------------------------------------------------------
  Future<List<Map<String, dynamic>>> fetchSubstitutes({
    String position = 'ALL',
    String district = 'ALL',
    int? minSkill,
  }) async {
    final query = <String, String>{
      'position': position,
      'district': district,
      if (minSkill != null) 'minSkill': minSkill.toString(),
    };
    final uri = Uri.parse('$baseUrl/api/substitutes').replace(queryParameters: query);
    final res = await _http.get(uri, headers: _headers());
    final list = _decodeResponse(res) as List<dynamic>;
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<Map<String, dynamic>> inviteSubstitute({
    required String profileId,
    required String bookingId,
    required String message,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/substitutes/$profileId/invite'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'bookingId': bookingId,
        'message': message.trim(),
      }),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> fetchRelay(String relayId) async {
    final res = await _http.get(Uri.parse('$baseUrl/api/relays/$relayId'), headers: _headers());
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  Future<Map<String, dynamic>> sendRelayMessage({
    required String relayId,
    required String text,
  }) async {
    final res = await _http.post(
      Uri.parse('$baseUrl/api/relays/$relayId/messages'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'text': text.trim()}),
    );
    return Map<String, dynamic>.from(_decodeResponse(res) as Map);
  }

  @override
  void dispose() {
    _socket?.dispose();
    super.dispose();
  }
}
