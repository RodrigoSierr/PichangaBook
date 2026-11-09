import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../models/models.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';

/// Vista 4: Bolsa de Suplentes Verificados (Core del Pivote).
/// Incluye filtros por posición y distrito, minirreproductor de clips (15 a 30 s),
/// convocatoria directa y Chat / VoIP interno con enmascaramiento antifraude.
class SubstitutesPoolScreen extends StatefulWidget {
  final RealtimeApiService api;

  const SubstitutesPoolScreen({super.key, required this.api});

  @override
  State<SubstitutesPoolScreen> createState() => _SubstitutesPoolScreenState();
}

class _SubstitutesPoolScreenState extends State<SubstitutesPoolScreen> {
  final List<Map<String, String>> _positions = const [
    {'code': 'ALL', 'label': 'Todos'},
    {'code': 'ARQUERO', 'label': 'Arqueros'},
    {'code': 'DEFENSA', 'label': 'Defensas'},
    {'code': 'MEDIOCAMPO', 'label': 'Mediocampo'},
    {'code': 'DELANTERO', 'label': 'Delanteros'},
  ];

  String _selectedPosition = 'ALL';
  String _selectedDistrict = 'ALL';
  List<SubstituteProfile> _subs = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await widget.api.fetchSubstitutes(
        position: _selectedPosition,
        district: _selectedDistrict,
      );
      if (!mounted) return;
      setState(() {
        _subs = list.map(SubstituteProfile.fromJson).toList();
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

  Future<void> _inviteAndOpenRelay(SubstituteProfile sub) async {
    List<BookingRecord> activeBookings = [];
    try {
      final allBookings = await widget.api.fetchMyBookings();
      activeBookings = allBookings
          .where((b) => b.status == 'HELD' || b.status == 'CONFIRMED')
          .toList();
    } catch (_) {}

    if (!mounted) return;
    if (activeBookings.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Necesitas una reserva activa (HELD o CONFIRMED) propia para convocar a un suplente.'),
        ),
      );
      return;
    }

    String selectedBookingId = activeBookings.first.id;
    final msgCtrl = TextEditingController(
      text: 'Hola ${sub.fullName}, nos falta un ${sub.position.toLowerCase()} hoy a las ${activeBookings.first.hourLabel} en ${activeBookings.first.districtName}. ¿Llegas?',
    );
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: PichangaTheme.bgSecondary,
          title: Text('Convocar a ${sub.fullName}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Canal antifraude activo: teléfonos y correos se ocultan automáticamente (${sub.phoneMasked}).',
                style: const TextStyle(fontSize: 12, color: PichangaTheme.skyAccent),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: selectedBookingId,
                isExpanded: true,
                dropdownColor: PichangaTheme.bgElevated,
                decoration: const InputDecoration(
                  labelText: 'Reserva activa asociada',
                ),
                items: activeBookings
                    .map(
                      (b) => DropdownMenuItem(
                        value: b.id,
                        child: Text(
                          '${b.complexName} · ${b.date} ${b.hourLabel} (${b.status})',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: (v) {
                  if (v != null) {
                    setDialogState(() => selectedBookingId = v);
                  }
                },
              ),
              const SizedBox(height: 10),
              TextField(
                controller: msgCtrl,
                maxLines: 3,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Mensaje inicial de convocatoria',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar'),
            ),
            ElevatedButton.icon(
              onPressed: () => Navigator.of(ctx).pop({
                'bookingId': selectedBookingId,
                'message': msgCtrl.text.trim(),
              }),
              icon: const Icon(Icons.send, size: 16),
              label: const Text('Abrir Chat Seguro'),
            ),
          ],
        ),
      ),
    );
    msgCtrl.dispose();
    if (result == null || (result['message'] ?? '').isEmpty || !mounted) return;

    try {
      final res = await widget.api.inviteSubstitute(
        profileId: sub.id,
        bookingId: result['bookingId']!,
        message: result['message']!,
      );
      if (!mounted) return;
      final relay = Map<String, dynamic>.from(res['relay'] as Map);
      final initialMessages = (res['messages'] as List<dynamic>)
          .map((m) => RelayMessageItem.fromJson(Map<String, dynamic>.from(m as Map)))
          .toList();

      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: PichangaTheme.bgSecondary,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
        builder: (_) => MaskedRelayChatSheet(
          api: widget.api,
          relayId: relay['id'].toString(),
          proxyNumber: (relay['proxyNumber'] ?? '+51 (054) 6470-000').toString(),
          substituteName: sub.fullName,
          initialMessages: initialMessages,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al convocar suplente: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Filtro por posición
        SizedBox(
          height: 48,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            scrollDirection: Axis.horizontal,
            itemCount: _positions.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, idx) {
              final p = _positions[idx];
              final sel = p['code'] == _selectedPosition;
              return ChoiceChip(
                label: Text(p['label']!),
                selected: sel,
                selectedColor: PichangaTheme.turfGreen,
                labelStyle: TextStyle(
                  color: sel ? PichangaTheme.bgPrimary : Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                ),
                onSelected: (_) {
                  setState(() => _selectedPosition = p['code']!);
                  _load();
                },
              );
            },
          ),
        ),
        // Filtro rápido de distrito
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              const Icon(Icons.shield_outlined, size: 16, color: PichangaTheme.turfGreen),
              const SizedBox(width: 6),
              const Expanded(
                child: Text(
                  'Clips verificados de 15-30s · Teléfonos protegidos por Relay',
                  style: TextStyle(fontSize: 11, color: Colors.white70),
                ),
              ),
              DropdownButton<String>(
                value: _selectedDistrict,
                dropdownColor: PichangaTheme.bgElevated,
                underline: const SizedBox.shrink(),
                style: const TextStyle(fontSize: 12, color: PichangaTheme.skyAccent, fontWeight: FontWeight.bold),
                items: const [
                  DropdownMenuItem(value: 'ALL', child: Text('Todos AQP')),
                  DropdownMenuItem(value: 'CAYMA', child: Text('Cayma')),
                  DropdownMenuItem(value: 'YANAHUARA', child: Text('Yanahuara')),
                  DropdownMenuItem(value: 'CERRO_COLORADO', child: Text('Cerro Colorado')),
                  DropdownMenuItem(value: 'JLBYR', child: Text('J.L. Bustamante')),
                  DropdownMenuItem(value: 'SACHACA', child: Text('Sachaca')),
                ],
                onChanged: (v) {
                  if (v != null) {
                    setState(() => _selectedDistrict = v);
                    _load();
                  }
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: Colors.white70)),
                          const SizedBox(height: 8),
                          ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
                        ],
                      ),
                    )
                  : _subs.isEmpty
                      ? const Center(
                          child: Text(
                            'No hay suplentes disponibles para este filtro.',
                            style: TextStyle(color: Colors.white70),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _subs.length,
                          itemBuilder: (_, idx) {
                            final s = _subs[idx];
                            return Card(
                              color: PichangaTheme.bgSecondary,
                              margin: const EdgeInsets.only(bottom: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(18),
                                side: const BorderSide(color: PichangaTheme.borderSubtle),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    SubstituteClipPlayer(
                                      videoUrl: '${widget.api.baseUrl}${s.clipUrl}',
                                      durationSeconds: s.clipDurationS,
                                      positionLabel: s.position,
                                    ),
                                    const SizedBox(height: 10),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${s.fullName} · ${s.position}',
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.w800,
                                              fontSize: 15,
                                            ),
                                          ),
                                        ),
                                        Text(
                                          '${s.punctualityScore.toStringAsFixed(1)}% Puntualidad',
                                          style: const TextStyle(
                                            color: PichangaTheme.turfGreen,
                                            fontWeight: FontWeight.w800,
                                            fontSize: 12,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${s.districtName} · Nivel ${"★" * s.skillLevel} · ${s.matchesPlayed} partidos (${s.noShows} faltas)',
                                      style: const TextStyle(color: PichangaTheme.warningAmber, fontSize: 11),
                                    ),
                                    if (s.bio.isNotEmpty) ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        s.bio,
                                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                                      ),
                                    ],
                                    const SizedBox(height: 6),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            'Contacto protegido: ${s.phoneMasked} (Chat / VoIP Interno)',
                                            style: const TextStyle(color: Colors.white60, fontSize: 11),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        ElevatedButton.icon(
                                          onPressed: () => _inviteAndOpenRelay(s),
                                          style: ElevatedButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            minimumSize: const Size(44, 38),
                                          ),
                                          icon: const Icon(Icons.lock_outline, size: 15),
                                          label: const Text('Convocar', style: TextStyle(fontSize: 12)),
                                        ),
                                      ],
                                    ),
                                  ],
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

class SubstituteClipPlayer extends StatefulWidget {
  final String videoUrl;
  final int durationSeconds;
  final String positionLabel;

  const SubstituteClipPlayer({
    super.key,
    required this.videoUrl,
    required this.durationSeconds,
    this.positionLabel = 'SUPLENTE',
  });

  @override
  State<SubstituteClipPlayer> createState() => _SubstituteClipPlayerState();
}

class _SubstituteClipPlayerState extends State<SubstituteClipPlayer> {
  VideoPlayerController? _controller;
  bool _initialized = false;
  bool _simulatedPlaying = false;
  bool _muted = true;

  @override
  void initState() {
    super.initState();
    _initController();
  }

  Future<void> _initController() async {
    try {
      final ctrl = VideoPlayerController.networkUrl(Uri.parse(widget.videoUrl));
      _controller = ctrl;
      await ctrl.initialize();
      await ctrl.setVolume(0);
      if (mounted) {
        setState(() => _initialized = true);
      }
    } catch (_) {
      // En entorno de pruebas sin codec nativo se usa el reproductor visual de respaldo.
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _togglePlay() {
    final ctrl = _controller;
    if (_initialized && ctrl != null) {
      setState(() {
        ctrl.value.isPlaying ? ctrl.pause() : ctrl.play();
      });
    } else {
      setState(() => _simulatedPlaying = !_simulatedPlaying);
    }
  }

  void _toggleMute() {
    final ctrl = _controller;
    setState(() {
      _muted = !_muted;
      if (_initialized && ctrl != null) {
        ctrl.setVolume(_muted ? 0.0 : 1.0);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final isPlaying = (_initialized && _controller != null) ? _controller!.value.isPlaying : _simulatedPlaying;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        alignment: Alignment.bottomLeft,
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: _initialized && _controller != null
                ? VideoPlayer(_controller!)
                : Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFF0F172A), Color(0xFF064E3B), Color(0xFF0B111E)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            isPlaying ? Icons.motion_photos_on : Icons.sports_soccer,
                            size: 38,
                            color: PichangaTheme.turfGreen,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            isPlaying
                                ? 'Reproduciendo highlight verificado (${widget.durationSeconds}s)...'
                                : 'Highlight Técnico · ${widget.positionLabel} (${widget.durationSeconds}s)',
                            style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                    ),
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                ElevatedButton.icon(
                  onPressed: _togglePlay,
                  style: ElevatedButton.styleFrom(
                    minimumSize: const Size(44, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  ),
                  icon: Icon(isPlaying ? Icons.pause : Icons.play_arrow, size: 18),
                  label: Text('Clip ${widget.durationSeconds}s'),
                ),
                IconButton.filledTonal(
                  tooltip: _muted ? 'Activar audio' : 'Silenciar clip',
                  onPressed: _toggleMute,
                  icon: Icon(_muted ? Icons.volume_off : Icons.volume_up, size: 18),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Hoja de Chat / VoIP interno con enmascaramiento antifraude en vivo.
class MaskedRelayChatSheet extends StatefulWidget {
  final RealtimeApiService api;
  final String relayId;
  final String proxyNumber;
  final String substituteName;
  final List<RelayMessageItem> initialMessages;

  const MaskedRelayChatSheet({
    super.key,
    required this.api,
    required this.relayId,
    required this.proxyNumber,
    required this.substituteName,
    required this.initialMessages,
  });

  @override
  State<MaskedRelayChatSheet> createState() => _MaskedRelayChatSheetState();
}

class _MaskedRelayChatSheetState extends State<MaskedRelayChatSheet> {
  final TextEditingController _msgCtrl = TextEditingController();
  late List<RelayMessageItem> _messages;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _messages = List.of(widget.initialMessages);
    widget.api.joinRelayRoom(widget.relayId);
  }

  @override
  void dispose() {
    _msgCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      final res = await widget.api.sendRelayMessage(relayId: widget.relayId, text: text);
      if (!mounted) return;
      _msgCtrl.clear();
      setState(() {
        _messages.add(RelayMessageItem.fromJson(res));
        _sending = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error enviando mensaje: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SizedBox(
        height: 440,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.security, color: PichangaTheme.turfGreen),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Relay Seguro · ${widget.substituteName}',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white),
                      ),
                      Text(
                        'Proxy VoIP: ${widget.proxyNumber} · Antifraude activo',
                        style: const TextStyle(fontSize: 11, color: PichangaTheme.skyAccent),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const Divider(color: PichangaTheme.borderSubtle),
            Expanded(
              child: ListView.builder(
                itemCount: _messages.length,
                itemBuilder: (_, idx) {
                  final m = _messages[idx];
                  return Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: PichangaTheme.bgElevated,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: m.redacted ? PichangaTheme.warningAmber : PichangaTheme.borderSubtle,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              m.senderName,
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: PichangaTheme.turfGreen,
                              ),
                            ),
                            if (m.redacted)
                              const Text(
                                'Dato sensible ocultado 🔒',
                                style: TextStyle(fontSize: 10, color: PichangaTheme.warningAmber),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(m.body, style: const TextStyle(color: Colors.white, fontSize: 13)),
                      ],
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _msgCtrl,
                    onSubmitted: (_) => _sendMessage(),
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                    decoration: const InputDecoration(
                      hintText: 'Escribe aquí (números/correos se enmascaran)...',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  style: IconButton.styleFrom(backgroundColor: PichangaTheme.turfGreen),
                  onPressed: _sending ? null : _sendMessage,
                  icon: const Icon(Icons.send, color: PichangaTheme.bgPrimary),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
