import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/campaign_models.dart';

class CampaignsRepository {
  CampaignsRepository(this._api);

  final ApiClient _api;

  Future<List<CampaignItem>> listCampaigns() async {
    final data = await _api.get('/api/v1/campaigns/');
    return ApiClient.extractList(data).map(CampaignItem.fromJson).toList();
  }

  Future<AudiencePreviewResult> previewAudience({
    required String messageTemplate,
    required String transportType,
    List<String> groupIds = const [],
    List<String> rawNumbers = const [],
  }) async {
    final data = await _api.post(
      '/api/v1/campaigns/preview-audience/',
      data: {
        'message_template': messageTemplate,
        'transport_type': transportType,
        'group_ids': groupIds,
        'raw_numbers': rawNumbers,
      },
    );
    return AudiencePreviewResult.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<CampaignItem> createCampaign({
    required String name,
    required String messageTemplate,
    required String transportType,
    String? deviceId,
    String? senderIdentityId,
    int? simSlot,
    List<String> groupIds = const [],
    List<String> rawNumbers = const [],
    int interMessageIntervalMs = 1500,
  }) async {
    final data = await _api.post(
      '/api/v1/campaigns/',
      idempotencyKey: ApiClient.generateIdempotencyKey('camp'),
      data: {
        'name': name.trim(),
        'message_template': messageTemplate,
        'transport_type': transportType,
        if (deviceId != null && deviceId.isNotEmpty) 'device': deviceId,
        if (senderIdentityId != null && senderIdentityId.isNotEmpty)
          'sender_identity': senderIdentityId,
        'sim_slot': ?simSlot,
        'group_ids': groupIds,
        'raw_numbers': rawNumbers,
        'inter_message_interval_ms': interMessageIntervalMs,
      },
    );
    return CampaignItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<Map<String, dynamic>> testSendCampaign({
    required String campaignId,
    required String recipientNumber,
  }) async {
    final data = await _api.post(
      '/api/v1/campaigns/$campaignId/test-send/',
      data: {'recipient_number': recipientNumber.trim()},
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<CampaignItem> startCampaign(String id) async {
    final data = await _api.post('/api/v1/campaigns/$id/start/', data: {'send_now': true});
    return CampaignItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<CampaignItem> processBatch(String id, {int batchSize = 25}) async {
    final data = await _api.post(
      '/api/v1/campaigns/$id/process-batch/',
      data: {'batch_size': batchSize},
    );
    final map = Map<String, dynamic>.from(data as Map);
    return CampaignItem.fromJson(Map<String, dynamic>.from(map['campaign'] as Map));
  }

  Future<CampaignItem> pauseCampaign(String id) async {
    final data = await _api.post('/api/v1/campaigns/$id/pause/');
    return CampaignItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<CampaignItem> resumeCampaign(String id) async {
    final data = await _api.post('/api/v1/campaigns/$id/resume/');
    return CampaignItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<CampaignItem> cancelCampaign(String id) async {
    final data = await _api.post('/api/v1/campaigns/$id/cancel/');
    return CampaignItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<CampaignRecipientItem>> listRecipients(String id) async {
    final data = await _api.get('/api/v1/campaigns/$id/recipients/');
    return ApiClient.extractList(data).map(CampaignRecipientItem.fromJson).toList();
  }
}

final campaignsRepositoryProvider = Provider<CampaignsRepository>((ref) {
  return CampaignsRepository(ref.watch(apiClientProvider));
});
