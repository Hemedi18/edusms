import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/network/native_gateway_bridge.dart';
import '../../core/platform/platform_capabilities.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/device_models.dart';
import '../../data/repositories/gateway_repository.dart';

class DevicesScreen extends ConsumerStatefulWidget {
  const DevicesScreen({super.key});

  @override
  ConsumerState<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends ConsumerState<DevicesScreen> {
  final _codeOrQrCtrl = TextEditingController();
  final _deviceNameCtrl = TextEditingController();
  final _newSessionHintCtrl = TextEditingController(text: 'Campus Android SIM #1');

  List<PairedDevice> _devices = const [];
  NativeGatewayDiagnostics? _diag;
  PairingInitSession? _generatedSession;
  PairingConfirmResult? _lastPairedResult;

  bool _loading = true;
  bool _pairingBusy = false;
  bool _generatingQr = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadAll);
  }

  @override
  void dispose() {
    _codeOrQrCtrl.dispose();
    _deviceNameCtrl.dispose();
    _newSessionHintCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final diagFuture = ref.read(nativeGatewayBridgeProvider).getDiagnostics();
      final devicesFuture = ref.read(gatewayRepositoryProvider).listDevices();
      final results = await Future.wait([diagFuture, devicesFuture]);
      if (!mounted) return;
      setState(() {
        _diag = results[0] as NativeGatewayDiagnostics;
        _devices = results[1] as List<PairedDevice>;
        _loading = false;
      });
    } catch (e) {
      final diag = await ref.read(nativeGatewayBridgeProvider).getDiagnostics();
      if (!mounted) return;
      setState(() {
        _diag = diag;
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _confirmThisHandsetPairing() async {
    final raw = _codeOrQrCtrl.text.trim();
    if (raw.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enter a 6-character pairing code or paste a QR JSON payload.'),
        ),
      );
      return;
    }

    setState(() {
      _pairingBusy = true;
      _error = null;
    });
    try {
      final result = await ref.read(gatewayRepositoryProvider).confirmHandsetPairing(
            codeOrQrPayload: raw,
            customDeviceName: _deviceNameCtrl.text,
          );
      _codeOrQrCtrl.clear();
      if (!mounted) return;
      setState(() {
        _lastPairedResult = result;
      });
      await _loadAll();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Paired "${result.device.name}"! You can now start the Foreground SIM Gateway.',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _pairingBusy = false);
      }
    }
  }

  Future<void> _generatePairingQr() async {
    setState(() => _generatingQr = true);
    try {
      final session = await ref.read(gatewayRepositoryProvider).initPairingSession(
            deviceName: _newSessionHintCtrl.text.trim().isEmpty
                ? 'Android SIM Gateway'
                : _newSessionHintCtrl.text.trim(),
          );
      if (!mounted) return;
      setState(() => _generatedSession = session);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _generatingQr = false);
    }
  }

  Future<void> _pasteFromClipboard() async {
    final clip = await Clipboard.getData(Clipboard.kTextPlain);
    final text = clip?.text?.trim();
    if (text != null && text.isNotEmpty && mounted) {
      setState(() => _codeOrQrCtrl.text = text);
    }
  }

  Future<void> _requestPermissions() async {
    await ref.read(nativeGatewayBridgeProvider).requestPermissions();
    final updated = await ref.read(nativeGatewayBridgeProvider).getDiagnostics();
    if (mounted) {
      setState(() => _diag = updated);
    }
  }

  Future<void> _requestOptionalDefaultSmsRole() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Optional Default SMS Role'),
        content: const Text(
          'EduSMS NEVER requires Default SMS App status for standard SIM gateway polling or inbound SMS reception.\n\n'
          'Only request this optional Android role on dedicated gateway handsets where OEM firmware suppresses background broadcasts.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Keep Current Default App'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Open Android Role Prompt'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await ref.read(nativeGatewayBridgeProvider).requestDefaultSmsRole();
    final updated = await ref.read(nativeGatewayBridgeProvider).getDiagnostics();
    if (mounted) {
      setState(() => _diag = updated);
    }
  }

  Future<void> _togglePause(PairedDevice device) async {
    try {
      if (device.isPaused) {
        await ref.read(gatewayRepositoryProvider).resumeDevice(device.id);
      } else {
        await ref.read(gatewayRepositoryProvider).pauseDevice(device.id);
      }
      await _loadAll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _confirmRevoke(PairedDevice device) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Revoke "${device.name}"?'),
        content: const Text(
          'This immediately invalidates the handset gateway token and stops future SIM job dispatch to this phone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppTheme.roseDanger),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Revoke Handset'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    try {
      await ref.read(gatewayRepositoryProvider).revokeDevice(device.id);
      await _loadAll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  Future<void> _changeDeviceSimSlot(PairedDevice device, int slotIndex) async {
    try {
      await ref.read(gatewayRepositoryProvider).updateDeviceSimSlot(device.id, slotIndex);
      await _loadAll();
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
    final caps = ref.watch(platformCapabilitiesProvider);
    final diag = _diag;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Gateway Handsets & Pairing'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loadAll,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadAll,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) ...[
              GlowCard(
                accentColor: AppTheme.roseDanger,
                child: Row(
                  children: [
                    const Icon(Icons.error_outline_rounded, color: AppTheme.roseDanger),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],
            if (caps.supportsPhysicalSimGateway)
              _buildAndroidPairThisHandsetCard(context)
            else
              _buildCompanionNoticeCard(context, caps),
            const SizedBox(height: 16),
            _buildGenerateQrCard(context),
            if (caps.supportsPhysicalSimGateway && diag != null) ...[
              const SizedBox(height: 16),
              _buildDiagnosticsChecklistCard(context, diag),
            ],
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Paired Gateway Devices (${_devices.length})',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (_loading)
              const LoadingSkeleton(count: 2, height: 110)
            else if (_devices.isEmpty)
              const EmptyStateView(
                icon: Icons.phonelink_setup_rounded,
                title: 'No Paired Gateway Handsets Yet',
                subtitle:
                    'Generate a 6-character pairing code or QR above, then confirm pairing on an Android phone with an active SIM.',
              )
            else
              ..._devices.map((d) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _buildPairedDeviceCard(context, d),
                  )),
          ],
        ),
      ),
    );
  }

  Widget _buildAndroidPairThisHandsetCard(BuildContext context) {
    return GlowCard(
      key: const Key('pair_this_handset_card'),
      accentColor: AppTheme.electricViolet,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.phonelink_lock_rounded, color: AppTheme.electricViolet),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Pair This Android Handset as SIM Gateway',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Enter the 6-character pairing code from your EduSMS Web Dashboard, or paste the QR JSON payload.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('pairing_code_or_qr_input'),
            controller: _codeOrQrCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              labelText: '6-Char Pairing Code or QR Payload',
              hintText: 'e.g. A7K9P2 or {"code":"A7K9P2",...}',
              prefixIcon: const Icon(Icons.qr_code_scanner_rounded),
              suffixIcon: IconButton(
                tooltip: 'Paste from clipboard',
                onPressed: _pasteFromClipboard,
                icon: const Icon(Icons.content_paste_rounded, size: 19),
              ),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            key: const Key('pairing_device_name_input'),
            controller: _deviceNameCtrl,
            decoration: const InputDecoration(
              labelText: 'Handset Label (Optional)',
              hintText: 'e.g. Bursar Office Vodacom TZ',
              prefixIcon: Icon(Icons.smartphone_rounded),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('confirm_pairing_button'),
            onPressed: _pairingBusy ? null : _confirmThisHandsetPairing,
            icon: _pairingBusy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Icon(Icons.link_rounded, size: 18),
            label: Text(_pairingBusy ? 'Confirming Handset...' : 'Confirm Handset Pairing'),
          ),
          if (_lastPairedResult != null) ...[
            const SizedBox(height: 12),
            Container(
              key: const Key('pairing_confirmed_banner'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.emeraldSuccess.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.emeraldSuccess.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_outline_rounded, color: AppTheme.emeraldSuccess),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Bound "${_lastPairedResult!.device.name}" (${_lastPairedResult!.device.gatewayTokenPrefix}•••). Native Foreground Service configured.',
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                  FilledButton.tonal(
                    onPressed: () async {
                      final updated =
                          await ref.read(nativeGatewayBridgeProvider).startGatewayService();
                      if (mounted) setState(() => _diag = updated);
                    },
                    child: const Text('Start Now'),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildCompanionNoticeCard(BuildContext context, PlatformCapabilities caps) {
    return GlowCard(
      key: const Key('devices_ios_companion_notice'),
      accentColor: AppTheme.cyanAccent,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.phone_iphone_rounded, color: AppTheme.cyanAccent),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Companion Control Mode',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            caps.gatewayCapabilitySummary,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Use the generator below to create a QR or 6-character code and scan it from a dedicated Android gateway phone, or control existing paired Android handsets below.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildGenerateQrCard(BuildContext context) {
    final session = _generatedSession;

    return GlowCard(
      accentColor: AppTheme.electricBlue,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.qr_code_2_rounded, color: AppTheme.electricBlue),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Generate Pairing Code & QR for Another Device',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _newSessionHintCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Target Handset Hint',
                    prefixIcon: Icon(Icons.badge_outlined),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton.icon(
                key: const Key('generate_pairing_qr_button'),
                onPressed: _generatingQr ? null : _generatePairingQr,
                icon: const Icon(Icons.qr_code_rounded, size: 18),
                label: Text(_generatingQr ? '...' : 'Generate'),
              ),
            ],
          ),
          if (session != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: session.qrPayload.isNotEmpty
                          ? session.qrPayload
                          : session.pairingCode,
                      version: QrVersions.auto,
                      size: 172,
                      backgroundColor: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SelectableText(
                    session.pairingCode,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 4,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Valid for ${(session.ttlSeconds / 60).round()} minutes • One-time token exchange',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: session.pairingCode));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Copied 6-character pairing code')),
                      );
                    },
                    icon: const Icon(Icons.copy_rounded, size: 16),
                    label: const Text('Copy Code'),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDiagnosticsChecklistCard(
    BuildContext context,
    NativeGatewayDiagnostics diag,
  ) {
    final checks = <({String label, bool ok, String detail})>[
      (
        label: 'SEND_SMS Runtime Permission',
        ok: diag.permissionsState['SEND_SMS'] == true,
        detail: diag.permissionsState['SEND_SMS'] == true
            ? 'Granted for SmsManager transmission'
            : 'Denied — tap Grant Permissions below',
      ),
      (
        label: 'RECEIVE_SMS & READ_SMS Broadcast Access',
        ok: diag.permissionsState['RECEIVE_SMS'] == true,
        detail: diag.permissionsState['RECEIVE_SMS'] == true
            ? 'Granted for SMS_RECEIVED PDU capture'
            : 'Denied — inbound SIM SMS disabled',
      ),
      (
        label: 'Active Physical / eSIM Radio',
        ok: diag.simAvailable,
        detail: diag.simSlots.isNotEmpty
            ? diag.simSlots
                .map((s) => 'SIM ${s.slotIndex + 1}: ${s.carrierName} (${s.countryIso})')
                .join(' • ')
            : (diag.simAvailable ? 'SIM ready (${diag.carrierName})' : 'No active SIM detected'),
      ),
      (
        label: 'Foreground Gateway Service Binding',
        ok: diag.gatewayConfigured,
        detail: diag.gatewayConfigured
            ? (diag.serviceRunning
                ? (diag.gatewayPaused ? 'Paused by operator' : 'Foreground service running')
                : 'Configured (service stopped)')
            : 'Not paired yet',
      ),
    ];

    return GlowCard(
      accentColor: diag.hasRequiredSmsPermissions && diag.simAvailable
          ? AppTheme.emeraldSuccess
          : AppTheme.amberWarning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.health_and_safety_outlined, color: AppTheme.emeraldSuccess),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Handset Telephony & Permission Checklist',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
              ),
              if (diag.batteryLevel != null)
                Text(
                  '${diag.batteryLevel}%${diag.isCharging ? ' ⚡' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
                ),
            ],
          ),
          const SizedBox(height: 10),
          ...checks.map((c) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      c.ok ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
                      size: 18,
                      color: c.ok ? AppTheme.emeraldSuccess : AppTheme.amberWarning,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            c.label,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                          ),
                          Text(
                            c.detail,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              )),
          const Divider(height: 20),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (!diag.hasRequiredSmsPermissions)
                FilledButton.tonalIcon(
                  onPressed: _requestPermissions,
                  icon: const Icon(Icons.security_rounded, size: 17),
                  label: const Text('Grant SMS Permissions'),
                ),
              OutlinedButton.icon(
                key: const Key('request_default_sms_role_button'),
                onPressed: diag.isDefaultSmsApp ? null : _requestOptionalDefaultSmsRole,
                icon: Icon(
                  diag.isDefaultSmsApp
                      ? Icons.verified_rounded
                      : Icons.admin_panel_settings_outlined,
                  size: 17,
                ),
                label: Text(
                  diag.isDefaultSmsApp
                      ? 'Default SMS Role Active'
                      : 'Optional Default SMS Role',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPairedDeviceCard(BuildContext context, PairedDevice device) {
    final statusColor = device.isPaused
        ? AppTheme.amberWarning
        : (device.isOnline ? AppTheme.emeraldSuccess : const Color(0xFF64748B));
    final statusLabel = device.isPaused
        ? 'PAUSED'
        : (device.isOnline ? 'ONLINE' : device.connectionStatus.toUpperCase());

    return GlowCard(
      accentColor: statusColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                device.platform == 'ios' ? Icons.phone_iphone_rounded : Icons.smartphone_rounded,
                color: statusColor,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      device.name,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                    Text(
                      '${device.manufacturer} ${device.deviceModel} • ${device.carrierName.isNotEmpty ? device.carrierName : device.networkType}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 12,
            runSpacing: 6,
            children: [
              _statPill('Out: ${device.outgoingMessageCount}'),
              _statPill('In: ${device.incomingMessageCount}'),
              _statPill('Pending: ${device.pendingJobsCount}'),
              if (device.failedTransmissionCount > 0)
                _statPill('Failed: ${device.failedTransmissionCount}', danger: true),
              if (device.batteryLevel != null)
                _statPill('Battery: ${device.batteryLevel}%'),
            ],
          ),
          if (device.simSlots.length > 1) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: device.simSlots.map((slot) {
                return ChoiceChip(
                  label: Text('SIM ${slot.slotIndex + 1} (${slot.carrierName})'),
                  selected: device.selectedSimSlot == slot.slotIndex,
                  onSelected: (_) => _changeDeviceSimSlot(device, slot.slotIndex),
                );
              }).toList(),
            ),
          ],
          if (device.lastError.isNotEmpty || device.recommendedAction.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              device.recommendedAction.isNotEmpty
                  ? '${device.lastError} • ${device.recommendedAction}'
                  : device.lastError,
              style: const TextStyle(fontSize: 12, color: AppTheme.amberWarning),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: () => _togglePause(device),
                icon: Icon(
                  device.isPaused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                  size: 17,
                ),
                label: Text(device.isPaused ? 'Resume Dispatch' : 'Pause Dispatch'),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: AppTheme.roseDanger),
                onPressed: () => _confirmRevoke(device),
                icon: const Icon(Icons.link_off_rounded, size: 17),
                label: const Text('Revoke'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statPill(String text, {bool danger = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: (danger ? AppTheme.roseDanger : AppTheme.electricViolet)
            .withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          color: danger ? AppTheme.roseDanger : null,
        ),
      ),
    );
  }
}
