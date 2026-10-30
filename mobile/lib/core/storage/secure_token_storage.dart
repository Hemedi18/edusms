import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Clean abstraction over encrypted credential storage for unit/widget testing.
abstract class TokenStorage {
  Future<String?> getAccessToken();
  Future<String?> getRefreshToken();
  Future<String?> getSessionId();
  Future<String?> getGatewayToken();
  Future<String?> getPairedDeviceId();

  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    String? sessionId,
  });

  Future<void> saveGatewayBinding({
    required String gatewayToken,
    required String deviceId,
  });

  Future<void> clearGatewayBinding();
  Future<void> clearSession();
}

/// Encrypted OS keychain/keystore implementation backed by FlutterSecureStorage.
class SecureTokenStorage implements TokenStorage {
  SecureTokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const String _keyAccess = 'edusms_access_token';
  static const String _keyRefresh = 'edusms_refresh_token';
  static const String _keySessionId = 'edusms_session_id';
  static const String _keyGatewayToken = 'edusms_gateway_token';
  static const String _keyPairedDeviceId = 'edusms_paired_device_id';

  @override
  Future<String?> getAccessToken() => _storage.read(key: _keyAccess);

  @override
  Future<String?> getRefreshToken() => _storage.read(key: _keyRefresh);

  @override
  Future<String?> getSessionId() => _storage.read(key: _keySessionId);

  @override
  Future<String?> getGatewayToken() => _storage.read(key: _keyGatewayToken);

  @override
  Future<String?> getPairedDeviceId() => _storage.read(key: _keyPairedDeviceId);

  @override
  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    String? sessionId,
  }) async {
    await _storage.write(key: _keyAccess, value: accessToken);
    await _storage.write(key: _keyRefresh, value: refreshToken);
    if (sessionId != null && sessionId.isNotEmpty) {
      await _storage.write(key: _keySessionId, value: sessionId);
    }
  }

  @override
  Future<void> saveGatewayBinding({
    required String gatewayToken,
    required String deviceId,
  }) async {
    await _storage.write(key: _keyGatewayToken, value: gatewayToken);
    await _storage.write(key: _keyPairedDeviceId, value: deviceId);
  }

  @override
  Future<void> clearGatewayBinding() async {
    await _storage.delete(key: _keyGatewayToken);
    await _storage.delete(key: _keyPairedDeviceId);
  }

  @override
  Future<void> clearSession() async {
    await _storage.delete(key: _keyAccess);
    await _storage.delete(key: _keyRefresh);
    await _storage.delete(key: _keySessionId);
  }
}

/// Deterministic in-memory token store for fast isolated unit and widget tests.
class InMemoryTokenStorage implements TokenStorage {
  InMemoryTokenStorage({
    this.accessToken,
    this.refreshToken,
    this.sessionId,
    this.gatewayToken,
    this.pairedDeviceId,
  });

  String? accessToken;
  String? refreshToken;
  String? sessionId;
  String? gatewayToken;
  String? pairedDeviceId;

  @override
  Future<String?> getAccessToken() async => accessToken;

  @override
  Future<String?> getRefreshToken() async => refreshToken;

  @override
  Future<String?> getSessionId() async => sessionId;

  @override
  Future<String?> getGatewayToken() async => gatewayToken;

  @override
  Future<String?> getPairedDeviceId() async => pairedDeviceId;

  @override
  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    String? sessionId,
  }) async {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (sessionId != null) {
      this.sessionId = sessionId;
    }
  }

  @override
  Future<void> saveGatewayBinding({
    required String gatewayToken,
    required String deviceId,
  }) async {
    this.gatewayToken = gatewayToken;
    pairedDeviceId = deviceId;
  }

  @override
  Future<void> clearGatewayBinding() async {
    gatewayToken = null;
    pairedDeviceId = null;
  }

  @override
  Future<void> clearSession() async {
    accessToken = null;
    refreshToken = null;
    sessionId = null;
  }
}

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return SecureTokenStorage();
});
