import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../services/realtime_api_service.dart';

/// Vista 4: Bolsa de Suplentes Verificados (Core del Pivote).
/// Muestra posición, puntaje de puntualidad, teléfono enmascarado (+51 9•• ••• 101)
/// y minirreproductor de video con clips cortos (15 a 30 s) en Cloudinary / S3.
class SubstitutesPoolScreen extends StatefulWidget {
  final RealtimeApiService api;

  const SubstitutesPoolScreen({super.key, required this.api});

  @override
  State<SubstitutesPoolScreen> createState() => _SubstitutesPoolScreenState();
}

class _SubstitutesPoolScreenState extends State<SubstitutesPoolScreen> {
  List<dynamic> _subs = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final list = await widget.api.fetchSubstitutes();
    if (!mounted) return;
    setState(() {
      _subs = list;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _subs.length,
      itemBuilder: (_, idx) {
        final s = _subs[idx] as Map<String, dynamic>;
        return Card(
          color: const Color(0xFF1E293B),
          margin: const EdgeInsets.only(bottom: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SubstituteClipPlayer(
                  videoUrl: '${widget.api.baseUrl}${s['clipUrl']}',
                  durationSeconds: s['clipDurationS'] as int,
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${s['fullName']} · ${s['position']}',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      '${s['punctualityScore']}% Puntualidad',
                      style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Contacto protegido: ${s['phoneMasked']} (Chat / VoIP Interno)',
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class SubstituteClipPlayer extends StatefulWidget {
  final String videoUrl;
  final int durationSeconds;

  const SubstituteClipPlayer({
    super.key,
    required this.videoUrl,
    required this.durationSeconds,
  });

  @override
  State<SubstituteClipPlayer> createState() => _SubstituteClipPlayerState();
}

class _SubstituteClipPlayerState extends State<SubstituteClipPlayer> {
  late final VideoPlayerController _controller;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.videoUrl))
      ..initialize().then((_) {
        if (mounted) setState(() {});
      });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        alignment: Alignment.bottomLeft,
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: _controller.value.isInitialized
                ? VideoPlayer(_controller)
                : const ColoredBox(color: Color(0xFF0F172A)),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: ElevatedButton.icon(
              onPressed: () {
                setState(() {
                  _controller.value.isPlaying ? _controller.pause() : _controller.play();
                });
              },
              icon: Icon(_controller.value.isPlaying ? Icons.pause : Icons.play_arrow),
              label: Text('Clip ${widget.durationSeconds}s'),
            ),
          ),
        ],
      ),
    );
  }
}
