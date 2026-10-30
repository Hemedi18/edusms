import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/storage/secure_token_storage.dart';
import '../models/user_models.dart';

class AuthRepository {
  AuthRepository({
    required ApiClient apiClient,
    required TokenStorage tokenStorage,
  })  : _api = apiClient,
        _tokens = tokenStorage;

  final ApiClient _api;
  final TokenStorage _tokens;

  Future<UserProfile> login({
    required String email,
    required String password,
    String? mfaCode,
    String deviceLabel = 'EduSMS Mobile',
  }) async {
    final data = await _api.post(
      '/api/v1/auth/login/',
      skipAuth: true,
      data: {
        'email': email.trim(),
        'password': password,
        if (mfaCode != null && mfaCode.trim().isNotEmpty) 'mfa_code': mfaCode.trim(),
        'device_label': deviceLabel,
      },
    );
    final map = Map<String, dynamic>.from(data as Map);
    await _tokens.saveSession(
      accessToken: map['access'].toString(),
      refreshToken: map['refresh'].toString(),
      sessionId: map['session_id']?.toString(),
    );
    return UserProfile.fromJson(Map<String, dynamic>.from(map['user'] as Map));
  }

  Future<UserProfile> register({
    required String fullName,
    required String email,
    required String password,
    String organization = '',
    String timezone = 'Africa/Dar_es_Salaam',
    String defaultCountryCode = 'TZ',
  }) async {
    final data = await _api.post(
      '/api/v1/auth/register/',
      skipAuth: true,
      data: {
        'full_name': fullName.trim(),
        'email': email.trim(),
        'password': password,
        'organization': organization.trim(),
        'timezone': timezone,
        'default_country_code': defaultCountryCode,
      },
    );
    final map = Map<String, dynamic>.from(data as Map);
    await _tokens.saveSession(
      accessToken: map['access'].toString(),
      refreshToken: map['refresh'].toString(),
      sessionId: map['session_id']?.toString(),
    );
    return UserProfile.fromJson(Map<String, dynamic>.from(map['user'] as Map));
  }

  Future<void> logout() async {
    final refresh = await _tokens.getRefreshToken();
    try {
      if (refresh != null && refresh.isNotEmpty) {
        await _api.post('/api/v1/auth/logout/', data: {'refresh': refresh});
      }
    } catch (_) {
      // Always clear local session even if server is unreachable
    } finally {
      await _tokens.clearSession();
    }
  }

  Future<UserProfile> getCurrentUser() async {
    final data = await _api.get('/api/v1/auth/me/');
    return UserProfile.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<UserProfile> updateProfile(Map<String, dynamic> patch) async {
    final data = await _api.patch('/api/v1/auth/me/', data: patch);
    return UserProfile.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.post(
      '/api/v1/auth/change-password/',
      data: {
        'current_password': currentPassword,
        'new_password': newPassword,
      },
    );
  }

  Future<void> requestPasswordReset(String email) async {
    await _api.post(
      '/api/v1/auth/password-reset/',
      skipAuth: true,
      data: {'email': email.trim()},
    );
  }

  Future<void> confirmPasswordReset({
    required String token,
    required String newPassword,
  }) async {
    await _api.post(
      '/api/v1/auth/password-reset/confirm/',
      skipAuth: true,
      data: {
        'token': token.trim(),
        'new_password': newPassword,
      },
    );
  }

  Future<List<UserSessionItem>> listSessions() async {
    final currentId = await _tokens.getSessionId();
    final data = await _api.get(
      '/api/v1/auth/sessions/',
      queryParameters: currentId != null ? {'current_session_id': currentId} : null,
    );
    return ApiClient.extractList(data).map(UserSessionItem.fromJson).toList();
  }

  Future<void> revokeSession(String sessionId) async {
    await _api.post('/api/v1/auth/sessions/$sessionId/revoke/');
  }

  Future<Map<String, String>> setupMfa() async {
    final data = await _api.post('/api/v1/auth/mfa/setup/');
    final map = Map<String, dynamic>.from(data as Map);
    return {
      'secret': (map['secret'] ?? '').toString(),
      'provisioning_uri': (map['provisioning_uri'] ?? '').toString(),
    };
  }

  Future<List<String>> verifyAndEnableMfa(String code) async {
    final data = await _api.post('/api/v1/auth/mfa/verify/', data: {'code': code.trim()});
    final map = Map<String, dynamic>.from(data as Map);
    final raw = map['recovery_codes'];
    if (raw is List) {
      return raw.map((e) => e.toString()).toList();
    }
    return const [];
  }

  Future<void> disableMfa(String password) async {
    await _api.post('/api/v1/auth/mfa/disable/', data: {'password': password});
  }

  Future<Map<String, dynamic>> exportAccountData() async {
    final data = await _api.get('/api/v1/auth/export/');
    return Map<String, dynamic>.from(data as Map);
  }

  Future<void> deleteAccount({
    required String password,
    required String confirmation,
  }) async {
    await _api.post(
      '/api/v1/auth/delete-account/',
      data: {
        'password': password,
        'confirmation': confirmation.trim(),
      },
    );
    await _tokens.clearSession();
    await _tokens.clearGatewayBinding();
  }

  Future<List<NotificationItem>> listNotifications() async {
    final data = await _api.get('/api/v1/notifications/');
    return ApiClient.extractList(data).map(NotificationItem.fromJson).toList();
  }

  Future<void> markNotificationRead(String id) async {
    await _api.post('/api/v1/notifications/$id/read/');
  }

  Future<int> markAllNotificationsRead() async {
    final data = await _api.post('/api/v1/notifications/mark-all-read/');
    if (data is Map) {
      return (data['marked_read_count'] as num?)?.toInt() ?? 0;
    }
    return 0;
  }

  Future<AnalyticsOverview> getAnalyticsOverview({int days = 14}) async {
    final data = await _api.get(
      '/api/v1/analytics/overview/',
      queryParameters: {'days': days},
    );
    return AnalyticsOverview.fromJson(Map<String, dynamic>.from(data as Map));
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    apiClient: ref.watch(apiClientProvider),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
});
