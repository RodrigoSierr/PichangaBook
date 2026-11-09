import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';
import 'auth_sheet.dart';

/// Vista 5: Mis Reservas, Cancelación / Liberación de Turnos y Perfil de Usuario.
class MyBookingsScreen extends StatefulWidget {
  final RealtimeApiService api;
  final void Function(String shareToken)? onOpenSplitToken;

  const MyBookingsScreen({
    super.key,
    required this.api,
    this.onOpenSplitToken,
  });

  @override
  State<MyBookingsScreen> createState() => _MyBookingsScreenState();
}

class _MyBookingsScreenState extends State<MyBookingsScreen> {
  List<BookingRecord> _bookings = [];
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
      final list = await widget.api.fetchMyBookings();
      if (!mounted) return;
      setState(() {
        _bookings = list;
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

  Future<void> _cancelBooking(BookingRecord booking) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: PichangaTheme.bgSecondary,
        title: const Text('Cancelar Reserva'),
        content: Text(
          '¿Deseas liberar el turno de las ${booking.hourLabel} en ${booking.complexName} (${booking.courtName})?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Conservar'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: PichangaTheme.dangerRed, foregroundColor: Colors.white),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Liberar Turno'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await widget.api.releaseBooking(booking.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Turno liberado y actualizado en tiempo real.')),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo liberar la reserva: $e')),
      );
    }
  }

  Future<void> _editProfile() async {
    final user = widget.api.currentUser;
    if (user == null) return;
    final nameCtrl = TextEditingController(text: user.fullName);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: PichangaTheme.bgSecondary,
        title: const Text('Editar Perfil'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: nameCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: 'Nombre completo'),
            ),
            const SizedBox(height: 12),
            Text(
              'Rol autorizado: ${user.role} (no modificable desde el perfil)',
              style: const TextStyle(fontSize: 12, color: Colors.white70),
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
              await widget.api.updateProfile(fullName: nameCtrl.text.trim());
              if (ctx.mounted) Navigator.of(ctx).pop(true);
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    nameCtrl.dispose();
    if (saved == true && mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.api.currentUser;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Tarjeta de perfil de usuario autenticado
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: PichangaTheme.bgSecondary,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: PichangaTheme.borderSubtle),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: PichangaTheme.turfGreenDark,
                    child: Text(
                      (user?.fullName ?? 'P').substring(0, 1).toUpperCase(),
                      style: const TextStyle(color: PichangaTheme.turfGreen, fontWeight: FontWeight.w900),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.fullName ?? 'Invitado (Sin sesión)',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white),
                        ),
                        Text(
                          user != null
                              ? 'Rol: ${user.role} · ${user.phoneMasked} · Trust ${user.trustScore}/100'
                              : 'Inicia sesión con tu celular para reservar canchas',
                          style: const TextStyle(fontSize: 12, color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (user != null)
                    OutlinedButton.icon(
                      onPressed: _editProfile,
                      icon: const Icon(Icons.edit_outlined, size: 16),
                      label: const Text('Editar Perfil', style: TextStyle(fontSize: 12)),
                    ),
                  ElevatedButton.icon(
                    onPressed: () async {
                      final changed = await showModalBottomSheet<bool>(
                        context: context,
                        isScrollControlled: true,
                        backgroundColor: PichangaTheme.bgSecondary,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
                        ),
                        builder: (_) => AuthSheet(api: widget.api),
                      );
                      if (changed == true && mounted) {
                        await _load();
                      }
                    },
                    icon: const Icon(Icons.swap_horiz, size: 16),
                    label: Text(
                      user != null ? 'Cambiar Cuenta / OTP' : 'Iniciar Sesión OTP',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Expanded(
              child: Text(
                'Mis Reservas y Pichangas',
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white),
              ),
            ),
            IconButton(
              onPressed: _load,
              icon: const Icon(Icons.refresh, size: 20),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_error != null)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: PichangaTheme.bgSecondary,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                Text(_error!, style: const TextStyle(color: Colors.white70)),
                const SizedBox(height: 8),
                ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
              ],
            ),
          )
        else if (_bookings.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Text(
              'Aún no tienes reservas registradas con esta cuenta.',
              style: TextStyle(color: Colors.white60),
            ),
          )
        else
          ..._bookings.map((b) {
            final isCancelled = b.status == 'CANCELLED';
            final isConfirmed = b.status == 'CONFIRMED';
            return Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            '${b.complexName} · ${b.courtName}',
                            style: const TextStyle(fontWeight: FontWeight.w800, color: Colors.white),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: isConfirmed
                                ? PichangaTheme.turfGreenDark
                                : isCancelled
                                    ? PichangaTheme.dangerRed.withValues(alpha: 0.2)
                                    : const Color(0xFF0C4A6E),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            b.status,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: isConfirmed
                                  ? PichangaTheme.turfGreen
                                  : isCancelled
                                      ? PichangaTheme.dangerRed
                                      : PichangaTheme.skyAccent,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Fecha: ${b.date} · Hora: ${b.hourLabel} · Total S/ ${(b.totalCents / 100).toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 12, color: Colors.white70),
                    ),
                    if (b.shareToken != null) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Split: ${b.paidSlots ?? 0}/${b.totalSlots ?? 6} pagados (${b.shareToken})',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12, color: PichangaTheme.skyAccent),
                            ),
                          ),
                          if (widget.onOpenSplitToken != null)
                            TextButton(
                              onPressed: () => widget.onOpenSplitToken!(b.shareToken!),
                              child: const Text('Abrir Split →', style: TextStyle(fontSize: 12)),
                            ),
                        ],
                      ),
                    ],
                    if (!isCancelled) ...[
                      const SizedBox(height: 6),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () => _cancelBooking(b),
                          icon: const Icon(Icons.cancel_outlined, size: 16, color: PichangaTheme.dangerRed),
                          label: const Text(
                            'Cancelar / Liberar turno',
                            style: TextStyle(fontSize: 12, color: PichangaTheme.dangerRed),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
