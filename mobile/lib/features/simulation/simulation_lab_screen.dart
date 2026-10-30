import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../data/repositories/messaging_repository.dart';

class SimulationLabScreen extends ConsumerStatefulWidget {
  const SimulationLabScreen({super.key});

  @override
  ConsumerState<SimulationLabScreen> createState() => _SimulationLabScreenState();
}

class _SimulationLabScreenState extends ConsumerState<SimulationLabScreen> {
  final _senderCtrl = TextEditingController(text: '+255754100201');
  final _bodyCtrl = TextEditingController(text: 'FEES');
  bool _busy = false;
  Map<String, dynamic>? _lastResult;
  String? _banner;

  @override
  void dispose() {
    _senderCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _injectInbound() async {
    if (_senderCtrl.text.trim().isEmpty || _bodyCtrl.text.trim().isEmpty) return;
    setState(() {
      _busy = true;
      _banner = null;
    });
    try {
      final res = await ref.read(messagingRepositoryProvider).injectSimulatedInbound(
            senderNumber: _senderCtrl.text,
            body: _bodyCtrl.text,
          );
      if (mounted) {
        setState(() => _lastResult = res);
      }
    } catch (e) {
      if (mounted) setState(() => _banner = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _seedDemo() async {
    setState(() => _busy = true);
    try {
      final res = await ref.read(messagingRepositoryProvider).seedDemoDataset();
      if (mounted) {
        setState(() => _banner = 'Seeded Simulation Dataset: $res');
      }
    } catch (e) {
      if (mounted) setState(() => _banner = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetLab() async {
    setState(() => _busy = true);
    try {
      final res = await ref.read(messagingRepositoryProvider).resetSimulationData();
      if (mounted) {
        setState(() {
          _lastResult = null;
          _banner = 'Reset Simulation Sandbox: $res';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _banner = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _lastResult;

    return Scaffold(
      appBar: AppBar(title: const Text('Simulation Lab')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const GlowCard(
            accentColor: AppTheme.cyanAccent,
            child: Row(
              children: [
                Icon(Icons.science_outlined, color: AppTheme.cyanAccent),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '100% Isolated Sandbox: Evaluates real keyword/regex rules, schedules, consent policies, and AI providers while guaranteeing zero physical SIM radio calls.',
                    style: TextStyle(fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ),
          if (_banner != null) ...[
            const SizedBox(height: 12),
            GlowCard(child: Text(_banner!)),
          ],
          const SizedBox(height: 14),
          GlowCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Inject Virtual Inbound SMS',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _senderCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Simulated Sender Phone',
                    prefixIcon: Icon(Icons.person_pin_circle_outlined),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _bodyCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Inbound SMS Text (try FEES, TIMETABLE, STOP, START)',
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  children: ['FEES', 'HELP', 'EXAM SCHEDULE', 'STOP', 'START']
                      .map(
                        (kw) => ActionChip(
                          label: Text(kw),
                          onPressed: () => setState(() => _bodyCtrl.text = kw),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: _busy ? null : _injectInbound,
                  icon: const Icon(Icons.bolt_rounded),
                  label: const Text('Inject Inbound & Evaluate Auto-Responder'),
                ),
              ],
            ),
          ),
          if (result != null) ...[
            const SizedBox(height: 14),
            GlowCard(
              accentColor: AppTheme.emeraldSuccess,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Evaluation Decision: ${(result['decision'] ?? '').toString().toUpperCase()}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: AppTheme.emeraldSuccess,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text('Policy Summary: ${result['summary'] ?? 'N/A'}'),
                  if (result['reply_body'] != null) ...[
                    const Divider(height: 18),
                    const Text(
                      'Generated Simulated Reply:',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                    ),
                    const SizedBox(height: 4),
                    Text(result['reply_body'].toString()),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          GlowCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Sandbox Dataset Controls',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _seedDemo,
                  icon: const Icon(Icons.dataset_outlined),
                  label: const Text('Seed Demo Contacts, Rules & Sample Messages'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _resetLab,
                  icon: const Icon(Icons.delete_sweep_outlined),
                  label: const Text('Reset Simulation Messages & Virtual Data'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
