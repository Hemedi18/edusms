import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/native_gateway_bridge.dart';
import '../../core/platform/platform_capabilities.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../auth/auth_controller.dart';

/// Transparent onboarding & permission education flow.
/// Clearly explains:
/// 1. Isolated Simulation Mode vs Physical Android SIM Gateway
/// 2. Why SEND_SMS / RECEIVE_SMS / READ_PHONE_STATE are requested BEFORE invoking OS dialogs
/// 3. Optional Default SMS Handler role (never forced!)
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  int _pageIndex = 0;
  Map<String, bool>? _grantedPermissions;

  Future<void> _requestSmsPermissionsWithDisclosure() async {
    final result = await ref.read(nativeGatewayBridgeProvider).requestPermissions();
    if (!mounted) return;
    setState(() => _grantedPermissions = result);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          (result['SEND_SMS'] == true && result['RECEIVE_SMS'] == true)
              ? 'SMS permissions granted. Pair your handset after signing in.'
              : 'You can still use Simulation Mode anytime without SIM permissions.',
        ),
      ),
    );
  }

  Future<void> _finishOnboarding() async {
    await ref.read(authControllerProvider.notifier).completeOnboarding();
    if (mounted) {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(platformCapabilitiesProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Welcome to EduSMS'),
        actions: [
          TextButton(
            onPressed: _finishOnboarding,
            child: const Text('Skip to Sign In'),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: List.generate(3, (idx) {
                  final active = idx == _pageIndex;
                  return Expanded(
                    child: Container(
                      height: 5,
                      margin: EdgeInsets.only(right: idx < 2 ? 8 : 0),
                      decoration: BoxDecoration(
                        color: active
                            ? AppTheme.electricViolet
                            : theme.colorScheme.outline,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 20),
              Expanded(
                child: SingleChildScrollView(
                  child: switch (_pageIndex) {
                    0 => _buildStepTransports(context, caps),
                    1 => _buildStepPermissions(context, caps),
                    _ => _buildStepDefaultSmsRole(context, caps),
                  },
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  if (_pageIndex > 0) ...[
                    OutlinedButton(
                      onPressed: () => setState(() => _pageIndex--),
                      child: const Text('Back'),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: FilledButton(
                      key: const Key('onboarding_next_button'),
                      onPressed: () {
                        if (_pageIndex < 2) {
                          setState(() => _pageIndex++);
                        } else {
                          _finishOnboarding();
                        }
                      },
                      child: Text(
                        _pageIndex < 2 ? 'Continue' : 'Continue to EduSMS Sign In',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStepTransports(BuildContext context, PlatformCapabilities caps) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.hub_rounded, size: 44, color: AppTheme.electricViolet),
        const SizedBox(height: 12),
        Text(
          'Zero-Cost Simulation & Real Android SIM Gateway',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 10),
        const Text(
          'EduSMS strictly separates developer sandbox testing from real cellular carrier traffic — '
          'and never silently falls back between them.',
        ),
        const SizedBox(height: 18),
        const GlowCard(
          accentColor: AppTheme.cyanAccent,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.science_outlined, color: AppTheme.cyanAccent),
                  SizedBox(width: 8),
                  Text(
                    'Simulation Mode (Default Safe Sandbox)',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              SizedBox(height: 6),
              Text(
                'Test inbound SMS injection, keyword/regex rules, AI replies, bulk audience '
                'filtering, and HMAC webhooks with zero carrier SMS charges and no SIM required.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        GlowCard(
          accentColor: AppTheme.electricViolet,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.sim_card_outlined, color: AppTheme.electricViolet),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      caps.supportsPhysicalSimGateway
                          ? 'Physical Android SIM Gateway (This Handset)'
                          : 'Remote Android SIM Gateway (Companion Mode)',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(caps.gatewayCapabilitySummary),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStepPermissions(BuildContext context, PlatformCapabilities caps) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.verified_user_outlined, size: 44, color: AppTheme.cyanAccent),
        const SizedBox(height: 12),
        Text(
          'Transparent Permission Disclosure',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Before EduSMS ever opens an Android OS permission prompt, here is exactly why each '
          'telephony permission is used when you opt into Physical SIM Gateway mode:',
        ),
        const SizedBox(height: 16),
        const GlowCard(
          child: Column(
            children: [
              _PermExplainRow(
                title: 'SEND_SMS',
                reason:
                    'Transmits outbound SMS jobs queued by your authenticated EduSMS account via Android SmsManager. Carrier SMS charges apply.',
              ),
              Divider(height: 20),
              _PermExplainRow(
                title: 'RECEIVE_SMS & READ_SMS',
                reason:
                    'Synchronizes incoming SMS to your account inbox, evaluates STOP/START consent keywords, and triggers authorized auto-replies.',
              ),
              Divider(height: 20),
              _PermExplainRow(
                title: 'READ_PHONE_STATE',
                reason:
                    'Detects multi-SIM slots (SIM 1 / SIM 2), carrier name, and cellular radio readiness.',
              ),
              Divider(height: 20),
              _PermExplainRow(
                title: 'FOREGROUND_SERVICE & POST_NOTIFICATIONS',
                reason:
                    'Displays a persistent, user-visible notification with Pause & Stop buttons whenever the SIM Gateway is active — never hidden.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (caps.supportsPhysicalSimGateway)
          OutlinedButton.icon(
            onPressed: _requestSmsPermissionsWithDisclosure,
            icon: const Icon(Icons.security_rounded),
            label: const Text('Grant Android SIM Permissions Now (Optional)'),
          ),
        if (_grantedPermissions != null) ...[
          const SizedBox(height: 10),
          Text(
            'Permissions status: ${_grantedPermissions!.entries.map((e) => '${e.key}=${e.value ? "Granted" : "Denied"}').join(', ')}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ],
    );
  }

  Widget _buildStepDefaultSmsRole(BuildContext context, PlatformCapabilities caps) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.shield_outlined, size: 44, color: AppTheme.emeraldSuccess),
        const SizedBox(height: 12),
        Text(
          'Optional Default SMS Role & Carrier Honesty',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 10),
        const GlowCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Default SMS Handler Role is Optional',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 6),
              Text(
                'Standard outbound SmsManager sending and SMS_RECEIVED broadcast sync work '
                'without replacing your personal SMS app. EduSMS never forces RoleManager.ROLE_SMS '
                'unless you explicitly test high-throughput carrier role features in Device Diagnostics.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const GlowCard(
          accentColor: AppTheme.electricBlue,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Honest Delivery Reporting',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 6),
              Text(
                '• Accepted for Transmission (Submitted): SmsManager accepted the PDU.\n'
                '• Carrier Delivered: Carrier returned a verified delivery report PDU.\n'
                '• Physical SIMs always use your carrier-assigned phone number and cannot spoof alphanumeric sender IDs.',
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PermExplainRow extends StatelessWidget {
  const _PermExplainRow({required this.title, required this.reason});

  final String title;
  final String reason;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(Icons.check_circle_outline, size: 18, color: AppTheme.electricViolet),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(height: 2),
              Text(reason, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ],
    );
  }
}
