import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/automation_models.dart';
import '../../data/repositories/automation_repository.dart';
import '../auth/auth_controller.dart';

class AutomationScreen extends ConsumerStatefulWidget {
  const AutomationScreen({super.key});

  @override
  ConsumerState<AutomationScreen> createState() => _AutomationScreenState();
}

class _AutomationScreenState extends ConsumerState<AutomationScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 3, vsync: this);

  bool _globalAuto = true;
  bool _globalAi = false;
  List<AutomationModeItem> _modes = const [];
  List<AutoReplyRuleItem> _rules = const [];
  List<ScheduleWindowItem> _schedules = const [];
  List<AiProviderItem> _providers = const [];
  List<AiCallLogItem> _aiLogs = const [];
  bool _loading = true;

  // Dry-run tester state
  final _dryRunSenderCtrl = TextEditingController(text: '+255754100201');
  final _dryRunBodyCtrl = TextEditingController(text: 'FEES');
  RuleDryRunResult? _dryRunResult;

  // AI prompt tester state
  final _aiPromptCtrl = TextEditingController(text: 'When does semester registration close?');
  String? _aiPromptReply;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authControllerProvider).user;
    if (user != null) {
      _globalAuto = user.globalAutomationEnabled;
      _globalAi = user.globalAiEnabled;
    }
    Future.microtask(_loadAll);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _dryRunSenderCtrl.dispose();
    _dryRunBodyCtrl.dispose();
    _aiPromptCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() => _loading = true);
    try {
      final repo = ref.read(automationRepositoryProvider);
      final res = await Future.wait([
        repo.listModes(),
        repo.listRules(),
        repo.listSchedules(),
        repo.listAiProviders(),
        repo.listAiLogs(),
      ]);
      if (!mounted) return;
      setState(() {
        _modes = res[0] as List<AutomationModeItem>;
        _rules = res[1] as List<AutoReplyRuleItem>;
        _schedules = res[2] as List<ScheduleWindowItem>;
        _providers = res[3] as List<AiProviderItem>;
        _aiLogs = res[4] as List<AiCallLogItem>;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleGlobals({bool? auto, bool? ai}) async {
    final res = await ref.read(automationRepositoryProvider).toggleGlobalSwitches(
          globalAutomationEnabled: auto,
          globalAiEnabled: ai,
        );
    if (!mounted) return;
    setState(() {
      _globalAuto = res['global_automation_enabled'] ?? _globalAuto;
      _globalAi = res['global_ai_enabled'] ?? _globalAi;
    });
  }

  Future<void> _runRuleTester() async {
    if (_dryRunBodyCtrl.text.trim().isEmpty) return;
    final res = await ref.read(automationRepositoryProvider).testRuleDryRun(
          senderNumber: _dryRunSenderCtrl.text,
          body: _dryRunBodyCtrl.text,
        );
    if (mounted) setState(() => _dryRunResult = res);
  }

  Future<void> _openCreateRuleDialog() async {
    final nameCtrl = TextEditingController();
    final keywordsCtrl = TextEditingController();
    final replyCtrl = TextEditingController(
      text: 'Hello {{contact_name}}, tuition fee details are available at the bursar office.',
    );
    var matchMode = 'contains';

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('New Auto-Reply Rule'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(labelText: 'Rule Name'),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  children: ['contains', 'exact', 'starts_with', 'whole_word', 'regex']
                      .map(
                        (m) => ChoiceChip(
                          label: Text(m),
                          selected: matchMode == m,
                          onSelected: (_) => setDialogState(() => matchMode = m),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: keywordsCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Keywords / Regex Patterns (comma-separated)',
                    hintText: 'FEES, TUITION',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: replyCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Response Template'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                final kws = keywordsCtrl.text
                    .split(',')
                    .map((s) => s.trim())
                    .where((s) => s.isNotEmpty)
                    .toList();
                if (nameCtrl.text.trim().isEmpty || kws.isEmpty) return;
                await ref.read(automationRepositoryProvider).createRule(
                      name: nameCtrl.text,
                      matchMode: matchMode,
                      keywords: kws,
                      responseTemplate: replyCtrl.text,
                    );
                if (ctx.mounted) Navigator.of(ctx).pop();
                _loadAll();
              },
              child: const Text('Create Rule'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openCreateScheduleDialog() async {
    final nameCtrl = TextEditingController(text: 'After Hours Window');
    final startCtrl = TextEditingController(text: '17:00:00');
    final endCtrl = TextEditingController(text: '07:30:00');
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Create Schedule Window'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: 'Schedule Name'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: startCtrl,
              decoration: const InputDecoration(labelText: 'Start Time (HH:MM:SS)'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: endCtrl,
              decoration: const InputDecoration(labelText: 'End Time (HH:MM:SS)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              await ref.read(automationRepositoryProvider).createSchedule(
                    name: nameCtrl.text,
                    daysOfWeek: const [0, 1, 2, 3, 4],
                    startTime: startCtrl.text,
                    endTime: endCtrl.text,
                  );
              if (ctx.mounted) Navigator.of(ctx).pop();
              _loadAll();
            },
            child: const Text('Save Schedule'),
          ),
        ],
      ),
    );
  }

  Future<void> _openAddAiProviderDialog() async {
    final nameCtrl = TextEditingController(text: 'Campus AI Assistant');
    final modelCtrl = TextEditingController(text: 'edusms-mock-v1');
    final keyCtrl = TextEditingController();
    var providerType = 'deterministic_mock';

    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Configure AI Provider'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(labelText: 'Provider Label'),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  children: [
                    ('deterministic_mock', 'Mock'),
                    ('gemini', 'Gemini'),
                    ('openai_compatible', 'OpenAI'),
                  ].map((item) {
                    return ChoiceChip(
                      label: Text(item.$2),
                      selected: providerType == item.$1,
                      onSelected: (_) {
                        setDialogState(() {
                          providerType = item.$1;
                          modelCtrl.text = switch (providerType) {
                            'gemini' => 'gemini-2.5-flash',
                            'openai_compatible' => 'gpt-4o-mini',
                            _ => 'edusms-mock-v1',
                          };
                        });
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: modelCtrl,
                  decoration: const InputDecoration(labelText: 'Model Name'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: keyCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'API Key (Encrypted at rest, optional for Mock)',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                await ref.read(automationRepositoryProvider).createAiProvider(
                      name: nameCtrl.text,
                      providerType: providerType,
                      modelName: modelCtrl.text,
                      apiKey: keyCtrl.text,
                    );
                if (ctx.mounted) Navigator.of(ctx).pop();
                _loadAll();
              },
              child: const Text('Save Provider'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Intelligent Automation'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Modes'),
            Tab(text: 'Rules & Tester'),
            Tab(text: 'AI & Logs'),
          ],
        ),
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(16), child: LoadingSkeleton(count: 4))
          : TabBarView(
              controller: _tabController,
              children: [
                _buildModesTab(),
                _buildRulesAndTesterTab(),
                _buildAiTab(),
              ],
            ),
    );
  }

  Widget _buildModesTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        GlowCard(
          child: Column(
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Global Auto-Responder Master Switch'),
                subtitle: const Text('Evaluates active mode & keyword rules on inbound SMS'),
                value: _globalAuto,
                onChanged: (v) => _toggleGlobals(auto: v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Global Safe AI Generation'),
                subtitle: const Text('Allows bounded AI replies with deterministic fallback'),
                value: _globalAi,
                onChanged: (v) => _toggleGlobals(ai: v),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('Automation Modes', style: TextStyle(fontWeight: FontWeight.w700)),
            TextButton.icon(
              onPressed: _openCreateScheduleDialog,
              icon: const Icon(Icons.schedule_rounded, size: 17),
              label: Text('Schedules (${_schedules.length})'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ..._modes.map((m) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: GlowCard(
              accentColor: m.isActive ? AppTheme.electricViolet : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          m.name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                        ),
                      ),
                      if (m.isActive)
                        const Chip(label: Text('ACTIVE'))
                      else
                        FilledButton.tonal(
                          onPressed: () async {
                            await ref.read(automationRepositoryProvider).activateMode(m.id);
                            _loadAll();
                          },
                          child: const Text('Activate'),
                        ),
                    ],
                  ),
                  if (m.description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(m.description, style: Theme.of(context).textTheme.bodySmall),
                  ],
                  const SizedBox(height: 6),
                  Text(
                    'Strategy: ${m.responseMethod} • Cooldown: ${m.cooldownMinutes}m',
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _buildRulesAndTesterTab() {
    final dry = _dryRunResult;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        GlowCard(
          accentColor: AppTheme.cyanAccent,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Live Dry-Run Rule & Policy Tester',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('rule_tester_sender_input'),
                controller: _dryRunSenderCtrl,
                decoration: const InputDecoration(labelText: 'Sample Sender Number'),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('rule_tester_body_input'),
                controller: _dryRunBodyCtrl,
                decoration: const InputDecoration(
                  labelText: 'Sample Incoming SMS Body',
                ),
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                key: const Key('rule_tester_run_button'),
                onPressed: _runRuleTester,
                icon: const Icon(Icons.play_circle_outline),
                label: const Text('Dry-Run Evaluate'),
              ),
              if (dry != null) ...[
                const Divider(height: 20),
                Text(
                  dry.wouldReply
                      ? 'WOULD REPLY (${dry.decision}) in mode ${dry.matchedModeName}'
                      : 'NO REPLY (${dry.decision}): ${dry.reason}',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: dry.wouldReply ? AppTheme.emeraldSuccess : AppTheme.amberWarning,
                  ),
                ),
                if (dry.responsePreview.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text('Preview: ${dry.responsePreview}'),
                ],
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: _openCreateRuleDialog,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add Keyword / Regex Rule'),
        ),
        const SizedBox(height: 12),
        ..._rules.map((r) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: GlowCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${r.name} (${r.matchMode})',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Switch(
                        value: r.isEnabled,
                        onChanged: (v) async {
                          await ref.read(automationRepositoryProvider).toggleRule(r.id, v);
                          _loadAll();
                        },
                      ),
                    ],
                  ),
                  Text('Patterns: ${r.keywords.join(", ")}'),
                  const SizedBox(height: 4),
                  Text(
                    r.responseTemplate,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Text(
                        'Hits: ${r.hitCount} • Priority: ${r.priority}',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: () async {
                          await ref.read(automationRepositoryProvider).duplicateRule(r.id);
                          _loadAll();
                        },
                        child: const Text('Duplicate'),
                      ),
                      IconButton(
                        onPressed: () async {
                          await ref.read(automationRepositoryProvider).deleteRule(r.id);
                          _loadAll();
                        },
                        icon: const Icon(Icons.delete_outline, size: 19),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  Widget _buildAiTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        FilledButton.icon(
          onPressed: _openAddAiProviderDialog,
          icon: const Icon(Icons.psychology_outlined),
          label: const Text('Add AI Provider (Mock / Gemini / OpenAI)'),
        ),
        const SizedBox(height: 12),
        ..._providers.map((p) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: GlowCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${p.name} (${p.providerType} • ${p.modelName})',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    'API Key: ${p.hasApiKey ? p.maskedApiKey : "None (Mock/Unset)"} • Status: ${p.lastTestStatus.isEmpty ? "Untested" : p.lastTestStatus}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      OutlinedButton(
                        onPressed: () async {
                          await ref
                              .read(automationRepositoryProvider)
                              .testAiConnection(p.id);
                          _loadAll();
                        },
                        child: const Text('Test Connection'),
                      ),
                      OutlinedButton(
                        onPressed: () async {
                          final res = await ref
                              .read(automationRepositoryProvider)
                              .testAiPrompt(
                                providerId: p.id,
                                prompt: _aiPromptCtrl.text,
                              );
                          if (mounted) {
                            setState(() {
                              _aiPromptReply = (res['reply_text'] ?? res.toString()).toString();
                            });
                          }
                          _loadAll();
                        },
                        child: const Text('Run Prompt Test'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }),
        GlowCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Live AI Prompt Sandbox',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _aiPromptCtrl,
                decoration: const InputDecoration(labelText: 'Test Student Question'),
              ),
              if (_aiPromptReply != null) ...[
                const SizedBox(height: 10),
                Text('AI Output: $_aiPromptReply'),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        const Text('Recent AI Call Logs', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        ..._aiLogs.take(10).map((l) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: GlowCard(
              padding: const EdgeInsets.all(12),
              child: Text(
                '${l.providerName} (${l.modelName}) • ${l.status} • ${l.latencyMs}ms\n${l.responsePreview.isNotEmpty ? l.responsePreview : l.errorMessage}',
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
          );
        }),
      ],
    );
  }
}
