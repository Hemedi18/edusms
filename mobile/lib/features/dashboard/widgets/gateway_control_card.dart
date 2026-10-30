import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/native_gateway_bridge.dart';
import '../../../core/platform/platform_capabilities.dart';
import '../../../core/storage/app_preferences.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/glow_card.dart';

/// Live Android Native Gateway Control Card (or honest iOS Companion Mode banner).
/// Displays foreground service status, Start/Pause/Resume/Stop controls, Sync Now,
/// SIM slot selector, permission-denied recovery action, and offline queue badge.
class GatewayControlCard extends ConsumerStatefulWidget {
  const GatewayControlCard({
    super.key,
    this.initialDiagnostics,
  });

  final NativeGatewayDiagnostics? initialDiagnostics;

  @override
  ConsumerState<GatewayControlCard> createState() => _GatewayControlCardState();
}

class _GatewayControlCardState extends ConsumerState<GatewayControlCard> {
  NativeGatewayDiagnostics? _diag;
  StreamSubscription<Map<String, dynamic>>? _eventSub;
  bool _busy = false;
  String? _actionFeedback;

  @override
  void initState() {
    super.initState();
    _diag = widget.initialDiagnostics;
    if (_diag == null) {
      Future.microtask(_refreshDiagnostics);
    }
    _eventSub = ref.read(nativeGatewayBridgeProvider).events.listen((event) {
      if (mounted) {
        _refreshDiagnostics();
      }
    });
  }

  @override
  void didUpdateWidget(covariant GatewayControlCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialDiagnostics != null &&
        widget.initialDiagnostics != oldWidget.initialDiagnostics) {
      _diag = widget.initialDiagnostics;
    }
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    super.dispose();
  }

  Future<void> _refreshDiagnostics() async {
    final next = await ref.read(nativeGatewayBridgeProvider).getDiagnostics();
    if (mounted) {
      setState(() => _diag = next);
    }
  }

  Future<void> _runGatewayAction(
    Future<NativeGatewayDiagnostics> Function(NativeGatewayBridge bridge) action, {
    String? feedback,
  }) async {
    setState(() {
      _busy = true;
      _actionFeedback = null;
    });
    try {
      final updated = await action(ref.read(nativeGatewayBridgeProvider));
      if (mounted) {
        setState(() {
          _diag = updated;
          _actionFeedback = feedback;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _actionFeedback = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _grantMissingPermissions() async {
    setState(() => _busy = true);
    try {
      await ref.read(nativeGatewayBridgeProvider).requestPermissions();
      await _refreshDiagnostics();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = ref.watch(platformCapabilitiesProvider);
    final diag = _diag;

    if (!caps.supportsPhysicalSimGateway) {
      return GlowCard(
        key: const Key('ios_companion_gateway_banner'),
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
                    'Companion Mode Active (Physical SIM Sandboxed)',
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
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () => context.go('/devices'),
                  icon: const Icon(Icons.qr_code_rounded, size: 17),
                  label: const Text('Pair Remote Android Phone'),
                ),
                OutlinedButton.icon(
                  onPressed: () => context.push('/hub/simulation'),
                  icon: const Icon(Icons.science_outlined, size: 17),
                  label: const Text('Open Simulation Lab'),
                ),
              ],
            ),
          ],
        ),
      );
    }

    if (diag == null) {
      return const GlowCard(
        child: SizedBox(
          height: 92,
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final isRunning = diag.serviceRunning && !diag.gatewayPaused;
    final isPaused = diag.gatewayPaused;
    final statusColor = !diag.gatewayConfigured
        ? AppTheme.amberWarning
        : (isRunning
            ? AppTheme.emeraldSuccess
            : (isPaused ? AppTheme.amberWarning : const Color(0xFF64748B)));
    final statusText = !diag.gatewayConfigured
        ? 'Not Paired'
        : (isRunning
            ? 'Foreground Gateway Online'
            : (isPaused ? 'Gateway Paused' : 'Gateway Stopped'));

    return GlowCard(
      key: const Key('android_gateway_control_card'),
      accentColor: statusColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.cell_tower_rounded, color: statusColor),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Android Native SIM Gateway',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                    Text(
                      '${diag.manufacturer} ${diag.deviceModel} • ${diag.networkType}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: statusColor.withValues(alpha: 0.45)),
                ),
                child: Text(
                  statusText,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: statusColor,
                  ),
                ),
              ),
            ],
          ),
          if (!diag.hasRequiredSmsPermissions) ...[
            const SizedBox(height: 12),
            Container(
              key: const Key('permission_denied_recovery_banner'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.roseDanger.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.roseDanger.withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: AppTheme.roseDanger),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'SEND_SMS / RECEIVE_SMS permissions are required for physical SIM radio access.',
                      style: TextStyle(fontSize: 12.5),
                    ),
                  ),
                  TextButton(
                    key: const Key('grant_sms_permissions_button'),
                    onPressed: _busy ? null : _grantMissingPermissions,
                    child: const Text('Grant'),
                  ),
                ],
              ),
            ),
          ],
          if (diag.totalOfflineQueued > 0) ...[
            const SizedBox(height: 10),
            Container(
              key: const Key('offline_queue_badge'),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppTheme.amberWarning.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.cloud_off_rounded, size: 15, color: AppTheme.amberWarning),
                  const SizedBox(width: 6),
                  Text(
                    'Offline Queue: ${diag.totalOfflineQueued} event(s) awaiting sync',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.amberWarning,
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (diag.simSlots.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text(
                  'Active SIM:',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
                ...diag.simSlots.map((slot) {
                  final selected = slot.slotIndex == diag.selectedSimSlot;
                  return ChoiceChip(
                    label: Text(
                      'SIM ${slot.slotIndex + 1} (${slot.carrierName.isNotEmpty ? slot.carrierName : slot.displayName})',
                    ),
                    selected: selected,
                    onSelected: _busy
                        ? null
                        : (_) => _runGatewayAction(
                              (b) => b.configureGateway(
                                apiBaseUrl: ref.read(apiBaseUrlProvider),
                                selectedSimSlot: slot.slotIndex,
                              ),
                              feedback: 'Selected SIM ${slot.slotIndex + 1}',
                            ),
                  );
                }),
              ],
            ),
          ],
          if (_actionFeedback != null || diag.lastError.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              _actionFeedback ?? diag.lastError,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: diag.lastError.isNotEmpty && _actionFeedback == null
                        ? AppTheme.amberWarning
                        : null,
                  ),
            ),
          ],
          const SizedBox(height: 12),
          if (!diag.gatewayConfigured)
            FilledButton.icon(
              onPressed: () => context.go('/devices'),
              icon: const Icon(Icons.phonelink_setup_rounded, size: 18),
              label: const Text('Pair This Handset'),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (!diag.serviceRunning)
                  FilledButton.icon(
                    key: const Key('gateway_start_button'),
                    onPressed: _busy
                        ? null
                        : () => _runGatewayAction(
                              (b) => b.startGatewayService(),
                              feedback: 'Foreground SIM Gateway started.',
                            ),
                    icon: const Icon(Icons.play_arrow_rounded, size: 18),
                    label: const Text('Start Service'),
                  ),
                if (diag.serviceRunning && !diag.gatewayPaused)
                  OutlinedButton.icon(
                    key: const Key('gateway_pause_button'),
                    onPressed: _busy
                        ? null
                        : () => _runGatewayAction(
                              (b) => b.pauseGatewayService(),
                              feedback: 'Gateway job polling paused.',
                            ),
                    icon: const Icon(Icons.pause_rounded, size: 18),
                    label: const Text('Pause'),
                  ),
                if (diag.gatewayPaused)
                  FilledButton.icon(
                    key: const Key('gateway_resume_button'),
                    onPressed: _busy
                        ? null
                        : () => _runGatewayAction(
                              (b) => b.resumeGatewayService(),
                              feedback: 'Gateway resumed.',
                            ),
                    icon: const Icon(Icons.play_arrow_rounded, size: 18),
                    label: const Text('Resume'),
                  ),
                if (diag.serviceRunning)
                  OutlinedButton.icon(
                    key: const Key('gateway_stop_button'),
                    onPressed: _busy
                        ? null
                        : () => _runGatewayAction(
                              (b) => b.stopGatewayService(),
                              feedback: 'Foreground SIM Gateway stopped.',
                            ),
                    icon: const Icon(Icons.stop_circle_outlined, size: 18),
                    label: const Text('Stop'),
                  ),
                OutlinedButton.icon(
                  key: const Key('gateway_sync_now_button'),
                  onPressed: _busy
                      ? null
                      : () => _runGatewayAction(
                            (b) => b.syncNow(),
                            feedback: 'Synced heartbeat & queues.',
                          ),
                  icon: const Icon(Icons.sync_rounded, size: 18),
                  label: const Text('Sync Now'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
