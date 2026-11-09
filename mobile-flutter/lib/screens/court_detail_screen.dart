import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';

/// Vista 2: Detalle de Complejo, Selector de Cancha, Parrilla Horaria en Tiempo Real,
/// Creación de Reserva (Adelanto 50% o Split Payment) y Reseñas de la Comunidad.
class CourtDetailScreen extends StatefulWidget {
  final RealtimeApiService api;
  final String complexId;
  final String courtId;
  final String complexName;
  final void Function(String shareToken)? onOpenSplitToken;

  const CourtDetailScreen({
    super.key,
    required this.api,
    required this.courtId,
    required this.complexName,
    this.complexId = '00000000-0000-4000-b000-00000000c001',
    this.onOpenSplitToken,
  });

  @override
  State<CourtDetailScreen> createState() => _CourtDetailScreenState();
}

class _CourtDetailScreenState extends State<CourtDetailScreen> {
  late String _activeCourtId;
  String? _selectedDate;
  String _baseLimaDate = '';
  List<CourtSummary> _courts = [];
  List<TimeSlot> _slots = [];
  List<ReviewItem> _reviews = [];
  List<String> _amenities = [];
  String _ruc = '';
  String _address = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _activeCourtId = widget.courtId;
    _loadData();
  }

  @override
  void didUpdateWidget(covariant CourtDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.complexId != widget.complexId || oldWidget.courtId != widget.courtId) {
      _activeCourtId = widget.courtId;
      _loadData();
    }
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Intentamos cargar el detalle completo del complejo y la disponibilidad de la cancha activa.
      Map<String, dynamic>? complexData;
      try {
        complexData = await widget.api.fetchComplexDetail(widget.complexId, date: _selectedDate);
      } catch (_) {
        complexData = null;
      }

      if (complexData != null && complexData['courts'] is List) {
        final rawCourts = complexData['courts'] as List<dynamic>;
        _courts = rawCourts
            .map((c) => CourtSummary.fromJson(Map<String, dynamic>.from(c as Map)))
            .toList();
        if (_courts.isNotEmpty && !_courts.any((c) => c.id == _activeCourtId)) {
          _activeCourtId = _courts.first.id;
        }
        _amenities = (complexData['amenities'] as List?)?.map((e) => e.toString()).toList() ?? [];
        _ruc = (complexData['ruc'] ?? '').toString();
        _address = (complexData['address'] ?? '').toString();
        _reviews = (complexData['reviews'] as List?)
                ?.map((r) => ReviewItem.fromJson(Map<String, dynamic>.from(r as Map)))
                .toList() ??
            [];
      }

      final avail = await widget.api.fetchCourtAvailability(_activeCourtId, date: _selectedDate);
      if (!mounted) return;
      final dateStr = (avail['date'] ?? '').toString();
      if (_baseLimaDate.isEmpty && dateStr.isNotEmpty) {
        _baseLimaDate = dateStr;
      }
      _selectedDate ??= dateStr;
      final allSlots = (avail['slots'] as List<dynamic>)
          .map((s) => TimeSlot.fromJson(Map<String, dynamic>.from(s as Map)))
          .where((s) => s.hour >= 15)
          .toList();

      setState(() {
        _slots = allSlots;
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

  List<Map<String, String>> _buildDateOptions() {
    final base = DateTime.tryParse(_baseLimaDate) ?? DateTime.now();
    return List.generate(3, (offset) {
      final d = base.add(Duration(days: offset));
      final iso =
          '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      final label = offset == 0
          ? 'Hoy ($iso)'
          : offset == 1
              ? 'Mañana ($iso)'
              : 'Pasado ($iso)';
      return {'date': iso, 'label': label};
    });
  }

  Future<void> _onSlotTap(TimeSlot slot) async {
    if (slot.status == 'HELD' && slot.shareToken != null && widget.onOpenSplitToken != null) {
      widget.onOpenSplitToken!(slot.shareToken!);
      return;
    }
    if (slot.status != 'FREE') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: PichangaTheme.bgElevated,
          content: Text(
            'El horario ${slot.label} no está disponible (${slot.status} · ${slot.channel ?? 'RECEPCIÓN'}).',
            style: const TextStyle(color: Colors.white),
          ),
        ),
      );
      return;
    }

    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: PichangaTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _BookingCheckoutSheet(
        api: widget.api,
        courtId: _activeCourtId,
        complexName: widget.complexName,
        slot: slot,
      ),
    );

    if (result != null && mounted) {
      await _loadData();
      if (!mounted) return;
      final split = result['splitPayment'] as Map<String, dynamic>?;
      final shareToken = split?['shareToken']?.toString();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: PichangaTheme.turfGreenDark,
          content: Text(
            shareToken != null
                ? '¡Reserva en espera creada! Link Split: $shareToken'
                : '¡Reserva confirmada para las ${slot.label}!',
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
          ),
          action: shareToken != null && widget.onOpenSplitToken != null
              ? SnackBarAction(
                  label: 'Ver Split',
                  textColor: PichangaTheme.turfGreen,
                  onPressed: () => widget.onOpenSplitToken!(shareToken),
                )
              : null,
        ),
      );
    }
  }

  Future<void> _openAddReviewDialog() async {
    int selectedRating = 5;
    final commentCtrl = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: PichangaTheme.bgSecondary,
          title: const Text('Calificar Complejo Deportivo'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (index) {
                  final star = index + 1;
                  return IconButton(
                    onPressed: () => setDialogState(() => selectedRating = star),
                    icon: Icon(
                      star <= selectedRating ? Icons.star : Icons.star_border,
                      color: PichangaTheme.warningAmber,
                    ),
                  );
                }),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: commentCtrl,
                maxLines: 3,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  hintText: '¿Qué tal estuvo el grass sintético, iluminación y puntualidad?',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () async {
                if (commentCtrl.text.trim().length < 4) return;
                try {
                  await widget.api.postReview(
                    complexId: widget.complexId,
                    rating: selectedRating,
                    comment: commentCtrl.text.trim(),
                  );
                  if (ctx.mounted) Navigator.of(ctx).pop(true);
                } catch (e) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      SnackBar(content: Text(e.toString())),
                    );
                  }
                }
              },
              child: const Text('Publicar Reseña'),
            ),
          ],
        ),
      ),
    );
    commentCtrl.dispose();
    if (submitted == true) {
      await _loadData();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 42, color: PichangaTheme.dangerRed),
              const SizedBox(height: 10),
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _loadData,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );
    }

    final dateOptions = _buildDateOptions();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Encabezado del complejo
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.complexName,
                    style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: Colors.white),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Parrilla en vivo (${_selectedDate ?? _baseLimaDate}) · Sincronizada con Recepción',
                    style: const TextStyle(fontSize: 12, color: Colors.white70),
                  ),
                  if (_address.isNotEmpty || _ruc.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      '$_address ${_ruc.isNotEmpty ? "· RUC $_ruc Verificado" : ""}',
                      style: const TextStyle(fontSize: 11, color: PichangaTheme.turfGreen),
                    ),
                  ],
                ],
              ),
            ),
            IconButton.filledTonal(
              tooltip: 'Refrescar parrilla',
              onPressed: _loadData,
              icon: const Icon(Icons.sync, size: 18),
            ),
          ],
        ),
        if (_amenities.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: _amenities
                .map(
                  (a) => Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: PichangaTheme.bgElevated,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(a, style: const TextStyle(fontSize: 11, color: Colors.white70)),
                  ),
                )
                .toList(),
          ),
        ],
        const SizedBox(height: 12),
        // Selector de cancha
        if (_courts.isNotEmpty) ...[
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _courts.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, idx) {
                final c = _courts[idx];
                final selected = c.id == _activeCourtId;
                return ChoiceChip(
                  label: Text('${c.name} (F${c.playersPerSide})'),
                  selected: selected,
                  selectedColor: PichangaTheme.turfGreen,
                  labelStyle: TextStyle(
                    color: selected ? PichangaTheme.bgPrimary : Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                  onSelected: (_) {
                    setState(() => _activeCourtId = c.id);
                    _loadData();
                  },
                );
              },
            ),
          ),
          const SizedBox(height: 10),
        ],
        // Selector de fecha
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: dateOptions.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, idx) {
              final opt = dateOptions[idx];
              final isSel = opt['date'] == (_selectedDate ?? _baseLimaDate);
              return OutlinedButton(
                style: OutlinedButton.styleFrom(
                  backgroundColor: isSel ? PichangaTheme.bgElevated : Colors.transparent,
                  side: BorderSide(color: isSel ? PichangaTheme.skyAccent : PichangaTheme.borderSubtle),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                onPressed: () {
                  setState(() => _selectedDate = opt['date']);
                  _loadData();
                },
                child: Text(
                  opt['label']!,
                  style: TextStyle(
                    fontSize: 11,
                    color: isSel ? PichangaTheme.skyAccent : Colors.white70,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 14),
        // Parrilla de horarios
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.22,
          ),
          itemCount: _slots.length,
          itemBuilder: (_, idx) {
            final s = _slots[idx];
            final isFree = s.status == 'FREE';
            final isSplit = s.status == 'HELD';
            final bg = isFree
                ? PichangaTheme.turfGreenDark
                : isSplit
                    ? const Color(0xFF0C4A6E)
                    : const Color(0xFF1E293B);
            final borderColor = isFree
                ? PichangaTheme.turfGreen
                : isSplit
                    ? PichangaTheme.skyAccent
                    : Colors.white24;
            return InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () => _onSlotTap(s),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: borderColor, width: isFree ? 1.4 : 1.0),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Flexible(
                          child: Text(
                            s.label,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            'S/ ${s.priceSoles}',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: isFree ? PichangaTheme.turfGreen : Colors.white70,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    Text(
                      isFree
                          ? 'Disponible · Reservar'
                          : isSplit
                              ? 'Split ${s.splitPaid ?? 1}/${s.splitTotal ?? 6}'
                              : 'Ocupado (${s.channel ?? 'RECEP'})',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, color: Colors.white70, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 22),
        // Reseñas de la comunidad
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Expanded(
              child: Text(
                'Reseñas de la Comunidad',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
              ),
            ),
            TextButton.icon(
              onPressed: _openAddReviewDialog,
              icon: const Icon(Icons.rate_review_outlined, size: 16, color: PichangaTheme.turfGreen),
              label: const Text('Calificar', style: TextStyle(color: PichangaTheme.turfGreen, fontSize: 12)),
            ),
          ],
        ),
        if (_reviews.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Sé el primero en calificar este complejo.', style: TextStyle(color: Colors.white54, fontSize: 12)),
          )
        else
          ..._reviews.take(4).map(
                (r) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    dense: true,
                    title: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            r.authorName,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                        ),
                        Text(
                          '★' * r.rating,
                          style: const TextStyle(color: PichangaTheme.warningAmber, fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    subtitle: Text(r.comment, style: const TextStyle(color: Colors.white70, fontSize: 12)),
                  ),
                ),
              ),
      ],
    );
  }
}

class _BookingCheckoutSheet extends StatefulWidget {
  final RealtimeApiService api;
  final String courtId;
  final String complexName;
  final TimeSlot slot;

  const _BookingCheckoutSheet({
    required this.api,
    required this.courtId,
    required this.complexName,
    required this.slot,
  });

  @override
  State<_BookingCheckoutSheet> createState() => _BookingCheckoutSheetState();
}

class _BookingCheckoutSheetState extends State<_BookingCheckoutSheet> {
  String _paymentMode = 'SPLIT'; // FULL_DEPOSIT | SPLIT
  String _method = 'YAPE'; // YAPE | PLIN | CARD
  int _totalSlots = 6;
  String _sandboxScenario = 'APPROVED'; // APPROVED | PENDING | DECLINED
  final TextEditingController _notesCtrl = TextEditingController(text: 'Pichanga nocturna Arequipa');
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  String _buildSourceId() {
    final prefix = _method == 'CARD' ? 'tok' : _method == 'PLIN' ? 'pln' : 'ype';
    if (_sandboxScenario == 'DECLINED') {
      return '${prefix}_test_declined_card';
    }
    if (_sandboxScenario == 'PENDING') {
      return '${prefix}_test_pending_wallet';
    }
    return '${prefix}_sandbox_${DateTime.now().millisecondsSinceEpoch}';
  }

  Future<void> _submitBooking() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final res = await widget.api.createBooking(
        courtId: widget.courtId,
        date: widget.slot.date,
        hour: widget.slot.hour,
        paymentMode: _paymentMode,
        method: _method,
        sourceId: _buildSourceId(),
        totalSlots: _totalSlots,
        notes: _notesCtrl.text,
      );
      if (!mounted) return;
      Navigator.of(context).pop(res);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final totalSoles = widget.slot.priceCents / 100.0;
    final payNowSoles = _paymentMode == 'FULL_DEPOSIT'
        ? (totalSoles / 2).toStringAsFixed(2)
        : (totalSoles / _totalSlots).toStringAsFixed(2);

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Reservar ${widget.complexName}',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white),
            ),
            const SizedBox(height: 4),
            Text(
              'Fecha: ${widget.slot.date} · Turno: ${widget.slot.label} · Tarifa: S/ ${totalSoles.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 12, color: PichangaTheme.skyAccent, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 14),
            const Text('1. Modalidad de Pago', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Text('Split entre amigos'),
                    selected: _paymentMode == 'SPLIT',
                    selectedColor: PichangaTheme.turfGreen,
                    labelStyle: TextStyle(
                      color: _paymentMode == 'SPLIT' ? PichangaTheme.bgPrimary : Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                    onSelected: (_) => setState(() => _paymentMode = 'SPLIT'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ChoiceChip(
                    label: const Text('Adelanto 50%'),
                    selected: _paymentMode == 'FULL_DEPOSIT',
                    selectedColor: PichangaTheme.turfGreen,
                    labelStyle: TextStyle(
                      color: _paymentMode == 'FULL_DEPOSIT' ? PichangaTheme.bgPrimary : Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                    onSelected: (_) => setState(() => _paymentMode = 'FULL_DEPOSIT'),
                  ),
                ),
              ],
            ),
            if (_paymentMode == 'SPLIT') ...[
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Dividir entre jugadores:', style: TextStyle(fontSize: 12, color: Colors.white70)),
                  DropdownButton<int>(
                    value: _totalSlots,
                    dropdownColor: PichangaTheme.bgElevated,
                    items: const [4, 6, 8, 10, 12]
                        .map((n) => DropdownMenuItem(value: n, child: Text('$n cupos (S/ ${(totalSoles / n).toStringAsFixed(2)} c/u)')))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _totalSlots = v);
                    },
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            const Text('2. Billetera / Pasarela Culqi', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: ['YAPE', 'PLIN', 'CARD'].map((m) {
                final sel = _method == m;
                return ChoiceChip(
                  label: Text(m == 'CARD' ? 'Tarjeta' : m),
                  selected: sel,
                  selectedColor: m == 'YAPE' ? PichangaTheme.yapePurple : PichangaTheme.skyAccent,
                  labelStyle: TextStyle(
                    color: sel ? Colors.white : Colors.white70,
                    fontWeight: FontWeight.bold,
                  ),
                  onSelected: (_) => setState(() => _method = m),
                );
              }).toList(),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _sandboxScenario,
              isExpanded: true,
              dropdownColor: PichangaTheme.bgElevated,
              decoration: const InputDecoration(
                labelText: 'Token Culqi Sandbox (Simulación de Cargo)',
                prefixIcon: Icon(Icons.security, size: 18),
              ),
              items: const [
                DropdownMenuItem(value: 'APPROVED', child: Text('Token Aprobado (ype_sandbox_*)')),
                DropdownMenuItem(value: 'PENDING', child: Text('Token en Revisión (ype_test_pending)')),
                DropdownMenuItem(value: 'DECLINED', child: Text('Token Fondos Insuficientes (tok_test_declined)')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _sandboxScenario = v);
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _notesCtrl,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(
                labelText: 'Nota de la pichanga (opcional)',
                prefixIcon: Icon(Icons.notes, size: 18),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: PichangaTheme.dangerRed.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: PichangaTheme.dangerRed),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(color: PichangaTheme.dangerRed, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _submitting ? null : _submitBooking,
                icon: const Icon(Icons.bolt),
                label: Text(
                  _submitting
                      ? 'Procesando cobro...'
                      : 'Pagar S/ $payNowSoles y ${_paymentMode == 'SPLIT' ? 'Generar Link Split' : 'Confirmar Cancha'}',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
