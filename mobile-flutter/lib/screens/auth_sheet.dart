import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../services/realtime_api_service.dart';
import '../theme/app_theme.dart';

/// Hoja modal de Autenticación y Registro Diferenciado por Rol
/// (OTP SMS + Sesiones rápidas de Sandbox solo cuando el backend habilita modo demo).
class AuthSheet extends StatefulWidget {
  final RealtimeApiService api;

  const AuthSheet({super.key, required this.api});

  @override
  State<AuthSheet> createState() => _AuthSheetState();
}

class _AuthSheetState extends State<AuthSheet> {
  final TextEditingController _phoneCtrl = TextEditingController(text: '+51958222333');
  final TextEditingController _otpCtrl = TextEditingController();
  final TextEditingController _nameCtrl = TextEditingController(text: 'Diego Salas');

  String _selectedRole = 'ORGANIZER';
  bool _otpRequested = false;
  bool _loading = false;
  String? _sandboxCodeHint;
  String? _errorMessage;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleRequestOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length < 9) {
      setState(() => _errorMessage = 'Ingresa un celular peruano válido (9 dígitos o +51...)');
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final res = await widget.api.requestOtp(phone);
      if (!mounted) return;
      final hint = (res['devCode'] ?? res['demoOtp'])?.toString();
      final existingName = res['existingName']?.toString();
      final existingRole = res['role']?.toString();
      setState(() {
        _otpRequested = true;
        _sandboxCodeHint = hint;
        if (hint != null) _otpCtrl.text = hint;
        if (existingName != null && existingName.isNotEmpty) _nameCtrl.text = existingName;
        if (existingRole != null && existingRole.isNotEmpty) _selectedRole = existingRole;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _handleVerifyOtp() async {
    final code = _otpCtrl.text.trim();
    if (code.length != 6) {
      setState(() => _errorMessage = 'El código OTP debe tener 6 dígitos');
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      await widget.api.verifyOtp(
        phone: _phoneCtrl.text.trim(),
        code: code,
        fullName: _nameCtrl.text.trim(),
        role: _selectedRole,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _handleQuickRole(String role) async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      await widget.api.startDemoSession(role: role);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentUser = widget.api.currentUser;
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
                    'Acceso y Rol · PichangaBook',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, color: Colors.white70),
                ),
              ],
            ),
            if (currentUser != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: PichangaTheme.bgElevated,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: PichangaTheme.turfGreen.withValues(alpha: 0.4)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.verified_user, color: PichangaTheme.turfGreen, size: 22),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${currentUser.fullName} (${currentUser.role})',
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                          Text(
                            'Celular verificado: ${currentUser.phoneMasked} · Trust ${currentUser.trustScore}/100',
                            style: const TextStyle(fontSize: 12, color: Colors.white70),
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () async {
                        await widget.api.logout();
                        if (mounted) setState(() {});
                      },
                      child: const Text('Salir', style: TextStyle(color: PichangaTheme.dangerRed)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            const Text(
              AppEnvironmentConfig.firebaseAuthEnabled
                  ? 'Verificación por celular (OTP SMS / Firebase Auth)'
                  : 'Verificación por celular (OTP SMS)',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Colors.white70),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Celular (+51)',
                prefixIcon: Icon(Icons.phone_android, size: 18),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _nameCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Nombre completo',
                prefixIcon: Icon(Icons.person_outline, size: 18),
              ),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _selectedRole,
              isExpanded: true,
              dropdownColor: PichangaTheme.bgElevated,
              decoration: const InputDecoration(
                labelText: 'Rol en la plataforma',
                prefixIcon: Icon(Icons.badge_outlined, size: 18),
              ),
              items: const [
                DropdownMenuItem(value: 'ORGANIZER', child: Text('Organizador de Pichangas')),
                DropdownMenuItem(value: 'PLAYER', child: Text('Jugador / Suplente Verificado')),
                DropdownMenuItem(value: 'OWNER', child: Text('Dueño de Complejo Deportivo')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _selectedRole = v);
              },
            ),
            if (_otpRequested) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _otpCtrl,
                keyboardType: TextInputType.number,
                maxLength: 6,
                style: const TextStyle(color: Colors.white, letterSpacing: 4, fontWeight: FontWeight.bold),
                decoration: InputDecoration(
                  labelText: 'Código OTP de 6 dígitos',
                  counterText: '',
                  helperText: _sandboxCodeHint != null ? 'Código Sandbox generado: $_sandboxCodeHint' : null,
                  helperStyle: const TextStyle(color: PichangaTheme.turfGreen),
                  prefixIcon: const Icon(Icons.lock_clock, size: 18),
                ),
              ),
            ],
            if (_errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                style: const TextStyle(color: PichangaTheme.dangerRed, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _loading ? null : (_otpRequested ? _handleVerifyOtp : _handleRequestOtp),
                icon: Icon(_otpRequested ? Icons.verified : Icons.sms),
                label: Text(_loading
                    ? 'Procesando...'
                    : (_otpRequested ? 'Verificar OTP e Iniciar Sesión' : 'Solicitar Código SMS (OTP)')),
              ),
            ),
            if (widget.api.demoModeAvailable) ...[
              const SizedBox(height: 16),
              const Divider(color: PichangaTheme.borderSubtle),
              const SizedBox(height: 8),
              const Text(
                'Cambio rápido de cuenta verificada (Modo Sandbox)',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Colors.white70),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: _loading ? null : () => _handleQuickRole('ORGANIZER'),
                    icon: const Icon(Icons.sports_soccer, size: 16, color: PichangaTheme.turfGreen),
                    label: const Text('Diego (Organizador)', style: TextStyle(fontSize: 12)),
                  ),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : () => _handleQuickRole('PLAYER'),
                    icon: const Icon(Icons.directions_run, size: 16, color: PichangaTheme.skyAccent),
                    label: const Text('Piero (Suplente)', style: TextStyle(fontSize: 12)),
                  ),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : () => _handleQuickRole('OWNER'),
                    icon: const Icon(Icons.storefront, size: 16, color: PichangaTheme.warningAmber),
                    label: const Text('Carlos (Dueño)', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
