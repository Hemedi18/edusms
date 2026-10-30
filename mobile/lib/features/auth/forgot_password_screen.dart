import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/widgets/glow_card.dart';
import '../../data/repositories/auth_repository.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _emailCtrl = TextEditingController();
  final _tokenCtrl = TextEditingController();
  final _newPassCtrl = TextEditingController();
  bool _resetRequested = false;
  bool _busy = false;
  String? _statusMessage;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _tokenCtrl.dispose();
    _newPassCtrl.dispose();
    super.dispose();
  }

  Future<void> _requestReset() async {
    if (_emailCtrl.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).requestPasswordReset(_emailCtrl.text);
      setState(() {
        _resetRequested = true;
        _statusMessage =
            'If an active account matches that email, a reset token has been sent.';
      });
    } catch (e) {
      setState(() => _statusMessage = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmReset() async {
    if (_tokenCtrl.text.trim().isEmpty || _newPassCtrl.text.length < 10) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).confirmPasswordReset(
            token: _tokenCtrl.text,
            newPassword: _newPassCtrl.text,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password updated. You can now sign in.')),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      setState(() => _statusMessage = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset Password')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_statusMessage != null) ...[
                GlowCard(child: Text(_statusMessage!)),
                const SizedBox(height: 14),
              ],
              GlowCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Step 1: Request Reset Token',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                        labelText: 'Account Email',
                        prefixIcon: Icon(Icons.email_outlined),
                      ),
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _busy ? null : _requestReset,
                      child: const Text('Send Reset Instructions'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              GlowCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _resetRequested
                          ? 'Step 2: Enter Token & New Password'
                          : 'Already Have a Reset Token?',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _tokenCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Reset Token',
                        prefixIcon: Icon(Icons.vpn_key_outlined),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _newPassCtrl,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'New Password (min 10 chars)',
                        prefixIcon: Icon(Icons.lock_reset_rounded),
                      ),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: _busy ? null : _confirmReset,
                      child: const Text('Confirm New Password'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
