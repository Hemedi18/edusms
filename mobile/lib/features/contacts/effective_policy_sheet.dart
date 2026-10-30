import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../data/models/contact_models.dart';
import '../../data/repositories/contacts_repository.dart';

class EffectivePolicySheet extends ConsumerStatefulWidget {
  const EffectivePolicySheet({
    super.key,
    required this.contactId,
    required this.contactName,
  });

  final String contactId;
  final String contactName;

  @override
  ConsumerState<EffectivePolicySheet> createState() => _EffectivePolicySheetState();
}

class _EffectivePolicySheetState extends ConsumerState<EffectivePolicySheet> {
  EffectivePolicy? _policy;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    try {
      final pol =
          await ref.read(contactsRepositoryProvider).getEffectivePolicy(widget.contactId);
      if (mounted) setState(() => _policy = pol);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _policy;

    return Padding(
      padding: const EdgeInsets.all(20),
      child: _error != null
          ? Text(_error!, style: const TextStyle(color: AppTheme.roseDanger))
          : p == null
              ? const SizedBox(
                  height: 160,
                  child: Center(child: CircularProgressIndicator()),
                )
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Effective Policy: ${widget.contactName}',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                      Text(
                        p.phoneNumber,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 14),
                      GlowCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _PolicyFlagRow('Can Send Outgoing SMS', p.canSendOutgoing),
                            _PolicyFlagRow('Can Send Auto-Replies', p.canAutoReply),
                            _PolicyFlagRow('Can Use AI Replies', p.canAiReply),
                            _PolicyFlagRow('Explicit Opt-In Recorded', p.optInStatus),
                            const Divider(height: 18),
                            Text('Effective Mode: ${p.effectiveModeName} (${p.effectiveModeSource})'),
                            Text('Cooldown Window: ${p.effectiveCooldownMinutes} min'),
                            if (p.inQuietHours)
                              const Text(
                                'Currently inside Quiet Hours',
                                style: TextStyle(color: AppTheme.amberWarning),
                              ),
                          ],
                        ),
                      ),
                      if (p.blockingReasons.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        GlowCard(
                          accentColor: AppTheme.roseDanger,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Blocking Reasons',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.roseDanger,
                                ),
                              ),
                              const SizedBox(height: 4),
                              ...p.blockingReasons.map((r) => Text('• $r')),
                            ],
                          ),
                        ),
                      ],
                      if (p.inheritanceTrace.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        GlowCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Policy Precedence Trace',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 4),
                              ...p.inheritanceTrace.map(
                                (t) => Text('• $t', style: const TextStyle(fontSize: 12.5)),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }
}

class _PolicyFlagRow extends StatelessWidget {
  const _PolicyFlagRow(this.label, this.allowed);

  final String label;
  final bool allowed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(
            allowed ? Icons.check_circle_rounded : Icons.block_rounded,
            size: 17,
            color: allowed ? AppTheme.emeraldSuccess : AppTheme.roseDanger,
          ),
          const SizedBox(width: 8),
          Text(label),
        ],
      ),
    );
  }
}
