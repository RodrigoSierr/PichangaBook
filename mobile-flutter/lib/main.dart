import 'package:flutter/material.dart';
import 'config/app_config.dart';
import 'screens/arequipa_map_screen.dart';
import 'screens/auth_sheet.dart';
import 'screens/court_detail_screen.dart';
import 'screens/my_bookings_screen.dart';
import 'screens/split_payment_screen.dart';
import 'screens/substitutes_pool_screen.dart';
import 'services/realtime_api_service.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PichangaBookApp());
}

/// Aplicación Móvil Principal de PichangaBook Arequipa (Flutter / Dart).
class PichangaBookApp extends StatefulWidget {
  final RealtimeApiService? api;

  const PichangaBookApp({super.key, this.api});

  @override
  State<PichangaBookApp> createState() => _PichangaBookAppState();
}

class _PichangaBookAppState extends State<PichangaBookApp> {
  late final RealtimeApiService _api;
  late final bool _ownsApi;
  int _tabIndex = 0;
  String _selectedComplexId = AppEnvironmentConfig.defaultComplexId;
  final String _selectedCourtId = AppEnvironmentConfig.defaultCourtId;
  String _selectedComplexName = 'Complejo Deportivo El Misti';
  String _activeSplitToken = AppEnvironmentConfig.defaultSplitToken;

  @override
  void initState() {
    super.initState();
    _ownsApi = widget.api == null;
    _api = widget.api ?? RealtimeApiService();
    _api.addListener(_onApiChanged);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    await _api.initializeSession();
    if (!mounted) return;
    _api.connect(
      complexId: _selectedComplexId,
      splitToken: _activeSplitToken,
      onSlotUpdated: (_) {
        if (mounted) setState(() {});
      },
      onSplitUpdated: (_) {
        if (mounted) setState(() {});
      },
    );
  }

  void _onApiChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _api.removeListener(_onApiChanged);
    if (_ownsApi) {
      _api.dispose();
    }
    super.dispose();
  }

  void _openSplitToken(String token) {
    setState(() {
      _activeSplitToken = token;
      _tabIndex = 2;
    });
    _api.joinSplitRoom(token);
  }

  @override
  Widget build(BuildContext context) {
    final user = _api.currentUser;
    final screens = [
      ArequipaMapScreen(
        api: _api,
        onSelectComplex: (c) {
          final cid = (c['id'] ?? AppEnvironmentConfig.defaultComplexId).toString();
          setState(() {
            _selectedComplexId = cid;
            _selectedComplexName = (c['name'] ?? 'Complejo Deportivo').toString();
            _tabIndex = 1;
          });
          _api.joinComplexRoom(cid);
        },
      ),
      CourtDetailScreen(
        api: _api,
        complexId: _selectedComplexId,
        courtId: _selectedCourtId,
        complexName: _selectedComplexName,
        onOpenSplitToken: _openSplitToken,
      ),
      SplitPaymentScreen(
        api: _api,
        shareToken: _activeSplitToken,
      ),
      SubstitutesPoolScreen(api: _api),
      MyBookingsScreen(
        api: _api,
        onOpenSplitToken: _openSplitToken,
      ),
    ];

    return MaterialApp(
      title: 'PichangaBook Arequipa',
      debugShowCheckedModeBanner: false,
      theme: PichangaTheme.dark(),
      home: Builder(
        builder: (innerContext) => Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: PichangaTheme.turfGreenDark,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: PichangaTheme.turfGreen),
                  ),
                  child: const Icon(Icons.sports_soccer, size: 18, color: PichangaTheme.turfGreen),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'PichangaBook Arequipa',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                      ),
                      Text(
                        'Canchas verificadas · Split · Suplentes',
                        style: TextStyle(fontSize: 10, color: PichangaTheme.textSecondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              // Indicador de conexión Socket.io
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: _api.socketConnected
                        ? PichangaTheme.turfGreenDark
                        : PichangaTheme.bgElevated,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: _api.socketConnected ? PichangaTheme.turfGreen : Colors.white24,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.circle,
                        size: 7,
                        color: _api.socketConnected ? PichangaTheme.turfGreen : PichangaTheme.warningAmber,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _api.socketConnected ? 'LIVE' : 'SYNC',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 6),
              // Botón de sesión / cambio de rol
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: ActionChip(
                  backgroundColor: PichangaTheme.bgElevated,
                  avatar: const Icon(Icons.verified_user, size: 15, color: PichangaTheme.turfGreen),
                  label: Text(
                    user != null ? '${user.fullName.split(" ").first} (${user.role})' : 'Acceder',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  onPressed: () {
                    showModalBottomSheet<bool>(
                      context: innerContext,
                      isScrollControlled: true,
                      backgroundColor: PichangaTheme.bgSecondary,
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
                      ),
                      builder: (_) => AuthSheet(api: _api),
                    );
                  },
                ),
              ),
            ],
          ),
          body: screens[_tabIndex],
          bottomNavigationBar: BottomNavigationBar(
            currentIndex: _tabIndex,
            selectedItemColor: PichangaTheme.turfGreen,
            unselectedItemColor: Colors.white54,
            backgroundColor: const Color(0xFF090D16),
            type: BottomNavigationBarType.fixed,
            selectedFontSize: 11,
            unselectedFontSize: 11,
            onTap: (idx) => setState(() => _tabIndex = idx),
            items: const [
              BottomNavigationBarItem(icon: Icon(Icons.map_outlined), label: 'Mapa AQP'),
              BottomNavigationBarItem(icon: Icon(Icons.sports_soccer), label: 'Reservar'),
              BottomNavigationBarItem(icon: Icon(Icons.group_add_outlined), label: 'Split 4/6'),
              BottomNavigationBarItem(icon: Icon(Icons.videocam_outlined), label: 'Suplentes'),
              BottomNavigationBarItem(icon: Icon(Icons.calendar_today_outlined), label: 'Mis Reservas'),
            ],
          ),
        ),
      ),
    );
  }
}
