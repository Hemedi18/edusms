import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../core/widgets/transport_status_badge.dart';
import '../../data/models/campaign_models.dart';
import '../../data/models/contact_models.dart';
import '../../data/repositories/campaigns_repository.dart';
import '../../data/repositories/contacts_repository.dart';
import 'sender_identities_sheet.dart';

class CampaignsScreen extends ConsumerStatefulWidget {
  const CampaignsScreen({super.key});

  @override
  ConsumerState<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends ConsumerState<CampaignsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 2, vsync: this);

  List<CampaignItem> _campaigns = const [];
  List<ContactGroupItem> _groups = const [];
  bool _loading = true;

  // Campaign Builder fields
  final _nameCtrl = TextEditingController();
  final _templateCtrl = TextEditingController(
    text: 'Dear {{contact_name}}, parent-teacher conference begins Friday at 09:00.',
  );
  final _rawNumbersCtrl = TextEditingController();
  String _transportType = 'simulation';
  final Set<String> _selectedGroupIds = <String>{};
  AudiencePreviewResult? _audiencePreview;
  String? _builderError;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadAll);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _nameCtrl.dispose();
    _templateCtrl.dispose();
    _rawNumbersCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() => _loading = true);
    try {
      final res = await Future.wait([
        ref.read(campaignsRepositoryProvider).listCampaigns(),
        ref.read(contactsRepositoryProvider).listGroups(),
      ]);
      if (!mounted) return;
      setState(() {
        _campaigns = res[0] as List<CampaignItem>;
        _groups = res[1] as List<ContactGroupItem>;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<String> _parsedRawNumbers() {
    return _rawNumbersCtrl.text
        .split(RegExp(r'[\n,]'))
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }

  Future<void> _previewAudience() async {
    setState(() => _builderError = null);
    try {
      final preview = await ref.read(campaignsRepositoryProvider).previewAudience(
            messageTemplate: _templateCtrl.text,
            transportType: _transportType,
            groupIds: _selectedGroupIds.toList(),
            rawNumbers: _parsedRawNumbers(),
          );
      if (mounted) setState(() => _audiencePreview = preview);
    } catch (e) {
      if (mounted) setState(() => _builderError = e.toString());
    }
  }

  Future<void> _createCampaign() async {
    if (_nameCtrl.text.trim().isEmpty || _templateCtrl.text.trim().isEmpty) {
      setState(() => _builderError = 'Campaign name and message template are required.');
      return;
    }
    try {
      await ref.read(campaignsRepositoryProvider).createCampaign(
            name: _nameCtrl.text,
            messageTemplate: _templateCtrl.text,
            transportType: _transportType,
            groupIds: _selectedGroupIds.toList(),
            rawNumbers: _parsedRawNumbers(),
          );
      _nameCtrl.clear();
      _rawNumbersCtrl.clear();
      setState(() {
        _audiencePreview = null;
        _builderError = null;
      });
      await _loadAll();
      _tabController.animateTo(0);
    } catch (e) {
      if (mounted) setState(() => _builderError = e.toString());
    }
  }

  Future<void> _openRecipientsSheet(CampaignItem camp) async {
    final recipients =
        await ref.read(campaignsRepositoryProvider).listRecipients(camp.id);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.65,
        builder: (ctx, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Recipients: ${camp.name}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const SizedBox(height: 12),
            if (recipients.isEmpty)
              const Text('No recipient records.')
            else
              ...recipients.map((r) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GlowCard(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${r.recipientName.isNotEmpty ? "${r.recipientName} • " : ""}${r.phoneNumber} (${r.status.toUpperCase()})',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                        ),
                        if (r.exclusionReason.isNotEmpty)
                          Text(
                            'Excluded: ${r.exclusionReason}',
                            style: const TextStyle(color: AppTheme.amberWarning, fontSize: 12),
                          ),
                        if (r.errorDetail.isNotEmpty)
                          Text(
                            'Error: ${r.errorDetail}',
                            style: const TextStyle(color: AppTheme.roseDanger, fontSize: 12),
                          ),
                      ],
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  Future<void> _openTestSendDialog(CampaignItem camp) async {
    final phoneCtrl = TextEditingController(text: '+255754100201');
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Test Send: ${camp.name}'),
        content: TextField(
          controller: phoneCtrl,
          decoration: const InputDecoration(labelText: 'Test Recipient Phone Number'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              await ref.read(campaignsRepositoryProvider).testSendCampaign(
                    campaignId: camp.id,
                    recipientNumber: phoneCtrl.text,
                  );
              if (ctx.mounted) Navigator.of(ctx).pop();
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Test message dispatched.')),
                );
              }
            },
            child: const Text('Send Test'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bulk Campaigns'),
        actions: [
          IconButton(
            tooltip: 'Sender Identities',
            onPressed: () {
              showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => const SenderIdentitiesSheet(),
              );
            },
            icon: const Icon(Icons.badge_outlined),
          ),
          IconButton(
            onPressed: _loadAll,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Campaigns'),
            Tab(text: 'Campaign Builder'),
          ],
        ),
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(16), child: LoadingSkeleton(count: 3))
          : TabBarView(
              controller: _tabController,
              children: [
                _buildCampaignsListTab(),
                _buildCampaignBuilderTab(),
              ],
            ),
    );
  }

  Widget _buildCampaignsListTab() {
    if (_campaigns.isEmpty) {
      return EmptyStateView(
        icon: Icons.campaign_outlined,
        title: 'No Campaigns Yet',
        subtitle: 'Build a consent-checked campaign with live audience preview.',
        actionLabel: 'Open Builder',
        onAction: () => _tabController.animateTo(1),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _campaigns.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, idx) {
        final c = _campaigns[idx];
        return GlowCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      c.name,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ),
                  TransportStatusBadge(
                    status: c.status,
                    isSimulation: c.isSimulation,
                    transportType: c.transportType,
                    compact: true,
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                c.messageTemplate,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 10),
              LinearProgressIndicator(
                value: c.stats.completionFraction,
                borderRadius: BorderRadius.circular(999),
              ),
              const SizedBox(height: 6),
              Text(
                'Eligible: ${c.stats.eligibleRecipients} • Excluded: ${c.stats.excludedRecipients} • '
                'Submitted: ${c.stats.sentOrSubmittedCount} • Delivered: ${c.stats.deliveredCount} • Failed: ${c.stats.failedCount}',
                style: Theme.of(context).textTheme.labelSmall,
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  if (c.status == 'draft' || c.status == 'scheduled')
                    FilledButton.tonal(
                      onPressed: () async {
                        await ref.read(campaignsRepositoryProvider).startCampaign(c.id);
                        _loadAll();
                      },
                      child: const Text('Start'),
                    ),
                  if (c.status == 'running') ...[
                    OutlinedButton(
                      onPressed: () async {
                        await ref.read(campaignsRepositoryProvider).processBatch(c.id);
                        _loadAll();
                      },
                      child: const Text('Process Batch'),
                    ),
                    OutlinedButton(
                      onPressed: () async {
                        await ref.read(campaignsRepositoryProvider).pauseCampaign(c.id);
                        _loadAll();
                      },
                      child: const Text('Pause'),
                    ),
                  ],
                  if (c.status == 'paused')
                    FilledButton.tonal(
                      onPressed: () async {
                        await ref.read(campaignsRepositoryProvider).resumeCampaign(c.id);
                        _loadAll();
                      },
                      child: const Text('Resume'),
                    ),
                  if (c.status != 'completed' && c.status != 'canceled')
                    OutlinedButton(
                      onPressed: () async {
                        await ref.read(campaignsRepositoryProvider).cancelCampaign(c.id);
                        _loadAll();
                      },
                      child: const Text('Cancel'),
                    ),
                  OutlinedButton(
                    onPressed: () => _openTestSendDialog(c),
                    child: const Text('Test Send'),
                  ),
                  TextButton(
                    onPressed: () => _openRecipientsSheet(c),
                    child: const Text('Recipients'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildCampaignBuilderTab() {
    final preview = _audiencePreview;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_builderError != null) ...[
          GlowCard(
            accentColor: AppTheme.roseDanger,
            child: Text(_builderError!, style: const TextStyle(color: AppTheme.roseDanger)),
          ),
          const SizedBox(height: 12),
        ],
        GlowCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const Key('campaign_name_input'),
                controller: _nameCtrl,
                decoration: const InputDecoration(labelText: 'Campaign Name'),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('Simulation Sandbox'),
                    selected: _transportType == 'simulation',
                    onSelected: (_) => setState(() => _transportType = 'simulation'),
                  ),
                  ChoiceChip(
                    label: const Text('Android SIM Gateway'),
                    selected: _transportType == 'sim_gateway',
                    onSelected: (_) => setState(() => _transportType = 'sim_gateway'),
                  ),
                  ChoiceChip(
                    label: const Text('External Provider'),
                    selected: _transportType == 'external_provider',
                    onSelected: (_) => setState(() => _transportType = 'external_provider'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (_groups.isNotEmpty) ...[
                const Text('Target Contact Groups', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: _groups.map((g) {
                    final selected = _selectedGroupIds.contains(g.id);
                    return FilterChip(
                      label: Text('${g.name} (${g.memberCount})'),
                      selected: selected,
                      onSelected: (v) {
                        setState(() {
                          if (v) {
                            _selectedGroupIds.add(g.id);
                          } else {
                            _selectedGroupIds.remove(g.id);
                          }
                        });
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                key: const Key('campaign_raw_numbers_input'),
                controller: _rawNumbersCtrl,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Additional Numbers (comma or newline separated)',
                  hintText: '+255754100201, +255754100202',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('campaign_template_input'),
                controller: _templateCtrl,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Message Template ({{contact_name}} supported)',
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('campaign_preview_audience_button'),
                      onPressed: _previewAudience,
                      icon: const Icon(Icons.visibility_outlined, size: 18),
                      label: const Text('Preview Audience'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      key: const Key('campaign_create_button'),
                      onPressed: _createCampaign,
                      icon: const Icon(Icons.rocket_launch_outlined, size: 18),
                      label: const Text('Save Draft'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (preview != null) ...[
          const SizedBox(height: 14),
          GlowCard(
            key: const Key('campaign_audience_preview_card'),
            accentColor: AppTheme.emeraldSuccess,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Audience Eligibility Preview',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
                const SizedBox(height: 6),
                Text(
                  'Total Input: ${preview.totalInputCount} • Eligible: ${preview.eligibleCount} • '
                  'Excluded (Opt-Out/Suppressed): ${preview.excludedCount} • '
                  'Duplicates Removed: ${preview.duplicateRemovedCount}',
                ),
                if (preview.samplePreview.isNotEmpty) ...[
                  const Divider(height: 16),
                  Text('Rendered Sample: ${preview.samplePreview}'),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}
