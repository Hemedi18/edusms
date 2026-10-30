import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../auth/auth_controller.dart';

/// Hub screen giving one-tap access to Contacts, Simulation Lab, Developer Tools,
/// Notifications, and Settings & Security.
class HubMoreScreen extends ConsumerWidget {
  const HubMoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;

    final items = <({
      String title,
      String subtitle,
      IconData icon,
      Color accent,
      String route,
    })>[
      (
        title: 'Contacts, Groups & Consent',
        subtitle: '+255 E.164 normalization, CSV import, opt-in/out & effective policy',
        icon: Icons.contacts_outlined,
        accent: AppTheme.electricViolet,
        route: '/hub/contacts',
      ),
      (
        title: 'Simulation Lab',
        subtitle: 'Inject virtual inbound SMS, test auto-replies & seed/reset sandbox',
        icon: Icons.science_outlined,
        accent: AppTheme.cyanAccent,
        route: '/hub/simulation',
      ),
      (
        title: 'Developer API Keys & Webhooks',
        subtitle: 'Scoped API keys, HMAC-SHA256 webhooks, ping tests & delivery retries',
        icon: Icons.code_rounded,
        accent: AppTheme.electricBlue,
        route: '/hub/developers',
      ),
      (
        title: 'Notifications Center',
        subtitle: 'Gateway pairing alerts, campaign events & mark-all-read',
        icon: Icons.notifications_outlined,
        accent: AppTheme.amberWarning,
        route: '/hub/notifications',
      ),
      (
        title: 'Settings, Security & Privacy',
        subtitle: 'Dark/Light/System theme, TOTP MFA, sessions, retention & JSON export',
        icon: Icons.settings_outlined,
        accent: AppTheme.emeraldSuccess,
        route: '/hub/settings',
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Workspace Hub'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (user != null) ...[
            GlowCard(
              accentColor: AppTheme.electricViolet,
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: AppTheme.electricViolet.withValues(alpha: 0.2),
                    child: Text(
                      user.fullName.isNotEmpty
                          ? user.fullName.characters.first.toUpperCase()
                          : 'E',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: AppTheme.electricViolet,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user.fullName,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                        ),
                        Text(
                          '${user.email} • ${user.timezone}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],
          ...items.map((item) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: GlowCard(
                accentColor: item.accent,
                onTap: () => context.push(item.route),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(11),
                      decoration: BoxDecoration(
                        color: item.accent.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(item.icon, color: item.accent),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.title,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            item.subtitle,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
