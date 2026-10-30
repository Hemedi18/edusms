import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/developer_models.dart';

class DeveloperRepository {
  DeveloperRepository(this._api);

  final ApiClient _api;

  Future<List<ApiKeyItem>> listApiKeys() async {
    final data = await _api.get('/api/v1/developers/api-keys/');
    return ApiClient.extractList(data).map(ApiKeyItem.fromJson).toList();
  }

  Future<ApiKeyItem> createApiKey({
    required String name,
    required List<String> scopes,
    required bool simulationOnly,
    int rateLimitPerMinute = 60,
  }) async {
    final data = await _api.post(
      '/api/v1/developers/api-keys/',
      data: {
        'name': name.trim(),
        'scopes': scopes,
        'simulation_only': simulationOnly,
        'rate_limit_per_minute': rateLimitPerMinute,
      },
    );
    return ApiKeyItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<ApiKeyItem> rotateApiKey(String id) async {
    final data = await _api.post('/api/v1/developers/api-keys/$id/rotate/');
    return ApiKeyItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<ApiKeyItem> revokeApiKey(String id) async {
    final data = await _api.post('/api/v1/developers/api-keys/$id/revoke/');
    return ApiKeyItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<WebhookEndpointItem>> listWebhooks() async {
    final data = await _api.get('/api/v1/developers/webhooks/');
    return ApiClient.extractList(data).map(WebhookEndpointItem.fromJson).toList();
  }

  Future<WebhookEndpointItem> createWebhook({
    required String name,
    required String url,
    required List<String> events,
    bool includeSimulationEvents = true,
  }) async {
    final data = await _api.post(
      '/api/v1/developers/webhooks/',
      data: {
        'name': name.trim(),
        'url': url.trim(),
        'events': events,
        'include_simulation_events': includeSimulationEvents,
        'is_active': true,
      },
    );
    return WebhookEndpointItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<Map<String, dynamic>> testWebhook(String id) async {
    final data = await _api.post('/api/v1/developers/webhooks/$id/test/');
    return Map<String, dynamic>.from(data as Map);
  }

  Future<void> deleteWebhook(String id) async {
    await _api.delete('/api/v1/developers/webhooks/$id/');
  }

  Future<List<WebhookDeliveryEventItem>> listWebhookDeliveries() async {
    final data = await _api.get('/api/v1/developers/webhook-deliveries/');
    return ApiClient.extractList(data).map(WebhookDeliveryEventItem.fromJson).toList();
  }

  Future<Map<String, dynamic>> retryWebhookDelivery(String id) async {
    final data = await _api.post('/api/v1/developers/webhook-deliveries/$id/retry/');
    return Map<String, dynamic>.from(data as Map);
  }
}

final developerRepositoryProvider = Provider<DeveloperRepository>((ref) {
  return DeveloperRepository(ref.watch(apiClientProvider));
});
