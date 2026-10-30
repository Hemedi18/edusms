import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/glow_card.dart';
import '../../data/models/message_models.dart';
import '../../data/repositories/messaging_repository.dart';

class SenderIdentitiesSheet extends ConsumerStatefulWidget {
  const SenderIdentitiesSheet({super.key});

  @override
  ConsumerState<SenderIdentitiesSheet> createState() => _SenderIdentitiesSheetState();
}

class _SenderIdentitiesSheetState extends ConsumerState<SenderIdentitiesSheet> {
  List<SenderIdentityItem> _items = const [];
  final _labelCtrl = TextEditingController();
  final _alphaCtrl = TextEditingController();
  final _urlCtrl = TextEditingController();
  final _keyCtrl = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _alphaCtrl.dispose();
    _urlCtrl.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(messagingRepositoryProvider).listSenderIdentities();
      if (mounted) setState(() => _items = list);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _createExternalIdentity() async {
    if (_labelCtrl.text.trim().isEmpty) return;
    try {
      await ref.read(messagingRepositoryProvider).createSenderIdentity(
            label: _labelCtrl.text,
            identityType: 'external_provider',
            alphanumericSenderId: _alphaCtrl.text,
            providerBaseUrl: _urlCtrl.text,
            providerApiKey: _keyCtrl.text,
          );
      _labelCtrl.clear();
      _alphaCtrl.clear();
      _urlCtrl.clear();
      _keyCtrl.clear();
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Sender Identities',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Note: Physical Android SIM gateways always transmit from their carrier SIM phone number and cannot spoof alphanumeric sender IDs. Alphanumeric IDs (1–11 chars) apply only to registered External Providers.',
              style: TextStyle(fontSize: 12),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: AppTheme.roseDanger)),
            ],
            const SizedBox(height: 12),
            ..._items.map((item) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: GlowCard(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${item.label} (${item.identityType})'
                          '${item.alphanumericSenderId.isNotEmpty ? " • ${item.alphanumericSenderId}" : ""}',
                        ),
                      ),
                      IconButton(
                        onPressed: () async {
                          await ref
                              .read(messagingRepositoryProvider)
                              .deleteSenderIdentity(item.id);
                          _load();
                        },
                        icon: const Icon(Icons.delete_outline, size: 19),
                      ),
                    ],
                  ),
                ),
              );
            }),
            const Divider(height: 20),
            TextField(
              controller: _labelCtrl,
              decoration: const InputDecoration(labelText: 'External Provider Label'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _alphaCtrl,
              decoration: const InputDecoration(
                labelText: 'Registered Alphanumeric Sender ID (max 11 chars)',
                hintText: 'EDUSMS',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _urlCtrl,
              decoration: const InputDecoration(labelText: 'Provider HTTPS Endpoint'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _keyCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Provider API Key'),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _createExternalIdentity,
              child: const Text('Save External Sender Identity'),
            ),
          ],
        ),
      ),
    );
  }
}
