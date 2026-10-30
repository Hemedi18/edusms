import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../platform/platform_capabilities.dart';

@immutable
class SimSlotInfo {
  const SimSlotInfo({
    required this.slotIndex,
    required this.subscriptionId,
    required this.carrierName,
    required this.displayName,
    required this.countryIso,
    required this.numberHint,
  });

  final int slotIndex;
  final int subscriptionId;
  final String carrierName;
  final String displayName;
  final String countryIso;
  final String numberHint;

  factory SimSlotInfo.fromMap(Map<dynamic, dynamic> map) {
    return SimSlotInfo(
      slotIndex: (map['slot_index'] as num?)?.toInt() ?? 0,
      subscriptionId: (map['subscription_id'] as num?)?.toInt() ?? 0,
      carrierName: (map['carrier_name'] ?? '').toString(),
      displayName: (map['display_name'] ?? 'SIM').toString(),
      countryIso: (map['country_iso'] ?? '').toString(),
      numberHint: (map['number_hint'] ?? map['phone_number'] ?? '').toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'slot_index': slotIndex,
        'subscription_id': subscriptionId,
        'carrier_name': carrierName,
        'display_name': displayName,
        'country_iso': countryIso,
        'number_hint': numberHint,
        'phone_number': numberHint,
      };
}

@immutable
class NativeGatewayDiagnostics {
  const NativeGatewayDiagnostics({
    required this.platform,
    required this.supportsPhysicalSimGateway,
    required this.manufacturer,
    required this.deviceModel,
    required this.osVersion,
    required this.deviceIdentity,
    required this.permissionsState,
    required this.simAvailable,
    required this.simSlots,
    required this.selectedSimSlot,
    required this.networkType,
    required this.carrierName,
    required this.batteryLevel,
    required this.isCharging,
    required this.isDefaultSmsApp,
    required this.gatewayConfigured,
    required this.gatewayEnabled,
    required this.gatewayPaused,
    required this.serviceRunning,
    required this.autoResumeOnBoot,
    required this.offlineInboundQueueCount,
    required this.offlineStatusQueueCount,
    required this.lastHeartbeatAt,
    required this.lastError,
  });

  final String platform;
  final bool supportsPhysicalSimGateway;
  final String manufacturer;
  final String deviceModel;
  final String osVersion;
  final String deviceIdentity;
  final Map<String, bool> permissionsState;
  final bool simAvailable;
  final List<SimSlotInfo> simSlots;
  final int selectedSimSlot;
  final String networkType;
  final String carrierName;
  final int? batteryLevel;
  final bool isCharging;
  final bool isDefaultSmsApp;
  final bool gatewayConfigured;
  final bool gatewayEnabled;
  final bool gatewayPaused;
  final bool serviceRunning;
  final bool autoResumeOnBoot;
  final int offlineInboundQueueCount;
  final int offlineStatusQueueCount;
  final String lastHeartbeatAt;
  final String lastError;

  int get totalOfflineQueued => offlineInboundQueueCount + offlineStatusQueueCount;

  bool get hasRequiredSmsPermissions =>
      (permissionsState['SEND_SMS'] ?? false) &&
      (permissionsState['RECEIVE_SMS'] ?? false);

  factory NativeGatewayDiagnostics.fromMap(Map<dynamic, dynamic> map) {
    final rawPerms = map['permissions_state'];
    final perms = <String, bool>{};
    if (rawPerms is Map) {
      for (final entry in rawPerms.entries) {
        perms[entry.key.toString()] = entry.value == true;
      }
    }

    final rawSlots = map['sim_slots'];
    final slots = <SimSlotInfo>[];
    if (rawSlots is List) {
      for (final item in rawSlots) {
        if (item is Map) {
          slots.add(SimSlotInfo.fromMap(item));
        }
      }
    }

    return NativeGatewayDiagnostics(
      platform: (map['platform'] ?? 'android').toString(),
      supportsPhysicalSimGateway: map['supports_physical_sim_gateway'] != false,
      manufacturer: (map['manufacturer'] ?? 'Android').toString(),
      deviceModel: (map['device_model'] ?? 'Handset').toString(),
      osVersion: (map['os_version'] ?? 'Android').toString(),
      deviceIdentity: (map['device_identity'] ?? '').toString(),
      permissionsState: perms,
      simAvailable: map['sim_available'] == true,
      simSlots: slots,
      selectedSimSlot: (map['selected_sim_slot'] as num?)?.toInt() ?? 0,
      networkType: (map['network_type'] ?? 'UNKNOWN').toString(),
      carrierName: (map['carrier_name'] ?? '').toString(),
      batteryLevel: (map['battery_level'] as num?)?.toInt(),
      isCharging: map['is_charging'] == true,
      isDefaultSmsApp: map['is_default_sms_app'] == true,
      gatewayConfigured: map['gateway_configured'] == true,
      gatewayEnabled: map['gateway_enabled'] == true,
      gatewayPaused: map['gateway_paused'] == true,
      serviceRunning: map['service_running'] == true,
      autoResumeOnBoot: map['auto_resume_on_boot'] == true,
      offlineInboundQueueCount: (map['offline_inbound_queue_count'] as num?)?.toInt() ?? 0,
      offlineStatusQueueCount: (map['offline_status_queue_count'] as num?)?.toInt() ?? 0,
      lastHeartbeatAt: (map['last_heartbeat_at'] ?? '').toString(),
      lastError: (map['last_error'] ?? '').toString(),
    );
  }

  factory NativeGatewayDiagnostics.companionFallback(PlatformCapabilities caps) {
    return NativeGatewayDiagnostics(
      platform: caps.isIos ? 'ios' : caps.platformName,
      supportsPhysicalSimGateway: false,
      manufacturer: caps.isIos ? 'Apple' : 'Companion',
      deviceModel: caps.isIos ? 'iPhone Companion' : 'Desktop/Companion',
      osVersion: caps.isIos ? 'iOS' : caps.platformName,
      deviceIdentity: 'companion-${caps.platformName}',
      permissionsState: const {
        'SEND_SMS': false,
        'RECEIVE_SMS': false,
        'READ_SMS': false,
        'READ_PHONE_STATE': false,
      },
      simAvailable: false,
      simSlots: const [],
      selectedSimSlot: 0,
      networkType: 'WIFI/COMPANION',
      carrierName: '',
      batteryLevel: null,
      isCharging: false,
      isDefaultSmsApp: false,
      gatewayConfigured: false,
      gatewayEnabled: false,
      gatewayPaused: false,
      serviceRunning: false,
      autoResumeOnBoot: false,
      offlineInboundQueueCount: 0,
      offlineStatusQueueCount: 0,
      lastHeartbeatAt: '',
      lastError: '',
    );
  }
}

/// Safe cross-platform wrapper around MethodChannel('com.edusms.gateway/methods')
/// and EventChannel('com.edusms.gateway/events').
class NativeGatewayBridge {
  NativeGatewayBridge({
    required this._capabilities,
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
  })  : _methodChannel = methodChannel ?? const MethodChannel(methodChannelName),
        _eventChannel = eventChannel ?? const EventChannel(eventChannelName);

  static const String methodChannelName = 'com.edusms.gateway/methods';
  static const String eventChannelName = 'com.edusms.gateway/events';

  final PlatformCapabilities _capabilities;
  final MethodChannel _methodChannel;
  final EventChannel _eventChannel;

  bool get supportsPhysicalSimGateway => _capabilities.supportsPhysicalSimGateway;

  Stream<Map<String, dynamic>> get events {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return const Stream<Map<String, dynamic>>.empty();
    }
    return _eventChannel.receiveBroadcastStream().map((dynamic raw) {
      if (raw is Map) {
        return Map<String, dynamic>.from(raw);
      }
      return <String, dynamic>{'raw': raw};
    });
  }

  Future<NativeGatewayDiagnostics> getDiagnostics() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    try {
      final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('getDiagnostics');
      if (res != null) {
        return NativeGatewayDiagnostics.fromMap(res);
      }
    } on MissingPluginException {
      // Safe fallback when running headless tests without mock channel registered
    }
    return NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<Map<String, bool>> requestPermissions() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return const {
        'SEND_SMS': false,
        'RECEIVE_SMS': false,
        'READ_SMS': false,
        'READ_PHONE_STATE': false,
      };
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('requestPermissions');
    if (res == null) return const {};
    return res.map((k, v) => MapEntry(k.toString(), v == true));
  }

  Future<NativeGatewayDiagnostics> configureGateway({
    required String apiBaseUrl,
    String? gatewayToken,
    String? deviceIdentity,
    int? selectedSimSlot,
    bool? autoResumeOnBoot,
  }) async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>(
      'configureGateway',
      <String, dynamic>{
        'apiBaseUrl': apiBaseUrl,
        'gatewayToken': gatewayToken,
        'deviceIdentity': deviceIdentity,
        'selectedSimSlot': selectedSimSlot,
        'autoResumeOnBoot': autoResumeOnBoot,
      },
    );
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<NativeGatewayDiagnostics> startGatewayService() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('startGatewayService');
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<NativeGatewayDiagnostics> pauseGatewayService() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('pauseGatewayService');
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<NativeGatewayDiagnostics> resumeGatewayService() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('resumeGatewayService');
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<NativeGatewayDiagnostics> stopGatewayService() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('stopGatewayService');
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<NativeGatewayDiagnostics> syncNow() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return NativeGatewayDiagnostics.companionFallback(_capabilities);
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('syncNow');
    return res != null
        ? NativeGatewayDiagnostics.fromMap(res)
        : NativeGatewayDiagnostics.companionFallback(_capabilities);
  }

  Future<bool> requestDefaultSmsRole() async {
    if (!_capabilities.supportsPhysicalSimGateway) {
      return false;
    }
    final res = await _methodChannel.invokeMapMethod<dynamic, dynamic>('requestDefaultSmsRole');
    return res?['is_default_sms_app'] == true;
  }

  Future<void> clearGatewayCredentials() async {
    if (!_capabilities.supportsPhysicalSimGateway) return;
    try {
      await _methodChannel.invokeMethod<dynamic>('clearGatewayCredentials');
    } on MissingPluginException {
      // Ignore in headless tests without channel mock
    }
  }
}

final nativeGatewayBridgeProvider = Provider<NativeGatewayBridge>((ref) {
  final caps = ref.watch(platformCapabilitiesProvider);
  return NativeGatewayBridge(capabilities: caps);
});
