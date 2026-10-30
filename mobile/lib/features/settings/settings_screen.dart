import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/storage/app_preferences.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/theme_controller.dart';
import '../../core/widgets/glow_card.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';
import '../auth/auth_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _nameCtrl = TextEditingController();
  final _orgCtrl = TextEditingController();
  final _dailyLimitCtrl = TextEditingController();

  String _timezone = 'Africa/Dar_es_Salaam';
  String _countryCode = 'TZ';
  int _retentionDays = 90;
  bool _storeInboundBody = true;
  bool _requireConsentForCampaigns = true;

  List<UserSessionItem> _sessions = const [];
  bool _loadingSessions = false;
  bool _savingProfile = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authControllerProvider).user;
    if (user != null) {
      _hydrateFromUser(user);
    }
    Future.microtask(_loadSessions);
  }

  void _hydrateFromUser(UserProfile user) {
    _nameCtrl.text = user.fullName;
    _orgCtrl.text = user.organization;
    _dailyLimitCtrl.text = user.dailyRealSmsLimit.toString();
    _timezone = user.timezone;
    _countryCode = user.defaultCountryCode;
    _retentionDays = user.messageRetentionDays;
    _storeInboundBody = user.storeInboundMessageBody;
    _requireConsentForCampaigns = user.requireConsentForCampaigns;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _orgCtrl.dispose();
    _dailyLimitCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadSessions() async {
    if (ref.read(authControllerProvider).user == null) return;
    setState(() => _loadingSessions = true);
    try {
      final list = await ref.read(authRepositoryProvider).listSessions();
      if (mounted) setState(() => _sessions = list);
    } catch (_) {
      // Non-blocking in offline or mock test scenarios
    } finally {
      if (mounted) setState(() => _loadingSessions = false);
    }
  }

  Future<void> _saveProfileAndGovernance() async {
    setState(() => _savingProfile = true);
    try {
      final parsedLimit = int.tryParse(_dailyLimitCtrl.text.trim()) ?? 250;
      final updated = await ref.read(authRepositoryProvider).updateProfile({
        'full_name': _nameCtrl.text.trim(),
        'organization': _orgCtrl.text.trim(),
        'timezone': _timezone,
        'default_country_code': _countryCode,
        'daily_real_sms_limit': parsedLimit,
        'message_retention_days': _retentionDays,
        'store_inbound_message_body': _storeInboundBody,
        'require_consent_for_campaigns': _requireConsentForCampaigns,
      });
      ref.read(authControllerProvider.notifier).setUserProfile(updated);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Saved profile & privacy governance settings')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _openEditApiUrlDialog() async {
    final ctrl = TextEditingController(text: ref.read(apiBaseUrlProvider));
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Backend Server URL'),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'API Base URL',
            hintText: 'http://10.0.2.2:8000',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              await ref.read(apiBaseUrlProvider.notifier).updateUrl(ctrl.text);
              if (ctx.mounted) Navigator.of(ctx).pop();
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _openChangePasswordSheet() async {
    final currentCtrl = TextEditingController();
    final nextCtrl = TextEditingController();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
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
              'Change Account Password',
              style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: currentCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Current Password'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: nextCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New Strong Password'),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                try {
                  await ref.read(authRepositoryProvider).changePassword(
                        currentPassword: currentCtrl.text,
                        newPassword: nextCtrl.text,
                      );
                  if (ctx.mounted) {
                    Navigator.of(ctx).pop();
                  }
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Password updated')),
                    );
                  }
                } catch (e) {
                  if (ctx.mounted) {
                    ScaffoldMessenger.of(ctx).showSnackBar(
                      SnackBar(content: Text(e.toString())),
                    );
                  }
                }
              },
              child: const Text('Update Password'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openTotpMfaSetupFlow() async {
    try {
      final setup = await ref.read(authRepositoryProvider).setupMfa();
      final secret = setup['secret'] ?? '';
      final uri = setup['provisioning_uri'] ?? '';
      if (!mounted) return;

      final codeCtrl = TextEditingController();
      final recoveryCodes = await showModalBottomSheet<List<String>>(
        context: context,
        isScrollControlled: true,
        builder: (ctx) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.viewInsetsOf(ctx).bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Set Up TOTP Authenticator (2FA)',
                  style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Scan this QR code in Google Authenticator, Authy, or 1Password, then enter the 6-digit code.',
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
                const SizedBox(height: 14),
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: QrImageView(
                      data: uri.isNotEmpty ? uri : secret,
                      version: QrVersions.auto,
                      size: 168,
                      backgroundColor: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SelectableText(
                  'Manual Secret: $secret',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: codeCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: '6-Digit TOTP Code',
                    hintText: '123456',
                  ),
                ),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: () async {
                    try {
                      final codes = await ref
                          .read(authRepositoryProvider)
                          .verifyAndEnableMfa(codeCtrl.text);
                      if (ctx.mounted) Navigator.of(ctx).pop(codes);
                    } catch (e) {
                      if (ctx.mounted) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          SnackBar(content: Text(e.toString())),
                        );
                      }
                    }
                  },
                  child: const Text('Verify & Enable MFA'),
                ),
              ],
            ),
          ),
        ),
      );

      if (recoveryCodes != null && mounted) {
        await ref.read(authControllerProvider.notifier).refreshProfile();
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Save One-Time Recovery Codes'),
            content: SelectableText(
              recoveryCodes.join('\n'),
              style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700),
            ),
            actions: [
              OutlinedButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: recoveryCodes.join('\n')));
                },
                icon: const Icon(Icons.copy_rounded, size: 16),
                label: const Text('Copy All'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Saved'),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _openDisableMfaDialog() async {
    final pwdCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disable TOTP MFA'),
        content: TextField(
          controller: pwdCtrl,
          obscureText: true,
          decoration: const InputDecoration(labelText: 'Confirm Password'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTheme.roseDanger),
            onPressed: () async {
              try {
                await ref.read(authRepositoryProvider).disableMfa(pwdCtrl.text);
                await ref.read(authControllerProvider.notifier).refreshProfile();
                if (ctx.mounted) Navigator.of(ctx).pop();
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(content: Text(e.toString())),
                  );
                }
              }
            },
            child: const Text('Disable MFA'),
          ),
        ],
      ),
    );
  }

  Future<void> _exportJsonData() async {
    try {
      final exported = await ref.read(authRepositoryProvider).exportAccountData();
      final pretty = const JsonEncoder.withIndent('  ').convert(exported);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Account Data Export (JSON)'),
          content: SizedBox(
            width: 480,
            height: 280,
            child: SingleChildScrollView(
              child: SelectableText(
                pretty,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11.5),
              ),
            ),
          ),
          actions: [
            OutlinedButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: pretty));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Copied JSON export to clipboard')),
                );
              },
              icon: const Icon(Icons.copy_rounded, size: 16),
              label: const Text('Copy JSON'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _confirmPermanentAccountDeletion() async {
    final pwdCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Permanently Delete Account'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'This irreversibly deletes your EduSMS account, contacts, campaigns, paired device tokens, and message logs.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: pwdCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Account Password'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: confirmCtrl,
              decoration: const InputDecoration(
                labelText: 'Type DELETE to confirm',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTheme.roseDanger),
            onPressed: () async {
              try {
                await ref.read(authRepositoryProvider).deleteAccount(
                      password: pwdCtrl.text,
                      confirmation: confirmCtrl.text,
                    );
                await ref.read(authControllerProvider.notifier).logout();
                if (ctx.mounted) {
                  Navigator.of(ctx).pop();
                }
                if (mounted) {
                  context.go('/login');
                }
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    SnackBar(content: Text(e.toString())),
                  );
                }
              }
            },
            child: const Text('Delete Forever'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentTheme = ref.watch(themeModeProvider);
    final apiBaseUrl = ref.watch(apiBaseUrlProvider);
    final user = ref.watch(authControllerProvider).user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings, Security & Privacy'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1. Appearance (Dark / Light / System)
          GlowCard(
            accentColor: AppTheme.electricViolet,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.palette_outlined, color: AppTheme.electricViolet),
                    SizedBox(width: 8),
                    Text(
                      'Appearance & Theme',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SegmentedButton<ThemeMode>(
                  key: const Key('theme_mode_segmented_button'),
                  segments: const [
                    ButtonSegment<ThemeMode>(
                      value: ThemeMode.dark,
                      icon: Icon(Icons.dark_mode_outlined, size: 18),
                      label: Text('Dark'),
                    ),
                    ButtonSegment<ThemeMode>(
                      value: ThemeMode.light,
                      icon: Icon(Icons.light_mode_outlined, size: 18),
                      label: Text('Light'),
                    ),
                    ButtonSegment<ThemeMode>(
                      value: ThemeMode.system,
                      icon: Icon(Icons.brightness_auto_outlined, size: 18),
                      label: Text('System'),
                    ),
                  ],
                  selected: {currentTheme},
                  onSelectionChanged: (selection) {
                    ref
                        .read(themeModeProvider.notifier)
                        .setThemeMode(selection.first);
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 2. Server Connectivity & Logout
          GlowCard(
            accentColor: AppTheme.cyanAccent,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.dns_outlined, color: AppTheme.cyanAccent),
                    SizedBox(width: 8),
                    Text(
                      'Server Connectivity & Session',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Backend API: $apiBaseUrl',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('settings_edit_api_url_button'),
                      onPressed: _openEditApiUrlDialog,
                      icon: const Icon(Icons.edit_outlined, size: 16),
                      label: const Text('Change API URL'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('settings_logout_button'),
                      onPressed: () async {
                        await ref.read(authControllerProvider.notifier).logout();
                        if (context.mounted) context.go('/login');
                      },
                      icon: const Icon(Icons.logout_rounded, size: 16),
                      label: const Text('Sign Out'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 3. Profile & Regional (+255 / Timezone / Daily Cap)
          GlowCard(
            accentColor: AppTheme.electricBlue,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.person_outline_rounded, color: AppTheme.electricBlue),
                    SizedBox(width: 8),
                    Text(
                      'Profile, Regional & Safety Caps',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _nameCtrl,
                  decoration: const InputDecoration(labelText: 'Full Name'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _orgCtrl,
                  decoration: const InputDecoration(labelText: 'Institution / Campus'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: const [
                          'Africa/Dar_es_Salaam',
                          'Africa/Nairobi',
                          'UTC',
                        ].contains(_timezone)
                            ? _timezone
                            : 'Africa/Dar_es_Salaam',
                        decoration: const InputDecoration(labelText: 'Timezone'),
                        items: const [
                          DropdownMenuItem(
                            value: 'Africa/Dar_es_Salaam',
                            child: Text('Dar es Salaam (EAT)'),
                          ),
                          DropdownMenuItem(
                            value: 'Africa/Nairobi',
                            child: Text('Nairobi (EAT)'),
                          ),
                          DropdownMenuItem(value: 'UTC', child: Text('UTC')),
                        ],
                        onChanged: (v) {
                          if (v != null) setState(() => _timezone = v);
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _dailyLimitCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText: 'Daily Real SMS Cap',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Store Inbound Message Bodies'),
                  subtitle: const Text(
                    'Disable to redact incoming student/parent SMS bodies at rest',
                  ),
                  value: _storeInboundBody,
                  onChanged: (v) => setState(() => _storeInboundBody = v),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Require Opt-In Consent for Campaigns'),
                  value: _requireConsentForCampaigns,
                  onChanged: (v) => setState(() => _requireConsentForCampaigns = v),
                ),
                DropdownButtonFormField<int>(
                  initialValue: const [30, 90, 180, 365].contains(_retentionDays)
                      ? _retentionDays
                      : 90,
                  decoration: const InputDecoration(labelText: 'Message Log Retention'),
                  items: const [
                    DropdownMenuItem(value: 30, child: Text('30 Days')),
                    DropdownMenuItem(value: 90, child: Text('90 Days (Default)')),
                    DropdownMenuItem(value: 180, child: Text('180 Days')),
                    DropdownMenuItem(value: 365, child: Text('365 Days')),
                  ],
                  onChanged: (v) {
                    if (v != null) setState(() => _retentionDays = v);
                  },
                ),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: _savingProfile ? null : _saveProfileAndGovernance,
                  child: Text(_savingProfile ? 'Saving...' : 'Save Profile & Governance'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 4. Security: Password, TOTP MFA & Sessions
          GlowCard(
            accentColor: AppTheme.emeraldSuccess,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shield_outlined, color: AppTheme.emeraldSuccess),
                    SizedBox(width: 8),
                    Text(
                      'Security, TOTP MFA & Active Sessions',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _openChangePasswordSheet,
                      icon: const Icon(Icons.password_rounded, size: 17),
                      label: const Text('Change Password'),
                    ),
                    if (user?.mfaEnabled == true)
                      OutlinedButton.icon(
                        onPressed: _openDisableMfaDialog,
                        icon: const Icon(Icons.verified_user_outlined, size: 17),
                        label: const Text('TOTP MFA Enabled (Manage)'),
                      )
                    else
                      FilledButton.tonalIcon(
                        key: const Key('setup_mfa_button'),
                        onPressed: _openTotpMfaSetupFlow,
                        icon: const Icon(Icons.qr_code_2_rounded, size: 18),
                        label: const Text('Set Up TOTP Authenticator'),
                      ),
                  ],
                ),
                if (_loadingSessions) ...[
                  const SizedBox(height: 12),
                  const LinearProgressIndicator(),
                ] else if (_sessions.isNotEmpty) ...[
                  const Divider(height: 24),
                  const Text(
                    'Active Login Sessions',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
                  ),
                  const SizedBox(height: 8),
                  ..._sessions.map((s) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            const Icon(Icons.devices_rounded, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                '${s.deviceLabel} • ${s.ipAddress}${s.isCurrent ? ' (Current)' : ''}',
                                style: const TextStyle(fontSize: 12.5),
                              ),
                            ),
                            if (!s.isCurrent)
                              TextButton(
                                onPressed: () async {
                                  await ref
                                      .read(authRepositoryProvider)
                                      .revokeSession(s.id);
                                  await _loadSessions();
                                },
                                child: const Text('Revoke'),
                              ),
                          ],
                        ),
                      )),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 5. Data Portability & Account Deletion
          GlowCard(
            accentColor: AppTheme.roseDanger,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.policy_outlined, color: AppTheme.roseDanger),
                    SizedBox(width: 8),
                    Text(
                      'Data Portability & Account Deletion',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('export_account_json_button'),
                      onPressed: _exportJsonData,
                      icon: const Icon(Icons.download_rounded, size: 17),
                      label: const Text('Export Account JSON'),
                    ),
                    OutlinedButton.icon(
                      key: const Key('delete_account_button'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.roseDanger,
                      ),
                      onPressed: _confirmPermanentAccountDeletion,
                      icon: const Icon(Icons.delete_forever_rounded, size: 17),
                      label: const Text('Delete Account'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
