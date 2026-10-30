import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../core/widgets/transport_status_badge.dart';
import '../../data/models/message_models.dart';
import '../../data/repositories/messaging_repository.dart';
import 'message_detail_sheet.dart';

enum MessageFilterTab {
  all,
  realSim,
  simulation,
  autoReplies,
  pendingApproval,
}

class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key});

  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  final _searchCtrl = TextEditingController();
  MessageFilterTab _filter = MessageFilterTab.all;
  List<SmsMessage> _messages = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadMessages);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMessages() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ref.read(messagingRepositoryProvider).listMessages(
            search: _searchCtrl.text,
            isSimulation: switch (_filter) {
              MessageFilterTab.realSim => false,
              MessageFilterTab.simulation => true,
              _ => null,
            },
            isAutoReply: _filter == MessageFilterTab.autoReplies ? true : null,
            status: _filter == MessageFilterTab.pendingApproval ? 'pending_approval' : null,
          );
      if (!mounted) return;
      setState(() {
        _messages = list;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _openDetail(SmsMessage msg) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => MessageDetailSheet(
        message: msg,
        onUpdated: _loadMessages,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Messages'),
        actions: [
          IconButton(
            tooltip: 'Simulation Lab',
            onPressed: () => context.push('/hub/simulation'),
            icon: const Icon(Icons.science_outlined),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loadMessages,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/messages/compose');
          if (mounted) _loadMessages();
        },
        icon: const Icon(Icons.edit_outlined),
        label: const Text('Compose SMS'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _loadMessages(),
              decoration: InputDecoration(
                hintText: 'Search phone number, body, or policy...',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  onPressed: _loadMessages,
                  icon: const Icon(Icons.arrow_forward_rounded),
                ),
              ),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                for (final entry in <(MessageFilterTab, String)>[
                  (MessageFilterTab.all, 'All'),
                  (MessageFilterTab.realSim, 'Real SIM'),
                  (MessageFilterTab.simulation, 'Simulation'),
                  (MessageFilterTab.autoReplies, 'Auto-Replies'),
                  (MessageFilterTab.pendingApproval, 'Pending Approval'),
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(entry.$2),
                      selected: _filter == entry.$1,
                      onSelected: (_) {
                        setState(() => _filter = entry.$1);
                        _loadMessages();
                      },
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: LoadingSkeleton(count: 4),
                  )
                : _error != null
                    ? EmptyStateView(
                        icon: Icons.cloud_off_rounded,
                        title: 'Could Not Load Messages',
                        subtitle: _error!,
                        actionLabel: 'Retry',
                        onAction: _loadMessages,
                      )
                    : _messages.isEmpty
                        ? EmptyStateView(
                            icon: Icons.inbox_outlined,
                            title: 'No Messages Found',
                            subtitle:
                                'Compose an outbound SMS or inject a virtual inbound SMS in Simulation Lab.',
                            actionLabel: 'Compose SMS',
                            onAction: () => context.push('/messages/compose'),
                          )
                        : RefreshIndicator(
                            onRefresh: _loadMessages,
                            child: ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 4, 16, 88),
                              itemCount: _messages.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 10),
                              itemBuilder: (context, idx) {
                                final m = _messages[idx];
                                final isInbound = m.direction == 'inbound';
                                final peer = isInbound ? m.senderNumber : m.recipientNumber;
                                return GlowCard(
                                  onTap: () => _openDetail(m),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Icon(
                                            isInbound
                                                ? Icons.call_received_rounded
                                                : Icons.call_made_rounded,
                                            size: 17,
                                          ),
                                          const SizedBox(width: 6),
                                          Expanded(
                                            child: Text(
                                              m.contactName.isNotEmpty
                                                  ? '${m.contactName} ($peer)'
                                                  : peer,
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ),
                                          if (m.isAutoReply)
                                            const Padding(
                                              padding: EdgeInsets.only(left: 6),
                                              child: Icon(Icons.auto_awesome, size: 15),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        m.body,
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 10),
                                      TransportStatusBadge(
                                        status: m.status,
                                        isSimulation: m.isSimulation,
                                        transportType: m.transportType,
                                        compact: true,
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}
