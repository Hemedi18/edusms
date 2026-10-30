import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Honest SMS delivery & transport status badge.
/// Explicitly separates:
/// - `submitted` ("Accepted for Transmission" — NOT carrier delivered)
/// - `delivered` ("Carrier Delivered" — confirmed via carrier DLR PDU)
/// - `simulated_*` ("Simulated" — sandbox transport, zero carrier traffic)
/// - `delivery_unknown` ("Delivery Unknown")
/// - `failed` ("Failed")
class TransportStatusBadge extends StatelessWidget {
  const TransportStatusBadge({
    super.key,
    required this.status,
    this.isSimulation = false,
    this.transportType,
    this.compact = false,
  });

  final String status;
  final bool isSimulation;
  final String? transportType;
  final bool compact;

  static ({String label, Color color, IconData icon}) describe(
    String rawStatus, {
    bool isSimulation = false,
  }) {
    final normalized = rawStatus.trim().toLowerCase();

    if (isSimulation || normalized.startsWith('simulated')) {
      final label = switch (normalized) {
        'failed' => 'Simulated Failed',
        'delivery_unknown' => 'Simulated Unknown',
        'pending_approval' => 'Pending Approval (Sim)',
        _ => 'Simulated',
      };
      return (
        label: label,
        color: normalized == 'failed' ? AppTheme.roseDanger : AppTheme.cyanAccent,
        icon: Icons.science_outlined,
      );
    }

    return switch (normalized) {
      'submitted' => (
          label: 'Accepted for Transmission',
          color: AppTheme.electricBlue,
          icon: Icons.outbox_outlined,
        ),
      'delivered' => (
          label: 'Carrier Delivered',
          color: AppTheme.emeraldSuccess,
          icon: Icons.verified_outlined,
        ),
      'delivery_unknown' => (
          label: 'Delivery Unknown',
          color: AppTheme.amberWarning,
          icon: Icons.help_outline_rounded,
        ),
      'failed' || 'send_failed' || 'delivery_failed' => (
          label: 'Failed',
          color: AppTheme.roseDanger,
          icon: Icons.error_outline_rounded,
        ),
      'queued' => (
          label: 'Queued',
          color: AppTheme.amberWarning,
          icon: Icons.schedule_rounded,
        ),
      'dispatched_to_device' => (
          label: 'Dispatched to Handset',
          color: AppTheme.electricViolet,
          icon: Icons.smartphone_rounded,
        ),
      'pending_approval' => (
          label: 'Pending Approval',
          color: AppTheme.amberWarning,
          icon: Icons.fact_check_outlined,
        ),
      'received' => (
          label: 'Received (SIM)',
          color: AppTheme.emeraldSuccess,
          icon: Icons.call_received_rounded,
        ),
      'canceled' => (
          label: 'Canceled',
          color: const Color(0xFF64748B),
          icon: Icons.cancel_outlined,
        ),
      'expired' => (
          label: 'Expired',
          color: AppTheme.roseDanger,
          icon: Icons.timer_off_outlined,
        ),
      _ => (
          label: rawStatus.replaceAll('_', ' ').toUpperCase(),
          color: const Color(0xFF64748B),
          icon: Icons.info_outline_rounded,
        ),
    };
  }

  static String describeTransport(String? transportType, {bool isSimulation = false}) {
    if (isSimulation || transportType == 'simulation') {
      return 'SIMULATION';
    }
    return switch (transportType) {
      'sim_gateway' => 'ANDROID SIM',
      'external_provider' => 'EXTERNAL API',
      _ => (transportType ?? 'SMS').toUpperCase(),
    };
  }

  @override
  Widget build(BuildContext context) {
    final spec = describe(status, isSimulation: isSimulation);
    final padH = compact ? 8.0 : 10.0;
    final padV = compact ? 3.5 : 5.0;

    return Wrap(
      spacing: 6,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (transportType != null)
          Container(
            padding: EdgeInsets.symmetric(horizontal: padH, vertical: padV),
            decoration: BoxDecoration(
              color: (isSimulation || transportType == 'simulation'
                      ? AppTheme.cyanAccent
                      : AppTheme.electricViolet)
                  .withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: (isSimulation || transportType == 'simulation'
                        ? AppTheme.cyanAccent
                        : AppTheme.electricViolet)
                    .withValues(alpha: 0.35),
              ),
            ),
            child: Text(
              describeTransport(transportType, isSimulation: isSimulation),
              style: TextStyle(
                fontSize: compact ? 10 : 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.4,
                color: isSimulation || transportType == 'simulation'
                    ? AppTheme.cyanAccent
                    : AppTheme.electricViolet,
              ),
            ),
          ),
        Container(
          padding: EdgeInsets.symmetric(horizontal: padH, vertical: padV),
          decoration: BoxDecoration(
            color: spec.color.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: spec.color.withValues(alpha: 0.40)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(spec.icon, size: compact ? 12.5 : 14, color: spec.color),
              const SizedBox(width: 5),
              Text(
                spec.label,
                style: TextStyle(
                  fontSize: compact ? 11 : 12,
                  fontWeight: FontWeight.w600,
                  color: spec.color,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
