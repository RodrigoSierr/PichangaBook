import 'package:flutter/foundation.dart';

/// Configuración centralizada de entorno para PichangaBook Arequipa.
///
/// Permite inyectar la URL del backend en compilación mediante:
///   flutter run --dart-define=API_BASE_URL=https://api.pichangabook.pe
///
/// Si no se especifica, selecciona automáticamente:
///  - `http://10.0.2.2:3000` en emulador Android.
///  - `http://localhost:3000` en Web, Linux, macOS, Windows o simulador iOS.
class AppEnvironmentConfig {
  static const String _definedApiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: '');
  static const bool useNativeGoogleMap = bool.fromEnvironment('USE_NATIVE_GOOGLE_MAP', defaultValue: false);
  static const bool firebaseAuthEnabled = bool.fromEnvironment('FIREBASE_AUTH_ENABLED', defaultValue: false);
  static const String defaultComplexId = String.fromEnvironment(
    'DEFAULT_COMPLEX_ID',
    defaultValue: '00000000-0000-4000-b000-00000000c001',
  );
  static const String defaultCourtId = String.fromEnvironment(
    'DEFAULT_COURT_ID',
    defaultValue: '00000000-0000-4000-c000-00000000d011',
  );
  static const String defaultSplitToken = String.fromEnvironment(
    'DEFAULT_SPLIT_TOKEN',
    defaultValue: 'pk4de6demo',
  );
  static const String defaultBookingId = String.fromEnvironment(
    'DEFAULT_BOOKING_ID',
    defaultValue: '00000000-0000-4000-e000-0000000000b2',
  );

  static String resolveApiBaseUrl() {
    if (_definedApiBaseUrl.trim().isNotEmpty) {
      return _definedApiBaseUrl.trim().replaceAll(RegExp(r'/$'), '');
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3000';
    }
    return 'http://localhost:3000';
  }
}
