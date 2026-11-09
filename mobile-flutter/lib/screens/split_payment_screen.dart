import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/models.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';

/// Vista 3: Sistema Híbrido de Pagos y Split Payment ("Cupos pagados: 4 de 6")
/// con envío de link a WhatsApp, estados de cobro (Aprobado / Pendiente / Rechazado)
/// y lista de cuotas verificadas en tiempo real.
class SplitPaymentScreen extends StatefulWidget {
  final RealtimeApiService api;
  final String shareToken;

  const SplitPaymentScreen({
    super.key,
    required this.api,
    this.shareToken = 'pk4de6demo',
  });

  @override
  State<SplitPaymentScreen> createState() => _SplitPaymentScreenState();
}

class _SplitPaymentScreenState extends State<SplitPaymentScreen> {
  late String _activeToken;
  final TextEditingController _payerCtrl = TextEditingController(text: 'Rodrigo Sierra (UCSP)');
  String _selectedMethod = 'YAPE';
  String _tokenScenario = 'APPROVED'; // APPROVED | PENDING | DECLINED
  SplitPaymentDetail? _split;
  bool _loading = true;
  bool _paying = false;
  String? _error;
  String? _statusBanner;

  @override
  void initState() {
    super.initState();
    _activeToken = widget.shareToken;
    _load();
  }

  @override
  void didUpdateWidget(covariant SplitPaymentScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shareToken != widget.shareToken) {
      _activeToken = widget.shareToken;
      _load();
    }
  }

  @override
  void dispose() {
    _payerCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.fetchSplitPayment(_activeToken);
      if (!mounted) return;
      setState(() {
        _split = SplitPaymentDetail.fromJson(data);
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

  Future<void> _shareOnWhatsApp() async {
    final url = _split?.whatsappUrl;
    if (url != null && url.isNotEmpty) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _copyLink() async {
    final sp = _split;
    if (sp == null) return;
    await Clipboard.setData(ClipboardData(text: sp.whatsappUrl));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Enlace de pago dividido copiado al portapapeles')),
    );
  }

  String _generateSourceId() {
    final prefix = _selectedMethod == 'CARD' ? 'tok' : _selectedMethod == 'PLIN' ? 'pln' : 'ype';
    if (_tokenScenario == 'DECLINED') return '${prefix}_test_declined_card';
    if (_tokenScenario == 'PENDING') return '${prefix}_test_pending_wallet';
    return '${prefix}_sandbox_${DateTime.now().millisecondsSinceEpoch}';
  }

  Future<void> _payMyShare() async {
    final payer = _payerCtrl.text.trim();
    if (payer.length < 2) {
      setState(() => _error = 'Ingresa el nombre del jugador que abona su cuota.');
      return;
    }
    setState(() {
      _paying = true;
      _error = null;
      _statusBanner = null;
    });
    try {
      final res = await widget.api.paySplitSlot(
        token: _activeToken,
        payerName: payer,
        method: _selectedMethod,
        sourceId: _generateSourceId(),
      );
      if (!mounted) return;
      final detail = SplitPaymentDetail.fromJson(res);
      final chargeStatus = detail.lastCharge?['status']?.toString();
      final chargeMsg = detail.lastCharge?['userMessage']?.toString();
      setState(() {
        _split = detail;
        _paying = false;
        _statusBanner = chargeStatus == 'pending'
            ? (chargeMsg ?? 'Pago pendiente de confirmación por la billetera.')
            : '¡Cuota abonada con éxito! (${detail.progressLabel})';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _paying = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final sp = _split;
    if (sp == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 40, color: PichangaTheme.dangerRed),
              const SizedBox(height: 8),
              Text(_error ?? 'No se encontró el Split Payment.', textAlign: TextAlign.center),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _load, child: const Text('Reintentar')),
            ],
          ),
        ),
      );
    }

    final ratio = sp.totalSlots > 0 ? (sp.paidSlots / sp.totalSlots).clamp(0.0, 1.0) : 0.0;
    final isComplete = sp.status == 'COMPLETED' || sp.paidSlots >= sp.totalSlots;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Tarjeta de resumen del Split Payment
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: PichangaTheme.bgSecondary,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isComplete ? PichangaTheme.turfGreen : PichangaTheme.borderSubtle,
              width: isComplete ? 1.5 : 1.0,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: isComplete ? PichangaTheme.turfGreenDark : const Color(0xFF0C4A6E),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        isComplete ? 'RESERVA CONFIRMADA (100%)' : 'SPLIT EN CURSO · ${sp.shareToken}',
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: isComplete ? PichangaTheme.turfGreen : PichangaTheme.skyAccent,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'S/ ${sp.amountPerSlotSoles} / cupo',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                      color: PichangaTheme.turfGreen,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                sp.progressLabel, // "Cupos pagados: 4 de 6"
                style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: Colors.white),
              ),
              const SizedBox(height: 4),
              Text(
                '${sp.complexName} · ${sp.courtName} · ${sp.date} (${sp.hourLabel})',
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: ratio,
                  minHeight: 14,
                  backgroundColor: PichangaTheme.bgPrimary,
                  color: PichangaTheme.turfGreen,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: _shareOnWhatsApp,
                      style: ElevatedButton.styleFrom(backgroundColor: PichangaTheme.turfGreen),
                      icon: const Icon(Icons.share, color: PichangaTheme.bgPrimary, size: 18),
                      label: const Text(
                        'Enviar Link a WhatsApp',
                        style: TextStyle(color: PichangaTheme.bgPrimary, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filledTonal(
                    tooltip: 'Copiar enlace',
                    onPressed: _copyLink,
                    icon: const Icon(Icons.copy, size: 18),
                  ),
                  IconButton.filledTonal(
                    tooltip: 'Actualizar estado',
                    onPressed: _load,
                    icon: const Icon(Icons.refresh, size: 18),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        // Formulario de pago de cuota individual
        if (!isComplete)
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
                const Text(
                  'Abonar mi cupo (Yape / Plin / Tarjeta)',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _payerCtrl,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: const InputDecoration(
                    labelText: 'Tu nombre para la lista del partido',
                    prefixIcon: Icon(Icons.person_outline, size: 18),
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: ['YAPE', 'PLIN', 'CARD'].map((m) {
                    final sel = _selectedMethod == m;
                    return ChoiceChip(
                      label: Text(m == 'CARD' ? 'Tarjeta' : m),
                      selected: sel,
                      selectedColor: m == 'YAPE' ? PichangaTheme.yapePurple : PichangaTheme.skyAccent,
                      labelStyle: TextStyle(
                        color: sel ? Colors.white : Colors.white70,
                        fontWeight: FontWeight.bold,
                      ),
                      onSelected: (_) => setState(() => _selectedMethod = m),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _tokenScenario,
                  isExpanded: true,
                  dropdownColor: PichangaTheme.bgElevated,
                  decoration: const InputDecoration(
                    labelText: 'Simulación de respuesta de pasarela (Sandbox)',
                    prefixIcon: Icon(Icons.verified_user_outlined, size: 18),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'APPROVED', child: Text('Cargo Aprobado (ype_sandbox_*)')),
                    DropdownMenuItem(value: 'PENDING', child: Text('Cargo Pendiente (ype_test_pending)')),
                    DropdownMenuItem(value: 'DECLINED', child: Text('Cargo Rechazado (tok_test_declined)')),
                  ],
                  onChanged: (v) {
                    if (v != null) setState(() => _tokenScenario = v);
                  },
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _error!,
                    style: const TextStyle(color: PichangaTheme.dangerRed, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
                if (_statusBanner != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _statusBanner!,
                    style: const TextStyle(color: PichangaTheme.turfGreen, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _paying ? null : _payMyShare,
                    icon: const Icon(Icons.payment),
                    label: Text(
                      _paying
                          ? 'Verificando pago...'
                          : 'Abonar $_selectedMethod S/ ${sp.amountPerSlotSoles}',
                    ),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        Text(
          'Jugadores verificados (${sp.shares.length}/${sp.totalSlots})',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
        ),
        const SizedBox(height: 8),
        ...sp.shares.map(
          (share) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              dense: true,
              leading: CircleAvatar(
                backgroundColor: share.method == 'YAPE'
                    ? PichangaTheme.yapePurple.withValues(alpha: 0.25)
                    : PichangaTheme.turfGreenDark,
                child: Text(
                  share.method.substring(0, 1),
                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                ),
              ),
              title: Text(
                share.payerName,
                style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
              ),
              subtitle: Text(
                '${share.method} · ID ${share.providerChargeId}',
                style: const TextStyle(fontSize: 11, color: Colors.white60),
              ),
              trailing: Text(
                'S/ ${(share.amountCents / 100).toStringAsFixed(2)}',
                style: const TextStyle(
                  color: PichangaTheme.turfGreen,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
