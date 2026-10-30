import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../data/models/device_models.dart';
import '../../data/models/message_models.dart';
import '../../data/repositories/gateway_repository.dart';
import '../../data/repositories/messaging_repository.dart';

class ComposeSmsScreen extends ConsumerStatefulWidget {
  const ComposeSmsScreen({super.key});

  @override
  ConsumerState<ComposeSmsScreen> createState() => _ComposeSmsScreenState();
}

class _ComposeSmsScreenState extends ConsumerState<ComposeSmsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _recipientCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();

  String _transportType = 'simulation';
  String? _selectedDeviceId;
  int _selectedSimSlot = 0;
  String? _selectedSenderIdentityId;
  String _simulatedOutcome = 'simulated_delivered';

  List<PairedDevice> _devices = const [];
  List<SenderIdentityItem> _identities = const [];
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadTargets);
  }

  @override
  void dispose() {
    _recipientCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadTargets() async {
    try {
      final res = await Future.wait([
        ref.read(gatewayRepositoryProvider).listDevices(),
        ref.read(messagingRepositoryProvider).listSenderIdentities(),
      ]);
      if (!mounted) return;
      final devs = (res[0] as List<PairedDevice>)
          .where((d) => d.platform == 'android' && d.isEnabled)
          .toList();
      final ids = (res[1] as List<SenderIdentityItem>)
          .where((i) => i.identityType == 'external_provider' && i.isEnabled)
          .toList();
      setState(() {
        _devices = devs;
        _identities = ids;
        if (devs.isNotEmpty) {
          _selectedDeviceId = devs.first.id;
          _selectedSimSlot = devs.first.selectedSimSlot;
        }
        if (ids.isNotEmpty) {
          _selectedSenderIdentityId = ids.first.id;
        }
      });
    } catch (_) {
      // Allow composing in Simulation Mode even if list fetch fails
    }
  }

  Future<void> _send() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final msg = await ref.read(messagingRepositoryProvider).sendMessage(
            recipientNumber: _recipientCtrl.text,
            body: _bodyCtrl.text,
            transportType: _transportType,
            deviceId: _transportType == 'sim_gateway' ? _selectedDeviceId : null,
            simSlot: _transportType == 'sim_gateway' ? _selectedSimSlot : null,
            senderIdentityId:
                _transportType == 'external_provider' ? _selectedSenderIdentityId : null,
            simulatedOutcome: _simulatedOutcome,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            msg.isSimulation
                ? 'Simulated SMS recorded (${msg.status}). Zero carrier charges.'
                : 'Message queued (${msg.status}) for ${msg.recipientNumber}.',
          ),
        ),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final charLen = _bodyCtrl.text.length;
    final segments = charLen == 0 ? 0 : ((charLen - 1) ~/ 160) + 1;

    return Scaffold(
      appBar: AppBar(title: const Text('Compose SMS')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_error != null) ...[
                  GlowCard(
                    accentColor: AppTheme.roseDanger,
                    child: Text(_error!, style: const TextStyle(color: AppTheme.roseDanger)),
                  ),
                  const SizedBox(height: 12),
                ],
                GlowCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Select Transport Channel',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          ChoiceChip(
                            label: const Text('Simulation Sandbox'),
                            selected: _transportType == 'simulation',
                            onSelected: (_) => setState(() => _transportType = 'simulation'),
                          ),
                          ChoiceChip(
                            key: const Key('transport_sim_gateway_chip'),
                            label: const Text('Android SIM Gateway'),
                            selected: _transportType == 'sim_gateway',
                            onSelected: (_) => setState(() => _transportType = 'sim_gateway'),
                          ),
                          ChoiceChip(
                            label: const Text('External Provider'),
                            selected: _transportType == 'external_provider',
                            onSelected: (_) =>
                                setState(() => _transportType = 'external_provider'),
                          ),
                        ],
                      ),
                      if (_transportType == 'sim_gateway') ...[
                        const SizedBox(height: 12),
                        Container(
                          key: const Key('carrier_charge_warning_banner'),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.amberWarning.withValues(alpha: 0.14),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: AppTheme.amberWarning.withValues(alpha: 0.45),
                            ),
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.payments_outlined, color: AppTheme.amberWarning),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Carrier SMS Charge Disclosure: Sending via Android SIM Gateway transmits a real cellular SMS from your SIM phone number and incurs standard carrier SMS charges/bundle usage.',
                                  style: TextStyle(fontSize: 12.5),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (_devices.isNotEmpty) ...[
                          DropdownButtonFormField<String>(
                            initialValue: _selectedDeviceId,
                            decoration: const InputDecoration(
                              labelText: 'Target Paired Android Handset',
                              prefixIcon: Icon(Icons.smartphone_rounded),
                            ),
                            items: _devices
                                .map(
                                  (d) => DropdownMenuItem<String>(
                                    value: d.id,
                                    child: Text('${d.name} (${d.carrierName.isNotEmpty ? d.carrierName : d.platform})'),
                                  ),
                                )
                                .toList(),
                            onChanged: (v) {
                              if (v != null) setState(() => _selectedDeviceId = v);
                            },
                          ),
                          const SizedBox(height: 10),
                        ],
                        Wrap(
                          spacing: 8,
                          children: [0, 1].map((slot) {
                            return ChoiceChip(
                              label: Text('SIM Slot ${slot + 1}'),
                              selected: _selectedSimSlot == slot,
                              onSelected: (_) => setState(() => _selectedSimSlot = slot),
                            );
                          }).toList(),
                        ),
                      ],
                      if (_transportType == 'simulation') ...[
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          children: [
                            for (final o in [
                              ('simulated_delivered', 'Deliver (Sim)'),
                              ('simulated_sent', 'Submitted Only'),
                              ('delivery_unknown', 'Unknown DLR'),
                              ('failed', 'Simulate Fail'),
                            ])
                              ChoiceChip(
                                label: Text(o.$2),
                                selected: _simulatedOutcome == o.$1,
                                onSelected: (_) => setState(() => _simulatedOutcome = o.$1),
                              ),
                          ],
                        ),
                      ],
                      if (_transportType == 'external_provider' && _identities.isEmpty) ...[
                        const SizedBox(height: 10),
                        const Text(
                          'Configure an External Provider Sender Identity in Campaigns -> Sender Identities first.',
                          style: TextStyle(fontSize: 12.5, color: AppTheme.amberWarning),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                GlowCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextFormField(
                        controller: _recipientCtrl,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Recipient Phone Number (E.164 or +255 / 07...)',
                          hintText: '+255754100201',
                          prefixIcon: Icon(Icons.phone_outlined),
                        ),
                        validator: (v) => (v ?? '').trim().isEmpty
                            ? 'Recipient phone number is required.'
                            : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _bodyCtrl,
                        maxLines: 5,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: 'SMS Body',
                          hintText: 'Write message text...',
                          helperText: '$charLen chars • $segments SMS segment(s)',
                        ),
                        validator: (v) =>
                            (v ?? '').trim().isEmpty ? 'Message body is required.' : null,
                      ),
                      const SizedBox(height: 16),
                      FilledButton.icon(
                        onPressed: _sending ? null : _send,
                        icon: const Icon(Icons.send_rounded, size: 18),
                        label: Text(
                          _sending
                              ? 'Dispatching...'
                              : (_transportType == 'simulation'
                                  ? 'Send Simulated SMS'
                                  : 'Queue Outbound SMS'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
