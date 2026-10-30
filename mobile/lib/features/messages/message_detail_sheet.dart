import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/transport_status_badge.dart';
import '../../data/models/message_models.dart';
import '../../data/repositories/messaging_repository.dart';

class MessageDetailSheet extends ConsumerStatefulWidget {
  const MessageDetailSheet({
    super.key,
    required this.message,
    required this.onUpdated,
  });

  final SmsMessage message;
  final VoidCallback onUpdated;

  @override
  ConsumerState<MessageDetailSheet> createState() => _MessageDetailSheetState();
}

class _MessageDetailSheetState extends ConsumerState<MessageDetailSheet> {
  late SmsMessage _msg;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _msg = widget.message;
  }

  Future<void> _cancelMessage() async {
    setState(() => _busy = true);
    try {
      final updated = await ref.read(messagingRepositoryProvider).cancelMessage(_msg.id);
      if (!mounted) return;
      setState(() => _msg = updated);
      widget.onUpdated();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _approveReply() async {
    setState(() => _busy = true);
    try {
      final updated = await ref.read(messagingRepositoryProvider).approveReply(_msg.id);
      if (!mounted) return;
      setState(() => _msg = updated);
      widget.onUpdated();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      maxChildSize: 0.94,
      minChildSize: 0.45,
      builder: (context, scrollController) {
        return ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(20),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _msg.direction == 'inbound' ? 'Inbound SMS Detail' : 'Outbound SMS Detail',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TransportStatusBadge(
              status: _msg.status,
              isSimulation: _msg.isSimulation,
              transportType: _msg.transportType,
            ),
            const SizedBox(height: 14),
            GlowCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('From: ${_msg.senderNumber}'),
                  const SizedBox(height: 4),
                  Text('To: ${_msg.recipientNumber}'),
                  if (_msg.deviceName.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text('Gateway Device: ${_msg.deviceName}'),
                  ],
                  const Divider(height: 18),
                  SelectableText(
                    _msg.body,
                    style: const TextStyle(fontSize: 15, height: 1.4),
                  ),
                  if (_msg.matchedPolicySummary.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Policy: ${_msg.matchedPolicySummary}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppTheme.cyanAccent,
                          ),
                    ),
                  ],
                  if (_msg.failureReason.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Failure (${_msg.failureCode}): ${_msg.failureReason}',
                      style: const TextStyle(color: AppTheme.roseDanger, fontSize: 12.5),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (_msg.isPendingApproval || _msg.canCancel)
              Wrap(
                spacing: 10,
                runSpacing: 8,
                children: [
                  if (_msg.isPendingApproval)
                    FilledButton.icon(
                      onPressed: _busy ? null : _approveReply,
                      icon: const Icon(Icons.check_rounded, size: 18),
                      label: const Text('Approve Reply'),
                    ),
                  if (_msg.canCancel)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _cancelMessage,
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: const Text('Cancel Queued Message'),
                    ),
                ],
              ),
            const SizedBox(height: 16),
            const Text(
              'Transmission Attempts',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (_msg.attempts.isEmpty)
              const Text('No radio/provider attempts recorded yet.')
            else
              ..._msg.attempts.map((a) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GlowCard(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      'Attempt #${a.attemptNumber} • ${a.status.toUpperCase()}'
                      '${a.simSlot != null ? ' • SIM#${a.simSlot! + 1}' : ''}'
                      '${a.androidResultCode.isNotEmpty ? ' • ${a.androidResultCode}' : ''}'
                      '${a.errorDetail.isNotEmpty ? '\n${a.errorDetail}' : ''}',
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ),
                );
              }),
            const SizedBox(height: 12),
            const Text(
              'Delivery Events Timeline',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (_msg.deliveryEvents.isEmpty)
              const Text('No delivery events recorded yet.')
            else
              ..._msg.deliveryEvents.map((ev) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GlowCard(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${ev.eventType.toUpperCase()} '
                          '${ev.rawStatusCode.isNotEmpty ? '(${ev.rawStatusCode})' : ''}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                        ),
                        const SizedBox(height: 3),
                        Text(ev.description, style: const TextStyle(fontSize: 12.5)),
                      ],
                    ),
                  ),
                );
              }),
          ],
        );
      },
    );
  }
}
