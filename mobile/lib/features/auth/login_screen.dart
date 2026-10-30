import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/storage/app_preferences.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import 'auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _mfaCtrl = TextEditingController();

  bool _showMfaField = false;
  bool _obscurePassword = true;
  bool _submitting = false;
  String? _errorBanner;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _mfaCtrl.dispose();
    super.dispose();
  }

  void _quickFillDemoAccount() {
    setState(() {
      _emailCtrl.text = 'dev@edusms.local';
      _passwordCtrl.text = 'EduSMS-Demo-2026!';
      _errorBanner = null;
    });
  }

  Future<void> _openBackendUrlSheet() async {
    final currentUrl = ref.read(apiBaseUrlProvider);
    final urlCtrl = TextEditingController(text: currentUrl);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.viewInsetsOf(ctx).bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Configure Backend API URL',
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                'Use http://10.0.2.2:8000 on Android Emulator, http://127.0.0.1:8000 on iOS Simulator, or your LAN/HTTPS server address on a physical phone.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              const SizedBox(height: 14),
              TextField(
                controller: urlCtrl,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'Backend Base URL',
                  hintText: 'http://192.168.1.10:8000',
                  prefixIcon: Icon(Icons.dns_outlined),
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                children: [
                  ActionChip(
                    label: const Text('Android Emulator (10.0.2.2)'),
                    onPressed: () => urlCtrl.text = 'http://10.0.2.2:8000',
                  ),
                  ActionChip(
                    label: const Text('Localhost (127.0.0.1)'),
                    onPressed: () => urlCtrl.text = 'http://127.0.0.1:8000',
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  await ref.read(apiBaseUrlProvider.notifier).updateUrl(urlCtrl.text);
                  if (ctx.mounted) Navigator.of(ctx).pop();
                },
                child: const Text('Save Backend URL'),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _submitLogin() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _submitting = true;
      _errorBanner = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).login(
            email: _emailCtrl.text,
            password: _passwordCtrl.text,
            mfaCode: _mfaCtrl.text.trim().isEmpty ? null : _mfaCtrl.text.trim(),
          );
      if (mounted) {
        context.go('/home');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.isMfaRequired) {
          _showMfaField = true;
        }
        _errorBanner = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorBanner = e.toString());
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final baseUrl = ref.watch(apiBaseUrlProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('EduSMS'),
        actions: [
          TextButton.icon(
            key: const Key('backend_url_button'),
            onPressed: _openBackendUrlSheet,
            icon: const Icon(Icons.dns_outlined, size: 18),
            label: const Text('Server URL'),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.electricViolet.withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.sms_outlined,
                            color: AppTheme.electricViolet,
                            size: 28,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Sign in to EduSMS',
                                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                              Text(
                                'API: $baseUrl',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (_errorBanner != null) ...[
                      GlowCard(
                        accentColor: AppTheme.roseDanger,
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, color: AppTheme.roseDanger),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _errorBanner!,
                                style: const TextStyle(color: AppTheme.roseDanger),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    GlowCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextFormField(
                            key: const Key('login_email_field'),
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.email],
                            decoration: const InputDecoration(
                              labelText: 'Email Address',
                              hintText: 'teacher@school.ac.tz',
                              prefixIcon: Icon(Icons.alternate_email_rounded),
                            ),
                            validator: (value) {
                              final v = (value ?? '').trim();
                              if (v.isEmpty) return 'Email address is required.';
                              if (!v.contains('@') || !v.contains('.')) {
                                return 'Enter a valid email address.';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            key: const Key('login_password_field'),
                            controller: _passwordCtrl,
                            obscureText: _obscurePassword,
                            decoration: InputDecoration(
                              labelText: 'Password',
                              prefixIcon: const Icon(Icons.lock_outline_rounded),
                              suffixIcon: IconButton(
                                onPressed: () =>
                                    setState(() => _obscurePassword = !_obscurePassword),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                            validator: (value) {
                              if ((value ?? '').isEmpty) {
                                return 'Password is required.';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 10),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: TextButton.icon(
                              onPressed: () =>
                                  setState(() => _showMfaField = !_showMfaField),
                              icon: const Icon(Icons.phonelink_lock_rounded, size: 17),
                              label: Text(
                                _showMfaField
                                    ? 'Hide TOTP / Recovery Code'
                                    : 'Have a TOTP Authenticator Code?',
                              ),
                            ),
                          ),
                          if (_showMfaField) ...[
                            const SizedBox(height: 6),
                            TextFormField(
                              key: const Key('login_mfa_field'),
                              controller: _mfaCtrl,
                              decoration: const InputDecoration(
                                labelText: '6-Digit TOTP or Recovery Code',
                                prefixIcon: Icon(Icons.key_rounded),
                              ),
                            ),
                          ],
                          const SizedBox(height: 16),
                          FilledButton(
                            key: const Key('login_submit_button'),
                            onPressed: _submitting ? null : _submitLogin,
                            child: _submitting
                                ? const SizedBox(
                                    height: 18,
                                    width: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Sign In'),
                          ),
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            key: const Key('demo_quick_fill_button'),
                            onPressed: _quickFillDemoAccount,
                            icon: const Icon(Icons.bolt_rounded, size: 18),
                            label: const Text('Quick-Fill Local Dev Account'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        TextButton(
                          onPressed: () => context.push('/forgot-password'),
                          child: const Text('Forgot Password?'),
                        ),
                        TextButton(
                          onPressed: () => context.push('/register'),
                          child: const Text('Create Account'),
                        ),
                      ],
                    ),
                    TextButton(
                      onPressed: () => context.go('/onboarding'),
                      child: const Text('Review SIM Permission & Architecture Guide'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
