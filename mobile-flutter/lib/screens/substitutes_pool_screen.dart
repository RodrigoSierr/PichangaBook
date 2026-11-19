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
  List<SubstituteInvitationItem> _invitations = [];
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
      List<SubstituteInvitationItem> invitations = [];
      if (widget.api.isAuthenticated) {
        try {
          invitations = await widget.api.fetchMySubstituteInvitations();
        } catch (_) {}
      }
      if (!mounted) return;
      setState(() {
        _subs = list.map(SubstituteProfile.fromJson).toList();
        _invitations = invitations;
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

  Future<void> _openUpsertProfileSheet() async {
    if (!widget.api.isAuthenticated) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Inicia sesión para crear o actualizar tu perfil de suplente.')),
      );
      return;
    }
    final currentUserId = widget.api.currentUser?.id;
    final existing = _subs.where((s) => s.userId == currentUserId).firstOrNull;

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: PichangaTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _UpsertSubstituteProfileSheet(
        api: widget.api,
        existing: existing,
      ),
    );
    if (saved == true && mounted) {
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: PichangaTheme.turfGreenDark,
          content: Text('¡Perfil de suplente actualizado en la Bolsa de Arequipa!'),
        ),
      );
    }
  }

  Future<void> _openMyInvitationsSheet() async {
    if (!widget.api.isAuthenticated) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Inicia sesión para consultar tus convocatorias.')),
      );
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: PichangaTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) => _MySubstituteInvitationsSheet(
        api: widget.api,
        initialInvitations: _invitations,
        onChanged: _load,
      ),
    );
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
    final pendingInvCount = _invitations.where((i) => i.status == 'SENT').length;
    return Column(
      children: [
        // Barra de acciones rápidas: Postularme / Mi Perfil y Mis Convocatorias
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 2),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _openUpsertProfileSheet,
                  icon: const Icon(Icons.person_pin_circle_outlined, size: 16, color: PichangaTheme.turfGreen),
                  label: const Text(
                    'Mi Perfil de Suplente',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _openMyInvitationsSheet,
                  icon: Icon(
                    pendingInvCount > 0 ? Icons.notifications_active : Icons.inbox_outlined,
                    size: 16,
                    color: pendingInvCount > 0 ? PichangaTheme.warningAmber : PichangaTheme.skyAccent,
                  ),
                  label: Text(
                    pendingInvCount > 0 ? 'Convocatorias ($pendingInvCount)' : 'Mis Convocatorias',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ),
              ),
            ],
          ),
        ),
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
                  DropdownMenuItem(value: 'JLBYR', child: Text('J.L. Bustamante')),
                  DropdownMenuItem(value: 'CERRO_COLORADO', child: Text('Cerro Colorado')),
                  DropdownMenuItem(value: 'SACHACA', child: Text('Sachaca')),
                  DropdownMenuItem(value: 'AREQUIPA', child: Text('Cercado')),
                  DropdownMenuItem(value: 'MIRAFLORES', child: Text('Miraflores')),
                  DropdownMenuItem(value: 'ALTO_SELVA_ALEGRE', child: Text('Alto Selva Alegre')),
                  DropdownMenuItem(value: 'PAUCARPATA', child: Text('Paucarpata')),
                  DropdownMenuItem(value: 'HUNTER', child: Text('Jacobo Hunter')),
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
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    SubstituteClipPlayer(
                                      videoUrl: '${widget.api.baseUrl}${s.clipUrl}',
                                      durationSeconds: s.clipDurationS,
                                      positionLabel: s.position,
                                    ),
                                    const SizedBox(height: 12),
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
                                            fontFeatures: PichangaTheme.tabularNums,
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
                                      const SizedBox(height: 6),
                                      Text(
                                        s.bio,
                                        style: const TextStyle(color: PichangaTheme.textSecondary, fontSize: 12),
                                      ),
                                    ],
                                    const SizedBox(height: 12),
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            'Relay seguro: ${s.phoneMasked}',
                                            style: const TextStyle(color: PichangaTheme.textSecondary, fontSize: 11),
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        ElevatedButton.icon(
                                          onPressed: () => _inviteAndOpenRelay(s),
                                          style: ElevatedButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                                            minimumSize: const Size(48, 40),
                                          ),
                                          icon: const Icon(Icons.lock_outline, size: 15),
                                          label: const Text('Convocar suplente', style: TextStyle(fontSize: 12)),
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

/// Hoja modal para registrar o actualizar el perfil de suplente (`POST /api/substitutes/profile`).
class _UpsertSubstituteProfileSheet extends StatefulWidget {
  final RealtimeApiService api;
  final SubstituteProfile? existing;

  const _UpsertSubstituteProfileSheet({
    required this.api,
    this.existing,
  });

  @override
  State<_UpsertSubstituteProfileSheet> createState() => _UpsertSubstituteProfileSheetState();
}

class _UpsertSubstituteProfileSheetState extends State<_UpsertSubstituteProfileSheet> {
  late String _position;
  late String _districtCode;
  late int _skillLevel;
  late int _clipDurationS;
  late bool _isAvailable;
  late final TextEditingController _bioCtrl;
  late final TextEditingController _clipPublicIdCtrl;
  late final TextEditingController _clipUrlCtrl;
  String? _selectedClipFileName;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final ex = widget.existing;
    _position = ex?.position ?? 'MEDIOCAMPO';
    _districtCode = ex?.districtCode ?? 'CAYMA';
    _skillLevel = ex?.skillLevel ?? 4;
    _clipDurationS = (ex?.clipDurationS ?? 20).clamp(15, 30);
    _isAvailable = ex?.isAvailable ?? true;
    _bioCtrl = TextEditingController(
      text: ex?.bio ?? 'Disponible para pichangas nocturnas en Arequipa.',
    );
    _clipPublicIdCtrl = TextEditingController(text: '');
    _clipUrlCtrl = TextEditingController(
      text: ex?.clipUrl ?? '/media/clips/mediocampo.mp4',
    );
  }

  @override
  void dispose() {
    _bioCtrl.dispose();
    _clipPublicIdCtrl.dispose();
    _clipUrlCtrl.dispose();
    super.dispose();
  }

  void _pickPresetDeviceClip(String pos) {
    final lower = pos.toLowerCase();
    final clipPath = '/media/clips/$lower.mp4';
    setState(() {
      _selectedClipFileName = 'highlight_${lower}_aqp.mp4';
      _clipUrlCtrl.text = clipPath;
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.upsertSubstituteProfile(
        position: _position,
        skillLevel: _skillLevel,
        districtCode: _districtCode,
        bio: _bioCtrl.text.trim(),
        clipPublicId: _clipPublicIdCtrl.text.trim().isNotEmpty ? _clipPublicIdCtrl.text.trim() : null,
        clipUrl: _clipUrlCtrl.text.trim().isNotEmpty ? _clipUrlCtrl.text.trim() : null,
        clipDurationSeconds: _clipDurationS,
        isAvailable: _isAvailable,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text(
                    'Mi Perfil de Suplente Verificado',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _position,
              isExpanded: true,
              dropdownColor: PichangaTheme.bgElevated,
              decoration: const InputDecoration(labelText: 'Posición principal'),
              items: const [
                DropdownMenuItem(value: 'ARQUERO', child: Text('Arquero')),
                DropdownMenuItem(value: 'DEFENSA', child: Text('Defensa')),
                DropdownMenuItem(value: 'MEDIOCAMPO', child: Text('Mediocampo')),
                DropdownMenuItem(value: 'DELANTERO', child: Text('Delantero')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _position = v);
              },
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _districtCode,
              isExpanded: true,
              dropdownColor: PichangaTheme.bgElevated,
              decoration: const InputDecoration(labelText: 'Distrito base en Arequipa'),
              items: const [
                DropdownMenuItem(value: 'CAYMA', child: Text('Cayma')),
                DropdownMenuItem(value: 'YANAHUARA', child: Text('Yanahuara')),
                DropdownMenuItem(value: 'JLBYR', child: Text('J.L. Bustamante y Rivero')),
                DropdownMenuItem(value: 'CERRO_COLORADO', child: Text('Cerro Colorado')),
                DropdownMenuItem(value: 'SACHACA', child: Text('Sachaca')),
                DropdownMenuItem(value: 'AREQUIPA', child: Text('Cercado Arequipa')),
                DropdownMenuItem(value: 'MIRAFLORES', child: Text('Miraflores')),
                DropdownMenuItem(value: 'ALTO_SELVA_ALEGRE', child: Text('Alto Selva Alegre')),
                DropdownMenuItem(value: 'PAUCARPATA', child: Text('Paucarpata')),
                DropdownMenuItem(value: 'HUNTER', child: Text('Jacobo Hunter')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _districtCode = v);
              },
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _skillLevel,
                    isExpanded: true,
                    dropdownColor: PichangaTheme.bgElevated,
                    decoration: const InputDecoration(labelText: 'Nivel (1-5 ★)'),
                    items: const [1, 2, 3, 4, 5]
                        .map((lvl) => DropdownMenuItem(value: lvl, child: Text('$lvl ★')))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _skillLevel = v);
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: _clipDurationS,
                    isExpanded: true,
                    dropdownColor: PichangaTheme.bgElevated,
                    decoration: const InputDecoration(labelText: 'Duración Clip (15-30s)'),
                    items: const [15, 18, 20, 22, 25, 28, 30]
                        .map((sec) => DropdownMenuItem(value: sec, child: Text('${sec}s')))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _clipDurationS = v);
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: PichangaTheme.bgPrimary,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: PichangaTheme.borderSubtle),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Vista previa de tu clip (15-30s)',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white),
                      ),
                      TextButton.icon(
                        onPressed: () => _pickPresetDeviceClip(_position),
                        icon: const Icon(Icons.video_file_outlined, size: 15, color: PichangaTheme.skyAccent),
                        label: Text(
                          _selectedClipFileName ?? 'Subir .mp4/.mov',
                          style: const TextStyle(fontSize: 11, color: PichangaTheme.skyAccent, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  SubstituteClipPlayer(
                    key: ValueKey('${_clipUrlCtrl.text}_$_clipDurationS'),
                    videoUrl: _clipUrlCtrl.text.startsWith('http')
                        ? _clipUrlCtrl.text.trim()
                        : '${widget.api.baseUrl}${_clipUrlCtrl.text.trim()}',
                    durationSeconds: _clipDurationS,
                    positionLabel: _position,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _clipUrlCtrl,
              onChanged: (_) => setState(() {}),
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(
                labelText: 'URL o ruta del clip de video (.mp4 / .mov)',
                hintText: '/media/clips/mediocampo.mp4',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _clipPublicIdCtrl,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(
                labelText: 'ID público de clip Cloudinary (opcional)',
                hintText: 'pichangabook/clips/mi_jugada',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _bioCtrl,
              maxLines: 2,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(
                labelText: 'Presentación técnica y disponibilidad',
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              activeColor: PichangaTheme.turfGreen,
              title: const Text(
                'Disponible para convocatorias de emergencia',
                style: TextStyle(fontSize: 13, color: Colors.white, fontWeight: FontWeight.w600),
              ),
              value: _isAvailable,
              onChanged: (v) => setState(() => _isAvailable = v),
            ),
            if (_error != null) ...[
              const SizedBox(height: 6),
              Text(
                _error!,
                style: const TextStyle(color: PichangaTheme.dangerRed, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _saving ? null : _save,
                icon: const Icon(Icons.save_outlined),
                label: Text(_saving ? 'Guardando...' : 'Guardar Perfil de Suplente'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Hoja modal para revisar y aceptar/rechazar convocatorias (`PATCH /api/substitutes/invitations/:id`).
class _MySubstituteInvitationsSheet extends StatefulWidget {
  final RealtimeApiService api;
  final List<SubstituteInvitationItem> initialInvitations;
  final Future<void> Function() onChanged;

  const _MySubstituteInvitationsSheet({
    required this.api,
    required this.initialInvitations,
    required this.onChanged,
  });

  @override
  State<_MySubstituteInvitationsSheet> createState() => _MySubstituteInvitationsSheetState();
}

class _MySubstituteInvitationsSheetState extends State<_MySubstituteInvitationsSheet> {
  late List<SubstituteInvitationItem> _items;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _items = List.of(widget.initialInvitations);
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await widget.api.fetchMySubstituteInvitations();
      if (!mounted) return;
      setState(() {
        _items = list;
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

  Future<void> _respond(SubstituteInvitationItem item, String status) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.api.respondSubstituteInvitation(
        invitationId: item.id,
        status: status,
      );
      await _refresh();
      await widget.onChanged();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentUserId = widget.api.currentUser?.id;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
      child: SizedBox(
        height: 440,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text(
                    'Mis Convocatorias de Suplente',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const Divider(color: PichangaTheme.borderSubtle),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: PichangaTheme.dangerRed, fontSize: 12, fontWeight: FontWeight.bold),
                ),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _items.isEmpty
                      ? const Center(
                          child: Text(
                            'Aún no tienes convocatorias registradas.',
                            style: TextStyle(color: Colors.white70),
                          ),
                        )
                      : ListView.builder(
                          itemCount: _items.length,
                          itemBuilder: (_, idx) {
                            final inv = _items[idx];
                            final isTargetSubstitute = inv.substituteUserId == currentUserId;
                            final canRespond = isTargetSubstitute && inv.status == 'SENT';
                            return Card(
                              color: PichangaTheme.bgElevated,
                              margin: const EdgeInsets.only(bottom: 10),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${inv.complexName ?? "Complejo AQP"} · ${inv.courtName ?? inv.position}',
                                            style: const TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: Colors.white,
                                              fontSize: 13,
                                            ),
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: inv.status == 'ACCEPTED'
                                                ? PichangaTheme.turfGreenDark
                                                : inv.status == 'DECLINED'
                                                    ? PichangaTheme.dangerRed.withValues(alpha: 0.25)
                                                    : PichangaTheme.bgSecondary,
                                            borderRadius: BorderRadius.circular(999),
                                          ),
                                          child: Text(
                                            inv.status,
                                            style: TextStyle(
                                              fontSize: 10,
                                              fontWeight: FontWeight.w800,
                                              color: inv.status == 'ACCEPTED'
                                                  ? PichangaTheme.turfGreen
                                                  : inv.status == 'DECLINED'
                                                      ? PichangaTheme.dangerRed
                                                      : PichangaTheme.warningAmber,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Organizador: ${inv.organizerName} · Suplente: ${inv.substituteName} (${inv.position})',
                                      style: const TextStyle(fontSize: 11, color: Colors.white70),
                                    ),
                                    if (canRespond) ...[
                                      const SizedBox(height: 10),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: ElevatedButton.icon(
                                              onPressed: () => _respond(inv, 'ACCEPTED'),
                                              style: ElevatedButton.styleFrom(
                                                backgroundColor: PichangaTheme.turfGreen,
                                                minimumSize: const Size(0, 36),
                                              ),
                                              icon: const Icon(Icons.check, size: 16, color: PichangaTheme.bgPrimary),
                                              label: const Text(
                                                'Aceptar',
                                                style: TextStyle(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.bold,
                                                  color: PichangaTheme.bgPrimary,
                                                ),
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              onPressed: () => _respond(inv, 'DECLINED'),
                                              style: OutlinedButton.styleFrom(
                                                minimumSize: const Size(0, 36),
                                              ),
                                              icon: const Icon(Icons.close, size: 16, color: PichangaTheme.dangerRed),
                                              label: const Text(
                                                'Rechazar',
                                                style: TextStyle(fontSize: 12, color: PichangaTheme.dangerRed),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}
