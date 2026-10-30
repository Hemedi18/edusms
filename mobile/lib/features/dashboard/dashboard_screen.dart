import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/automation_models.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/automation_repository.dart';
import 'widgets/gateway_control_card.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  AnalyticsOverview? _overview;
  List<AutomationModeItem> _modes = const [];
  bool _loading = true;
  String? _offlineError;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadDashboard);
  }

  Future<void> _loadDashboard() async {
    setState(() {
      _loading = true;
      _offlineError = null;
    });
    try {
      final results = await Future.wait([
        ref.read(authRepositoryProvider).getAnalyticsOverview(days: 14),
        ref.read(automationRepositoryProvider).listModes(),
      ]);
      if (!mounted) return;
      setState(() {
        _overview = results[0] as AnalyticsOverview;
        _modes = results[1] as List<AutomationModeItem>;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _offlineError = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _activateMode(AutomationModeItem mode) async {
    try {
      await ref.read(automationRepositoryProvider).activateMode(mode.id);
      await _loadDashboard();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Activated mode "${mode.name}"')),
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

  @override
  Widget build(BuildContext context) {
    final overview = _overview;

    return Scaffold(
      appBar: AppBar(
        title: const Text('EduSMS Gateway'),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => context.push('/hub/notifications'),
            icon: const Icon(Icons.notifications_outlined),
          ),
          IconButton(
            tooltip: 'Compose SMS',
            onPressed: () => context.push('/messages/compose'),
            icon: const Icon(Icons.send_rounded),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loadDashboard,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_offlineError != null) ...[
              GlowCard(
                accentColor: AppTheme.amberWarning,
                child: Row(
                  children: [
                    const Icon(Icons.wifi_off_rounded, color: AppTheme.amberWarning),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _offlineError!,
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                    TextButton(
                      onPressed: _loadDashboard,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],
            const GatewayControlCard(),
            const SizedBox(height: 16),
            if (_loading && overview == null)
              const LoadingSkeleton(count: 3, height: 88)
            else if (overview != null) ...[
              _buildMetricsGrid(context, overview),
              const SizedBox(height: 16),
              _buildQuickModeSwitcher(context, overview),
              const SizedBox(height: 16),
              _buildActivityChart(context, overview),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildMetricsGrid(BuildContext context, AnalyticsOverview ov) {
    final cards = <({String label, String value, String sub, Color color, IconData icon})>[
      (
        label: 'Real SIM Submitted',
        value: '${ov.realOutboundSubmitted}',
        sub: '${ov.realOutboundDeliveredConfirmed} carrier delivered',
        color: AppTheme.electricViolet,
        icon: Icons.sim_card_outlined,
      ),
      (
        label: 'Simulated Sandbox',
        value: '${ov.simulatedOutbound + ov.simulatedInbound}',
        sub: '${ov.simulatedOutbound} out • ${ov.simulatedInbound} in',
        color: AppTheme.cyanAccent,
        icon: Icons.science_outlined,
      ),
      (
        label: 'Opted-In Contacts',
        value: '${ov.optedInContacts}/${ov.totalContacts}',
        sub: '${ov.suppressedCount} suppressed',
        color: AppTheme.emeraldSuccess,
        icon: Icons.verified_user_outlined,
      ),
      (
        label: 'Automation & Queue',
        value: '${ov.autoRepliesSent}',
        sub: '${ov.pendingHumanApproval} pending approval',
        color: AppTheme.electricBlue,
        icon: Icons.auto_awesome_outlined,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        mainAxisExtent: 108,
      ),
      itemBuilder: (context, index) {
        final item = cards[index];
        return GlowCard(
          padding: const EdgeInsets.all(13),
          accentColor: item.color,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(item.icon, size: 17, color: item.color),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
              Text(
                item.value,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              Text(
                item.sub,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: item.color,
                    ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildQuickModeSwitcher(BuildContext context, AnalyticsOverview ov) {
    return GlowCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Active Automation Mode',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
              ),
              Text(
                ov.activeModeName,
                style: const TextStyle(
                  color: AppTheme.electricViolet,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (_modes.isEmpty)
            const Text('No modes loaded yet.')
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _modes.map((m) {
                return ChoiceChip(
                  label: Text(m.name),
                  selected: m.isActive,
                  onSelected: (_) => _activateMode(m),
                );
              }).toList(),
            ),
        ],
      ),
    );
  }

  Widget _buildActivityChart(BuildContext context, AnalyticsOverview ov) {
    final recent = ov.timeseries.length > 7
        ? ov.timeseries.sublist(ov.timeseries.length - 7)
        : ov.timeseries;

    var maxTotal = 1;
    for (final row in recent) {
      final sum = ((row['real_outbound'] as num?)?.toInt() ?? 0) +
          ((row['real_inbound'] as num?)?.toInt() ?? 0) +
          ((row['sim_outbound'] as num?)?.toInt() ?? 0) +
          ((row['sim_inbound'] as num?)?.toInt() ?? 0);
      if (sum > maxTotal) maxTotal = sum;
    }

    return GlowCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '7-Day Traffic Breakdown (Real SIM vs Simulation)',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 110,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: recent.map((row) {
                final realCount = ((row['real_outbound'] as num?)?.toInt() ?? 0) +
                    ((row['real_inbound'] as num?)?.toInt() ?? 0);
                final simCount = ((row['sim_outbound'] as num?)?.toInt() ?? 0) +
                    ((row['sim_inbound'] as num?)?.toInt() ?? 0);
                final realH = (realCount / maxTotal) * 72;
                final simH = (simCount / maxTotal) * 72;
                final dateStr = (row['date'] ?? '').toString();
                final dayLabel = dateStr.length >= 10 ? dateStr.substring(5) : dateStr;

                return Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Container(
                            width: 8,
                            height: realH.clamp(4.0, 72.0),
                            decoration: BoxDecoration(
                              color: AppTheme.electricViolet,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                          const SizedBox(width: 3),
                          Container(
                            width: 8,
                            height: simH.clamp(4.0, 72.0),
                            decoration: BoxDecoration(
                              color: AppTheme.cyanAccent,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        dayLabel,
                        style: const TextStyle(fontSize: 10),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}
