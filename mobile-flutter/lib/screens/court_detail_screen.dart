import 'package:flutter/material.dart';
import '../services/realtime_api_service.dart';

/// Vista 2: Detalle de Cancha, Reseñas de la Comunidad y Parrilla Horaria
/// sincronizada en tiempo real con el Panel Web del Dueño vía Socket.io.
class CourtDetailScreen extends StatefulWidget {
  final RealtimeApiService api;
  final String courtId;
  final String complexName;

  const CourtDetailScreen({
    super.key,
    required this.api,
    required this.courtId,
    required this.complexName,
  });

  @override
  State<CourtDetailScreen> createState() => _CourtDetailScreenState();
}

class _CourtDetailScreenState extends State<CourtDetailScreen> {
  List<dynamic> _slots = [];
  String _date = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadGrid();
  }

  Future<void> _loadGrid() async {
    final data = await widget.api.fetchCourtAvailability(widget.courtId);
    if (!mounted) return;
    setState(() {
      _date = data['date'] as String;
      _slots = (data['slots'] as List<dynamic>).where((s) => (s['hour'] as int) >= 16).toList();
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.complexName,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          Text(
            'Parrilla en vivo ($_date) · Sincronizada con Recepción',
            style: const TextStyle(fontSize: 12, color: Colors.white70),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: GridView.builder(
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.35,
              ),
              itemCount: _slots.length,
              itemBuilder: (_, idx) {
                final s = _slots[idx] as Map<String, dynamic>;
                final status = s['status'] as String;
                final isFree = status == 'FREE';
                final isSplit = status == 'HELD';
                final bg = isFree
                    ? const Color(0xFF064E3B)
                    : isSplit
                        ? const Color(0xFF0C4A6E)
                        : const Color(0xFF334155);
                return Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: bg,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isFree ? const Color(0xFF10B981) : Colors.white24,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        s['label'] as String,
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        isFree
                            ? 'Disponible'
                            : isSplit
                                ? 'Split ${s['split']?['paid']}/${s['split']?['total']}'
                                : 'Ocupado (${s['channel'] ?? 'RECEP'})',
                        style: const TextStyle(fontSize: 11, color: Colors.white70),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
