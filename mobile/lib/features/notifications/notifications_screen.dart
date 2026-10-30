import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  List<NotificationItem> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadNotifications);
  }

  Future<void> _loadNotifications() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await ref.read(authRepositoryProvider).listNotifications();
      if (!mounted) return;
      setState(() {
        _items = list;
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

  Future<void> _markAllRead() async {
    try {
      final count = await ref.read(authRepositoryProvider).markAllNotificationsRead();
      await _loadNotifications();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Marked $count notification(s) as read')),
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

  Future<void> _markOneRead(NotificationItem item) async {
    if (item.isRead) return;
    try {
      await ref.read(authRepositoryProvider).markNotificationRead(item.id);
      await _loadNotifications();
    } catch (_) {
      // Keep UI responsive if offline
    }
  }

  Color _accentForLevel(String level) {
    return switch (level.toLowerCase()) {
      'error' || 'critical' => AppTheme.roseDanger,
      'warning' => AppTheme.amberWarning,
      'success' => AppTheme.emeraldSuccess,
      _ => AppTheme.electricViolet,
    };
  }

  IconData _iconForCategory(String category) {
    return switch (category.toLowerCase()) {
      'device' || 'gateway' => Icons.smartphone_rounded,
      'campaign' => Icons.campaign_rounded,
      'security' => Icons.shield_outlined,
      _ => Icons.notifications_active_outlined,
    };
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount = _items.where((n) => !n.isRead).length;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          unreadCount > 0 ? 'Notifications ($unreadCount unread)' : 'Notifications',
        ),
        actions: [
          if (unreadCount > 0)
            TextButton.icon(
              key: const Key('mark_all_notifications_read_button'),
              onPressed: _markAllRead,
              icon: const Icon(Icons.done_all_rounded, size: 18),
              label: const Text('Mark All Read'),
            ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loadNotifications,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadNotifications,
        child: _loading
            ? const Padding(
                padding: EdgeInsets.all(16),
                child: LoadingSkeleton(count: 4, height: 86),
              )
            : _error != null
                ? ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      GlowCard(
                        accentColor: AppTheme.roseDanger,
                        child: Text(_error!),
                      ),
                    ],
                  )
                : _items.isEmpty
                    ? ListView(
                        children: const [
                          SizedBox(height: 80),
                          EmptyStateView(
                            icon: Icons.notifications_none_rounded,
                            title: 'All Caught Up',
                            subtitle:
                                'Gateway heartbeat alerts, campaign milestones, and approval prompts appear here.',
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final accent = _accentForLevel(item.level);
                          return GlowCard(
                            accentColor: item.isRead ? null : accent,
                            onTap: () => _markOneRead(item),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(9),
                                  decoration: BoxDecoration(
                                    color: accent.withValues(alpha: 0.14),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Icon(_iconForCategory(item.category), color: accent, size: 20),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              item.title,
                                              style: TextStyle(
                                                fontWeight: item.isRead
                                                    ? FontWeight.w600
                                                    : FontWeight.w800,
                                                fontSize: 14.5,
                                              ),
                                            ),
                                          ),
                                          if (!item.isRead)
                                            Container(
                                              width: 8,
                                              height: 8,
                                              decoration: BoxDecoration(
                                                color: accent,
                                                shape: BoxShape.circle,
                                              ),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        item.body,
                                        style: Theme.of(context).textTheme.bodySmall,
                                      ),
                                      if (item.createdAt.isNotEmpty) ...[
                                        const SizedBox(height: 6),
                                        Text(
                                          item.createdAt,
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(fontSize: 11),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
      ),
    );
  }
}
