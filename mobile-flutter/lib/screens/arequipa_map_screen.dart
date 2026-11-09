import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../config/app_config.dart';
import '../models/models.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';

/// Vista 1: Mapa Interactivo de Arequipa con filtro por distritos clave,
/// buscador en vivo, cálculo de distancia Haversine y verificación SUNAT RUC.
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

  final TextEditingController _searchCtrl = TextEditingController();
  String _selectedDistrict = 'ALL';
  List<Map<String, dynamic>> _rawComplexes = [];
  List<SportsComplex> _complexes = [];
  String? _highlightedId;
  bool _loading = true;
  String? _error;
  final bool _useNativeMap = AppEnvironmentConfig.useNativeGoogleMap;

  @override
  void initState() {
    super.initState();
    _loadComplexes();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadComplexes() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.fetchComplexes(
        district: _selectedDistrict,
        search: _searchCtrl.text,
      );
      if (!mounted) return;
      final parsed = data.map(SportsComplex.fromJson).toList();
      setState(() {
        _rawComplexes = data;
        _complexes = parsed;
        if (parsed.isNotEmpty && _highlightedId == null) {
          _highlightedId = parsed.first.id;
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Set<Marker> _buildMarkers() {
    return _complexes.map((c) {
      final raw = _rawComplexes.firstWhere((r) => r['id'] == c.id, orElse: () => <String, dynamic>{'id': c.id, 'name': c.name});
      return Marker(
        markerId: MarkerId(c.id),
        position: LatLng(c.lat, c.lng),
        infoWindow: InfoWindow(
          title: c.name,
          snippet: '${c.districtName} · ★ ${c.rating.toStringAsFixed(1)} · RUC ${c.ruc}',
          onTap: () => widget.onSelectComplex(raw),
        ),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      );
    }).toSet();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Buscador y botón de refresco
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchCtrl,
                  onSubmitted: (_) => _loadComplexes(),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'Buscar complejo o avenida en Arequipa...',
                    hintStyle: const TextStyle(color: PichangaTheme.textSecondary, fontSize: 13),
                    prefixIcon: const Icon(Icons.search, size: 18, color: PichangaTheme.turfGreen),
                    suffixIcon: _searchCtrl.text.isNotEmpty
                        ? IconButton(
                            onPressed: () {
                              _searchCtrl.clear();
                              _loadComplexes();
                            },
                            icon: const Icon(Icons.clear, size: 16),
                          )
                        : null,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                tooltip: 'Actualizar complejos',
                onPressed: _loadComplexes,
                icon: const Icon(Icons.refresh, size: 20),
              ),
            ],
          ),
        ),
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
                selectedColor: PichangaTheme.turfGreen,
                backgroundColor: PichangaTheme.bgSecondary,
                labelStyle: TextStyle(
                  color: selected ? PichangaTheme.bgPrimary : Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
                onSelected: (_) {
                  setState(() => _selectedDistrict = d['code']!);
                  _loadComplexes();
                },
              );
            },
          ),
        ),
        // Mapa interactivo de Arequipa (Canvas georreferenciado o SDK Google Maps)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SizedBox(
            height: 205,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(18),
              child: _useNativeMap
                  ? GoogleMap(
                      initialCameraPosition: _arequipaCenter,
                      markers: _buildMarkers(),
                      myLocationEnabled: false,
                      zoomControlsEnabled: false,
                    )
                  : _ArequipaInteractiveMapCanvas(
                      complexes: _complexes,
                      highlightedId: _highlightedId,
                      onPinTap: (complex) {
                        setState(() => _highlightedId = complex.id);
                      },
                      onOpenComplex: (complex) {
                        final raw = _rawComplexes.firstWhere(
                          (r) => r['id'] == complex.id,
                          orElse: () => <String, dynamic>{'id': complex.id, 'name': complex.name},
                        );
                        widget.onSelectComplex(raw);
                      },
                    ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        // Lista de complejos sintéticos verificados
        Expanded(
          child: _buildListSection(),
        ),
      ],
    );
  }

  Widget _buildListSection() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 40, color: PichangaTheme.dangerRed),
              const SizedBox(height: 10),
              Text(
                'No se pudieron cargar los complejos: $_error',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _loadComplexes,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }
    if (_complexes.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.sports_soccer, size: 40, color: Colors.white38),
            const SizedBox(height: 8),
            const Text(
              'No hay complejos verificados en este filtro.',
              style: TextStyle(color: Colors.white70),
            ),
            TextButton(
              onPressed: () {
                setState(() {
                  _selectedDistrict = 'ALL';
                  _searchCtrl.clear();
                });
                _loadComplexes();
              },
              child: const Text('Ver todos los distritos de Arequipa'),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _complexes.length,
      itemBuilder: (_, idx) {
        final c = _complexes[idx];
        final raw = _rawComplexes[idx];
        final isSelected = c.id == _highlightedId;
        return Card(
          color: isSelected ? PichangaTheme.bgElevated : PichangaTheme.bgSecondary,
          margin: const EdgeInsets.only(bottom: 10),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(
              color: isSelected ? PichangaTheme.turfGreen : PichangaTheme.borderSubtle,
              width: isSelected ? 1.4 : 1.0,
            ),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => widget.onSelectComplex(raw),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              c.name,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 15,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${c.districtName} · ${c.address}',
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: PichangaTheme.turfGreenDark,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: PichangaTheme.turfGreen),
                        ),
                        child: Text(
                          'S/ ${c.minPriceSoles}/h',
                          style: const TextStyle(
                            color: PichangaTheme.turfGreen,
                            fontWeight: FontWeight.w900,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: [
                      _MetaBadge(
                        icon: Icons.verified,
                        text: 'RUC ${c.ruc}',
                        color: PichangaTheme.turfGreen,
                      ),
                      _MetaBadge(
                        icon: Icons.star,
                        text: '${c.rating.toStringAsFixed(1)} (${c.reviewsCount})',
                        color: PichangaTheme.warningAmber,
                      ),
                      _MetaBadge(
                        icon: Icons.stadium,
                        text: '${c.courtsCount} canchas',
                        color: PichangaTheme.skyAccent,
                      ),
                      if (c.distanceKm != null)
                        _MetaBadge(
                          icon: Icons.near_me,
                          text: '${c.distanceKm!.toStringAsFixed(1)} km',
                          color: Colors.white70,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MetaBadge extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _MetaBadge({
    required this.icon,
    required this.text,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: PichangaTheme.bgPrimary.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            text,
            style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// Mapa georreferenciado interactivo de Arequipa (proyección lat/lng sobre los distritos de AQP).
class _ArequipaInteractiveMapCanvas extends StatelessWidget {
  final List<SportsComplex> complexes;
  final String? highlightedId;
  final void Function(SportsComplex) onPinTap;
  final void Function(SportsComplex) onOpenComplex;

  const _ArequipaInteractiveMapCanvas({
    required this.complexes,
    required this.highlightedId,
    required this.onPinTap,
    required this.onOpenComplex,
  });

  // Bounding box metropolitano de Arequipa
  static const double _minLat = -16.4400;
  static const double _maxLat = -16.3450;
  static const double _minLng = -71.5900;
  static const double _maxLng = -71.5050;

  Alignment _latLngToAlignment(double lat, double lng) {
    final normX = ((lng - _minLng) / (_maxLng - _minLng)).clamp(0.08, 0.92);
    final normY = (1.0 - ((lat - _minLat) / (_maxLat - _minLat))).clamp(0.12, 0.88);
    return Alignment(normX * 2 - 1, normY * 2 - 1);
  }

  @override
  Widget build(BuildContext context) {
    final selected = complexes.where((c) => c.id == highlightedId).firstOrNull ?? complexes.firstOrNull;
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0A192F), Color(0xFF0F2942), Color(0xFF0B1E33)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: PichangaTheme.borderSubtle),
      ),
      child: Stack(
        children: [
          // Etiquetas geográficas de referencia de Arequipa
          const Positioned(
            top: 10,
            left: 12,
            child: Row(
              children: [
                Icon(Icons.terrain, size: 15, color: PichangaTheme.skyAccent),
                SizedBox(width: 5),
                Text(
                  'Arequipa Metropolitana · GPS Haversine Activo',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white70),
                ),
              ],
            ),
          ),
          // Pines interactivos por coordenada real
          ...complexes.map((c) {
            final isHi = c.id == highlightedId;
            return Align(
              alignment: _latLngToAlignment(c.lat, c.lng),
              child: GestureDetector(
                onTap: () => onPinTap(c),
                onDoubleTap: () => onOpenComplex(c),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: isHi ? PichangaTheme.turfGreen : PichangaTheme.bgSecondary.withValues(alpha: 0.92),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: isHi ? Colors.white : PichangaTheme.turfGreen,
                      width: isHi ? 1.8 : 1.2,
                    ),
                    boxShadow: const [
                      BoxShadow(color: Colors.black54, blurRadius: 6, offset: Offset(0, 2)),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.sports_soccer,
                        size: 13,
                        color: isHi ? PichangaTheme.bgPrimary : PichangaTheme.turfGreen,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'S/ ${c.minPriceSoles}',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                          color: isHi ? PichangaTheme.bgPrimary : Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
          // Tarjeta flotante del complejo seleccionado en el mapa
          if (selected != null)
            Positioned(
              left: 10,
              right: 10,
              bottom: 8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: PichangaTheme.bgPrimary.withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: PichangaTheme.turfGreen.withValues(alpha: 0.6)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.location_on, color: PichangaTheme.turfGreen, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${selected.name} (${selected.districtName}) · ★ ${selected.rating.toStringAsFixed(1)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                      ),
                    ),
                    TextButton(
                      onPressed: () => onOpenComplex(selected),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Text(
                        'Ver canchas →',
                        style: TextStyle(color: PichangaTheme.turfGreen, fontWeight: FontWeight.w800, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
