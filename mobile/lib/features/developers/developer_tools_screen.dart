import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/developer_models.dart';
import '../../data/repositories/developer_repository.dart';

class DeveloperToolsScreen extends ConsumerStatefulWidget {
  const DeveloperToolsScreen({super.key});

  @override
  ConsumerState<DeveloperToolsScreen> createState() => _DeveloperToolsScreenState();
}

class _DeveloperToolsScreenState extends ConsumerState<DeveloperToolsScreen> {
  List<ApiKeyItem> _apiKeys = const [];
  List<WebhookEndpointItem> _webhooks = const [];
  List<WebhookDeliveryEventItem> _deliveries = const [];
  bool _loading = true;
  String? _error;

  static const _availableScopes = <String>[
    'messages:read',
    'messages:write',
    'contacts:read',
    'contacts:write',
    'campaigns:read',
    'simulation:write',
  ];

  static const _availableWebhookEvents = <String>[
    'message.inbound',
    'message.status',
    'campaign.completed',
    'device.offline',
  ];

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadAll);
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(developerRepositoryProvider);
      final results = await Future.wait([
        repo.listApiKeys(),
        repo.listWebhooks(),
        repo.listWebhookDeliveries(),
      ]);
      if (!mounted) return;
      setState(() {
        _apiKeys = results[0] as List<ApiKeyItem>;
        _webhooks = results[1] as List<WebhookEndpointItem>;
        _deliveries = results[2] as List<WebhookDeliveryEventItem>;
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

  Future<void> _showOneTimeSecretDialog({
    required String title,
    required String subtitle,
    required String secretValue,
  }) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        key: const Key('raw_api_key_dialog'),
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(subtitle, style: Theme.of(ctx).textTheme.bodySmall),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(ctx).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: SelectableText(
                secretValue,
                style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        actions: [
          OutlinedButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: secretValue));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Copied secret to clipboard')),
              );
            },
            icon: const Icon(Icons.copy_rounded, size: 16),
            label: const Text('Copy'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _openCreateApiKeySheet() async {
    final nameCtrl = TextEditingController();
    final selectedScopes = <String>{'messages:read', 'messages:write', 'simulation:write'};
    var simulationOnly = true;

    final created = await showModalBottomSheet<ApiKeyItem>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          return Padding(
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
                    'Create Scoped API Key',
                    style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Key Label',
                      hintText: 'e.g. Student Portal Integration',
                    ),
                  ),
                  const SizedBox(height: 12),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Simulation-Only Sandbox Key'),
                    subtitle: const Text(
                      'Blocks real cellular SIM charges when enabled',
                    ),
                    value: simulationOnly,
                    onChanged: (v) => setSheetState(() => simulationOnly = v),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Scopes',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: _availableScopes.map((scope) {
                      final active = selectedScopes.contains(scope);
                      return FilterChip(
                        label: Text(scope),
                        selected: active,
                        onSelected: (v) {
                          setSheetState(() {
                            if (v) {
                              selectedScopes.add(scope);
                            } else if (selectedScopes.length > 1) {
                              selectedScopes.remove(scope);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      if (nameCtrl.text.trim().isEmpty) return;
                      try {
                        final item = await ref.read(developerRepositoryProvider).createApiKey(
                              name: nameCtrl.text,
                              scopes: selectedScopes.toList(),
                              simulationOnly: simulationOnly,
                            );
                        if (ctx.mounted) Navigator.of(ctx).pop(item);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text(e.toString())),
                          );
                        }
                      }
                    },
                    child: const Text('Generate API Key'),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );

    if (created != null) {
      await _loadAll();
      if (created.rawKeyOnce != null && created.rawKeyOnce!.isNotEmpty && mounted) {
        await _showOneTimeSecretDialog(
          title: 'Copy Your One-Time API Key',
          subtitle:
              'Store this key securely now. EduSMS hashes keys at rest and will only show the prefix hereafter.',
          secretValue: created.rawKeyOnce!,
        );
      }
    }
  }

  Future<void> _openCreateWebhookSheet() async {
    final nameCtrl = TextEditingController();
    final urlCtrl = TextEditingController();
    final selectedEvents = <String>{'message.inbound', 'message.status'};
    var includeSim = true;

    final created = await showModalBottomSheet<WebhookEndpointItem>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) {
          return Padding(
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
                    'Register HMAC-SHA256 Webhook',
                    style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Endpoint Name',
                      hintText: 'e.g. Attendance ERP Callback',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: urlCtrl,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'Target HTTPS / Local URL',
                      hintText: 'https://erp.school.ac.tz/webhooks/edusms',
                    ),
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Include Simulation Lab Events'),
                    value: includeSim,
                    onChanged: (v) => setSheetState(() => includeSim = v),
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    children: _availableWebhookEvents.map((ev) {
                      final active = selectedEvents.contains(ev);
                      return FilterChip(
                        label: Text(ev),
                        selected: active,
                        onSelected: (v) {
                          setSheetState(() {
                            if (v) {
                              selectedEvents.add(ev);
                            } else if (selectedEvents.length > 1) {
                              selectedEvents.remove(ev);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      if (nameCtrl.text.trim().isEmpty || urlCtrl.text.trim().isEmpty) return;
                      try {
                        final item = await ref.read(developerRepositoryProvider).createWebhook(
                              name: nameCtrl.text,
                              url: urlCtrl.text,
                              events: selectedEvents.toList(),
                              includeSimulationEvents: includeSim,
                            );
                        if (ctx.mounted) Navigator.of(ctx).pop(item);
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            SnackBar(content: Text(e.toString())),
                          );
                        }
                      }
                    },
                    child: const Text('Create Webhook'),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );

    if (created != null) {
      await _loadAll();
      if (created.rawSigningSecretOnce != null &&
          created.rawSigningSecretOnce!.isNotEmpty &&
          mounted) {
        await _showOneTimeSecretDialog(
          title: 'Copy Webhook Signing Secret',
          subtitle: 'Verify X-EduSMS-Signature (HMAC-SHA256) using this secret:',
          secretValue: created.rawSigningSecretOnce!,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Developer API & Webhooks'),
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loadAll,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(text: 'API Keys'),
              Tab(text: 'Webhooks & Logs'),
            ],
          ),
        ),
        body: _loading
            ? const Padding(
                padding: EdgeInsets.all(16),
                child: LoadingSkeleton(count: 3, height: 100),
              )
            : TabBarView(
                children: [
                  _buildApiKeysTab(context),
                  _buildWebhooksTab(context),
                ],
              ),
      ),
    );
  }

  Widget _buildApiKeysTab(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _loadAll,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!, style: const TextStyle(color: AppTheme.roseDanger)),
            const SizedBox(height: 12),
          ],
          FilledButton.icon(
            key: const Key('open_create_api_key_button'),
            onPressed: _openCreateApiKeySheet,
            icon: const Icon(Icons.vpn_key_outlined, size: 18),
            label: const Text('Create Scoped API Key'),
          ),
          const SizedBox(height: 14),
          if (_apiKeys.isEmpty)
            const EmptyStateView(
              icon: Icons.vpn_key_outlined,
              title: 'No API Keys Provisioned',
              subtitle:
                  'Create a scoped key to send or simulate SMS from school portals and backend scripts.',
            )
          else
            ..._apiKeys.map((key) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: GlowCard(
                  accentColor: key.isActiveKey
                      ? (key.simulationOnly ? AppTheme.cyanAccent : AppTheme.electricViolet)
                      : const Color(0xFF64748B),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              key.name,
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (key.simulationOnly
                                      ? AppTheme.cyanAccent
                                      : AppTheme.electricViolet)
                                  .withValues(alpha: 0.16),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              key.simulationOnly ? 'SIMULATION ONLY' : 'LIVE + SIM',
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: key.simulationOnly
                                    ? AppTheme.cyanAccent
                                    : AppTheme.electricViolet,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${key.keyPrefix}•••••••• • ${key.rateLimitPerMinute}/min',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: key.scopes
                            .map((s) => Chip(
                                  label: Text(s, style: const TextStyle(fontSize: 11)),
                                  visualDensity: VisualDensity.compact,
                                ))
                            .toList(),
                      ),
                      if (key.isActiveKey) ...[
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed: () async {
                                final rotated = await ref
                                    .read(developerRepositoryProvider)
                                    .rotateApiKey(key.id);
                                await _loadAll();
                                if (rotated.rawKeyOnce != null &&
                                    rotated.rawKeyOnce!.isNotEmpty &&
                                    mounted) {
                                  await _showOneTimeSecretDialog(
                                    title: 'Rotated API Key',
                                    subtitle: 'Previous key invalidated. Copy your new key now:',
                                    secretValue: rotated.rawKeyOnce!,
                                  );
                                }
                              },
                              icon: const Icon(Icons.autorenew_rounded, size: 16),
                              label: const Text('Rotate'),
                            ),
                            OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppTheme.roseDanger,
                              ),
                              onPressed: () async {
                                await ref
                                    .read(developerRepositoryProvider)
                                    .revokeApiKey(key.id);
                                await _loadAll();
                              },
                              icon: const Icon(Icons.block_rounded, size: 16),
                              label: const Text('Revoke'),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  Widget _buildWebhooksTab(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _loadAll,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FilledButton.icon(
            key: const Key('open_create_webhook_button'),
            onPressed: _openCreateWebhookSheet,
            icon: const Icon(Icons.webhook_rounded, size: 18),
            label: const Text('Register Webhook Endpoint'),
          ),
          const SizedBox(height: 14),
          if (_webhooks.isEmpty)
            const EmptyStateView(
              icon: Icons.webhook_rounded,
              title: 'No Webhooks Registered',
              subtitle:
                  'Receive signed HMAC-SHA256 callbacks when inbound SMS arrive or delivery receipts update.',
            )
          else
            ..._webhooks.map((wh) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: GlowCard(
                  accentColor: AppTheme.electricBlue,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        wh.name,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                      const SizedBox(height: 2),
                      Text(wh.url, style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 6),
                      Text(
                        'Events: ${wh.events.join(', ')}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () async {
                              final messenger = ScaffoldMessenger.of(this.context);
                              try {
                                await ref
                                    .read(developerRepositoryProvider)
                                    .testWebhook(wh.id);
                                await _loadAll();
                                if (mounted) {
                                  messenger.showSnackBar(
                                    const SnackBar(content: Text('Dispatched test ping!')),
                                  );
                                }
                              } catch (e) {
                                if (mounted) {
                                  messenger.showSnackBar(
                                    SnackBar(content: Text(e.toString())),
                                  );
                                }
                              }
                            },
                            icon: const Icon(Icons.bolt_rounded, size: 16),
                            label: const Text('Test Ping'),
                          ),
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppTheme.roseDanger,
                            ),
                            onPressed: () async {
                              await ref
                                  .read(developerRepositoryProvider)
                                  .deleteWebhook(wh.id);
                              await _loadAll();
                            },
                            icon: const Icon(Icons.delete_outline_rounded, size: 16),
                            label: const Text('Delete'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          const SizedBox(height: 12),
          Text(
            'Recent Webhook Deliveries (${_deliveries.length})',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          ..._deliveries.map((del) {
            final ok = del.status == 'delivered' || del.status == 'succeeded';
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GlowCard(
                accentColor: ok ? AppTheme.emeraldSuccess : AppTheme.amberWarning,
                child: Row(
                  children: [
                    Icon(
                      ok ? Icons.check_circle_outline_rounded : Icons.schedule_send_rounded,
                      color: ok ? AppTheme.emeraldSuccess : AppTheme.amberWarning,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${del.eventType} -> ${del.endpointName}',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                          ),
                          Text(
                            'Status: ${del.status} • Attempts: ${del.attemptCount}'
                            '${del.lastError.isNotEmpty ? ' • ${del.lastError}' : ''}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () async {
                        await ref
                            .read(developerRepositoryProvider)
                            .retryWebhookDelivery(del.id);
                        await _loadAll();
                      },
                      child: const Text('Retry'),
                    ),
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
