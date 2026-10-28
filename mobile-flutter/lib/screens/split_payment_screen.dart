import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/realtime_api_service.dart';

/// Vista 3: Sistema Híbrido de Pagos y Split Payment ("Cupos pagados: 4 de 6")
/// con botón para compartir link de cobro fraccionado en WhatsApp.
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
  Map<String, dynamic>? _split;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final data = await widget.api.fetchSplitPayment(widget.shareToken);
    if (!mounted) return;
    setState(() => _split = data);
  }

  Future<void> _shareOnWhatsApp() async {
    final url = _split?['whatsappUrl'] as String?;
    if (url != null) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _payMyShare() async {
    await widget.api.paySplitSlot(
      token: widget.shareToken,
      payerName: 'Rodrigo S. (UCSP)',
      method: 'YAPE',
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final sp = _split;
    if (sp == null) return const Center(child: CircularProgressIndicator());
    final paid = sp['paidSlots'] as int;
    final total = sp['totalSlots'] as int;
    final ratio = total > 0 ? paid / total : 0.0;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            sp['progressLabel'] as String, // "Cupos pagados: 4 de 6"
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: ratio,
              minHeight: 14,
              backgroundColor: const Color(0xFF1E293B),
              color: const Color(0xFF10B981),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _shareOnWhatsApp,
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
                  icon: const Icon(Icons.share, color: Color(0xFF0F172A)),
                  label: const Text(
                    'Enviar Link a WhatsApp',
                    style: TextStyle(color: Color(0xFF0F172A), fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              ElevatedButton(
                onPressed: _payMyShare,
                child: const Text('Abonar Yape S/ 15'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
