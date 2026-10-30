import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/native_gateway_bridge.dart';
import '../../core/storage/secure_token_storage.dart';
import '../models/device_models.dart';

class GatewayRepository {
  GatewayRepository({
    required ApiClient apiClient,
    required TokenStorage tokenStorage,
    required NativeGatewayBridge nativeBridge,
  })  : _api = apiClient,
        _tokens = tokenStorage,
        _bridge = nativeBridge;

  final ApiClient _api;
  final TokenStorage _tokens;
  final NativeGatewayBridge _bridge;

  Future<List<PairedDevice>> listDevices({bool includeRevoked = false}) async {
    final data = await _api.get(
      '/api/v1/devices/',
      queryParameters: includeRevoked ? {'include_revoked': 'true'} : null,
    );
    return ApiClient.extractList(data).map(PairedDevice.fromJson).toList();
  }

  Future<PairingInitSession> initPairingSession({
    String deviceName = 'Android SIM Gateway',
  }) async {
    final data = await _api.post(
      '/api/v1/devices/pair/init/',
      data: {'device_name': deviceName.trim()},
    );
    return PairingInitSession.fromJson(Map<String, dynamic>.from(data as Map));
  }

  /// Parses either a 6-character human pairing code OR a scanned/pasted QR JSON payload,
  /// collects real hardware & SIM diagnostics, confirms pairing with `/api/v1/devices/pair/confirm/`,
  /// stores `gateway_token` in SecureTokenStorage, and configures NativeGatewayBridge!
  Future<PairingConfirmResult> confirmHandsetPairing({
    required String codeOrQrPayload,
    String? customDeviceName,
  }) async {
    var pairingCode = codeOrQrPayload.trim();
    String? pairingId;
    String? qrApiUrl;

    if (pairingCode.startsWith('{')) {
      try {
        final decoded = jsonDecode(pairingCode);
        if (decoded is Map) {
          pairingCode = (decoded['code'] ?? decoded['pairing_code'] ?? '').toString();
          pairingId = decoded['pairing_id']?.toString();
          qrApiUrl = decoded['api_url']?.toString();
        }
      } catch (_) {
        // Treat as raw code if JSON decode fails
      }
    }

    final diag = await _bridge.getDiagnostics();
    final resolvedPlatform = diag.platform == 'ios' ? 'ios' : 'android';
    final resolvedName = (customDeviceName != null && customDeviceName.trim().isNotEmpty)
        ? customDeviceName.trim()
        : '${diag.manufacturer} ${diag.deviceModel}'.trim();

    final response = await _api.post(
      '/api/v1/devices/pair/confirm/',
      data: {
        'pairing_code': pairingCode.toUpperCase(),
        if (pairingId != null && pairingId.isNotEmpty) 'pairing_id': pairingId,
        'device_name': resolvedName,
        'device_identity': diag.deviceIdentity,
        'platform': resolvedPlatform,
        'manufacturer': diag.manufacturer,
        'device_model': diag.deviceModel,
        'os_version': diag.osVersion,
        'app_version': '1.0.0',
        'sim_available': diag.simAvailable,
        'sim_slots': diag.simSlots.map((s) => s.toJson()).toList(),
        'network_type': diag.networkType,
        'carrier_name': diag.carrierName,
        'permissions_state': diag.permissionsState,
        'is_default_sms_app': diag.isDefaultSmsApp,
      },
    );

    final result = PairingConfirmResult.fromJson(
      Map<String, dynamic>.from(response as Map),
    );

    await _tokens.saveGatewayBinding(
      gatewayToken: result.gatewayToken,
      deviceId: result.device.id,
    );

    await _bridge.configureGateway(
      apiBaseUrl: (qrApiUrl != null && qrApiUrl.isNotEmpty) ? qrApiUrl : _api.baseUrl,
      gatewayToken: result.gatewayToken,
      deviceIdentity: result.device.deviceIdentity,
      selectedSimSlot: result.device.selectedSimSlot,
    );

    return result;
  }

  Future<PairedDevice> pauseDevice(String deviceId) async {
    final data = await _api.post('/api/v1/devices/$deviceId/pause/');
    return PairedDevice.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<PairedDevice> resumeDevice(String deviceId) async {
    final data = await _api.post('/api/v1/devices/$deviceId/resume/');
    return PairedDevice.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<PairedDevice> revokeDevice(String deviceId) async {
    final data = await _api.post('/api/v1/devices/$deviceId/revoke/');
    final localId = await _tokens.getPairedDeviceId();
    if (localId == deviceId) {
      await _tokens.clearGatewayBinding();
      await _bridge.clearGatewayCredentials();
    }
    return PairedDevice.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<PairedDevice> updateDeviceSimSlot(String deviceId, int simSlot) async {
    final data = await _api.patch(
      '/api/v1/devices/$deviceId/',
      data: {'selected_sim_slot': simSlot},
    );
    return PairedDevice.fromJson(Map<String, dynamic>.from(data as Map));
  }
}

final gatewayRepositoryProvider = Provider<GatewayRepository>((ref) {
  return GatewayRepository(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
    nativeBridge: ref.watch(nativeGatewayBridgeProvider),
  );
});
