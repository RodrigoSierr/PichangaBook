import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../services/realtime_api_service.dart';

/// Vista 1: Mapa Interactivo de Arequipa con filtro por distritos clave
/// (Cayma, Yanahuara, Cerro Colorado, J.L. Bustamante y Rivero, Sachaca).
class ArequipaMapScreen extends StatefulWidget {
  final RealtimeApiService api;
  final void Function(Map<String, dynamic> complex) onSelectComplex;

  const ArequipaMapScreen({
    super.key,
    required this.api,
    required this.onSelectComplex,
  });

  @override
  State<ArequipaMapScreen> createState() => _ArequipaMapScreenState();
}

class _ArequipaMapScreenState extends State<ArequipaMapScreen> {
  static const CameraPosition _arequipaCenter = CameraPosition(
    target: LatLng(-16.3880, -71.5430),
    zoom: 12.8,
  );

  final List<Map<String, String>> _districts = const [
    {'code': 'ALL', 'name': 'Todos AQP'},
    {'code': 'CAYMA', 'name': 'Cayma'},
    {'code': 'YANAHUARA', 'name': 'Yanahuara'},
    {'code': 'CERRO_COLORADO', 'name': 'Cerro Colorado'},
    {'code': 'JLBYR', 'name': 'J.L. Bustamante'},
    {'code': 'SACHACA', 'name': 'Sachaca'},
  ];

  String _selectedDistrict = 'ALL';
  List<dynamic> _complexes = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadComplexes();
  }

  Future<void> _loadComplexes() async {
    setState(() => _loading = true);
    final data = await widget.api.fetchComplexes(district: _selectedDistrict);
    if (!mounted) return;
    setState(() {
      _complexes = data;
      _loading = false;
    });
  }

  Set<Marker> _buildMarkers() {
    return _complexes.map((raw) {
      final c = raw as Map<String, dynamic>;
      return Marker(
        markerId: MarkerId(c['id'] as String),
        position: LatLng((c['lat'] as num).toDouble(), (c['lng'] as num).toDouble()),
        infoWindow: InfoWindow(
          title: c['name'] as String,
          snippet: '${c['districtName']} · ★ ${c['rating']} · RUC Verificado',
          onTap: () => widget.onSelectComplex(c),
        ),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      );
    }).toSet();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Chips de distritos de Arequipa
        SizedBox(
          height: 48,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            scrollDirection: Axis.horizontal,
            itemCount: _districts.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, index) {
              final d = _districts[index];
              final selected = d['code'] == _selectedDistrict;
              return ChoiceChip(
                label: Text(d['name']!),
                selected: selected,
                selectedColor: const Color(0xFF10B981),
                labelStyle: TextStyle(
                  color: selected ? const Color(0xFF0F172A) : Colors.white,
                  fontWeight: FontWeight.bold,
                ),
                onSelected: (_) {
                  setState(() => _selectedDistrict = d['code']!);
                  _loadComplexes();
                },
              );
            },
          ),
        ),
        // Mapa Google Maps SDK centrado en Arequipa
        SizedBox(
          height: 230,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: GoogleMap(
              initialCameraPosition: _arequipaCenter,
              markers: _buildMarkers(),
              myLocationEnabled: true,
              zoomControlsEnabled: false,
            ),
          ),
        ),
        const SizedBox(height: 10),
        // Lista de complejos sintéticos verificados
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _complexes.length,
                  itemBuilder: (_, idx) {
                    final c = _complexes[idx] as Map<String, dynamic>;
                    final price = ((c['minPriceCents'] as num) / 100).toStringAsFixed(0);
                    return Card(
                      color: const Color(0xFF1E293B),
                      margin: const EdgeInsets.only(bottom: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      child: ListTile(
                        onTap: () => widget.onSelectComplex(c),
                        title: Text(
                          c['name'] as String,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          '${c['districtName']} · ${c['address']} · ★ ${c['rating']}',
                          style: const TextStyle(color: Colors.white70, fontSize: 12),
                        ),
                        trailing: Text(
                          'S/ $price/h',
                          style: const TextStyle(
                            color: Color(0xFF10B981),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
