import 'package:flutter/material.dart';
import 'services/realtime_api_service.dart';
import 'screens/arequipa_map_screen.dart';
import 'screens/court_detail_screen.dart';
import 'screens/split_payment_screen.dart';
import 'screens/substitutes_pool_screen.dart';

void main() {
  runApp(const PichangaBookApp());
}

/// Punto de entrada de la App Móvil PichangaBook Arequipa (Flutter / Dart).
class PichangaBookApp extends StatefulWidget {
  const PichangaBookApp({super.key});

  @override
  State<PichangaBookApp> createState() => _PichangaBookAppState();
}

class _PichangaBookAppState extends State<PichangaBookApp> {
  final RealtimeApiService _api = RealtimeApiService();
  int _tabIndex = 0;
  String _selectedCourtId = '00000000-0000-4000-c000-00000000d011';
  String _selectedComplexName = 'Complejo Deportivo El Misti';

  @override
  void initState() {
    super.initState();
    _api.connect(
      complexId: '00000000-0000-4000-b000-00000000c001',
      onSlotUpdated: (_) => setState(() {}),
      onSplitUpdated: (_) => setState(() {}),
    );
  }

  @override
  void dispose() {
    _api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screens = [
      ArequipaMapScreen(
        api: _api,
        onSelectComplex: (c) {
          setState(() {
            _selectedComplexName = c['name'] as String;
            _tabIndex = 1;
          });
        },
      ),
      CourtDetailScreen(
        api: _api,
        courtId: _selectedCourtId,
        complexName: _selectedComplexName,
      ),
      SplitPaymentScreen(api: _api),
      SubstitutesPoolScreen(api: _api),
    ];

    return MaterialApp(
      title: 'PichangaBook Arequipa',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF10B981),
          secondary: Color(0xFF38BDF8),
        ),
      ),
      home: Scaffold(
        appBar: AppBar(
          backgroundColor: const Color(0xFF0F172A),
          title: const Text('PichangaBook Arequipa'),
        ),
        body: screens[_tabIndex],
        bottomNavigationBar: BottomNavigationBar(
          currentIndex: _tabIndex,
          selectedItemColor: const Color(0xFF10B981),
          unselectedItemColor: Colors.white54,
          backgroundColor: const Color(0xFF090D16),
          type: BottomNavigationBarType.fixed,
          onTap: (idx) => setState(() => _tabIndex = idx),
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.map), label: 'Mapa AQP'),
            BottomNavigationBarItem(icon: Icon(Icons.sports_soccer), label: 'Reservar'),
            BottomNavigationBarItem(icon: Icon(Icons.group_add), label: 'Split 4/6'),
            BottomNavigationBarItem(icon: Icon(Icons.videocam), label: 'Suplentes'),
          ],
        ),
      ),
    );
  }
}
