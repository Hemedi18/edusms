import 'package:flutter/foundation.dart';

import '../../core/network/native_gateway_bridge.dart';

@immutable
class PairedDevice {
  const PairedDevice({
    required this.id,
    required this.name,
    required this.deviceIdentity,
    required this.platform,
    required this.manufacturer,
    required this.deviceModel,
    required this.osVersion,
    required this.gatewayTokenPrefix,
    required this.isEnabled,
    required this.isPaused,
    required this.connectionStatus,
    required this.isOnline,
    required this.canTransmitRealSms,
    required this.simAvailable,
    required this.simSlots,
    required this.selectedSimSlot,
    required this.networkType,
    required this.carrierName,
    required this.batteryLevel,
    required this.isCharging,
    required this.isDefaultSmsApp,
    required this.permissionsState,
    required this.incomingMessageCount,
    required this.outgoingMessageCount,
    required this.failedTransmissionCount,
    required this.pendingJobsCount,
    required this.lastError,
    required this.recommendedAction,
    required this.lastHeartbeatAt,
  });

  final String id;
  final String name;
  final String deviceIdentity;
  final String platform;
  final String manufacturer;
  final String deviceModel;
  final String osVersion;
  final String gatewayTokenPrefix;
  final bool isEnabled;
  final bool isPaused;
  final String connectionStatus;
  final bool isOnline;
  final bool canTransmitRealSms;
  final bool simAvailable;
  final List<SimSlotInfo> simSlots;
  final int selectedSimSlot;
  final String networkType;
  final String carrierName;
  final int? batteryLevel;
  final bool isCharging;
  final bool isDefaultSmsApp;
  final Map<String, bool> permissionsState;
  final int incomingMessageCount;
  final int outgoingMessageCount;
  final int failedTransmissionCount;
  final int pendingJobsCount;
  final String lastError;
  final String recommendedAction;
  final String lastHeartbeatAt;

  factory PairedDevice.fromJson(Map<String, dynamic> json) {
    final slots = <SimSlotInfo>[];
    final rawSlots = json['sim_slots'];
    if (rawSlots is List) {
      for (final s in rawSlots) {
        if (s is Map) slots.add(SimSlotInfo.fromMap(s));
      }
    }
    final perms = <String, bool>{};
    final rawPerms = json['permissions_state'];
    if (rawPerms is Map) {
      for (final entry in rawPerms.entries) {
        perms[entry.key.toString()] = entry.value == true;
      }
    }

    return PairedDevice(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? 'Gateway Handset').toString(),
      deviceIdentity: (json['device_identity'] ?? '').toString(),
      platform: (json['platform'] ?? 'android').toString(),
      manufacturer: (json['manufacturer'] ?? '').toString(),
      deviceModel: (json['device_model'] ?? '').toString(),
      osVersion: (json['os_version'] ?? '').toString(),
      gatewayTokenPrefix: (json['gateway_token_prefix'] ?? '').toString(),
      isEnabled: json['is_enabled'] != false,
      isPaused: json['is_paused'] == true,
      connectionStatus: (json['connection_status'] ?? 'offline').toString(),
      isOnline: json['is_online'] == true,
      canTransmitRealSms: json['can_transmit_real_sms'] == true,
      simAvailable: json['sim_available'] == true,
      simSlots: slots,
      selectedSimSlot: (json['selected_sim_slot'] as num?)?.toInt() ?? 0,
      networkType: (json['network_type'] ?? '').toString(),
      carrierName: (json['carrier_name'] ?? '').toString(),
      batteryLevel: (json['battery_level'] as num?)?.toInt(),
      isCharging: json['is_charging'] == true,
      isDefaultSmsApp: json['is_default_sms_app'] == true,
      permissionsState: perms,
      incomingMessageCount: (json['incoming_message_count'] as num?)?.toInt() ?? 0,
      outgoingMessageCount: (json['outgoing_message_count'] as num?)?.toInt() ?? 0,
      failedTransmissionCount: (json['failed_transmission_count'] as num?)?.toInt() ?? 0,
      pendingJobsCount: (json['pending_jobs_count'] as num?)?.toInt() ?? 0,
      lastError: (json['last_error'] ?? '').toString(),
      recommendedAction: (json['recommended_action'] ?? '').toString(),
      lastHeartbeatAt: (json['last_heartbeat_at'] ?? '').toString(),
    );
  }
}

@immutable
class PairingInitSession {
  const PairingInitSession({
    required this.pairingId,
    required this.pairingCode,
    required this.qrPayload,
    required this.deviceNameHint,
    required this.expiresAt,
    required this.ttlSeconds,
  });

  final String pairingId;
  final String pairingCode;
  final String qrPayload;
  final String deviceNameHint;
  final String expiresAt;
  final int ttlSeconds;

  factory PairingInitSession.fromJson(Map<String, dynamic> json) {
    return PairingInitSession(
      pairingId: (json['pairing_id'] ?? '').toString(),
      pairingCode: (json['pairing_code'] ?? '').toString(),
      qrPayload: (json['qr_payload'] ?? '').toString(),
      deviceNameHint: (json['device_name_hint'] ?? 'Android SIM Gateway').toString(),
      expiresAt: (json['expires_at'] ?? '').toString(),
      ttlSeconds: (json['ttl_seconds'] as num?)?.toInt() ?? 600,
    );
  }
}

@immutable
class PairingConfirmResult {
  const PairingConfirmResult({
    required this.device,
    required this.gatewayToken,
  });

  final PairedDevice device;
  final String gatewayToken;

  factory PairingConfirmResult.fromJson(Map<String, dynamic> json) {
    return PairingConfirmResult(
      device: PairedDevice.fromJson(
        Map<String, dynamic>.from(json['device'] as Map),
      ),
      gatewayToken: (json['gateway_token'] ?? '').toString(),
    );
  }
}
