import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/message_models.dart';

class MessagingRepository {
  MessagingRepository(this._api);

  final ApiClient _api;

  Future<List<SmsMessage>> listMessages({
    String? search,
    bool? isSimulation,
    bool? isAutoReply,
    String? status,
  }) async {
    final params = <String, dynamic>{};
    if (search != null && search.trim().isNotEmpty) {
      params['search'] = search.trim();
    }
    if (isSimulation != null) {
      params['is_simulation'] = isSimulation.toString();
    }
    if (isAutoReply != null) {
      params['is_auto_reply'] = isAutoReply.toString();
    }
    if (status != null && status.isNotEmpty) {
      params['status'] = status;
    }

    final data = await _api.get('/api/v1/messages/', queryParameters: params);
    return ApiClient.extractList(data).map(SmsMessage.fromJson).toList();
  }

  Future<SmsMessage> sendMessage({
    required String recipientNumber,
    required String body,
    required String transportType,
    String? deviceId,
    int? simSlot,
    String? senderIdentityId,
    String simulatedOutcome = 'simulated_delivered',
  }) async {
    final data = await _api.post(
      '/api/v1/messages/',
      idempotencyKey: ApiClient.generateIdempotencyKey('sms'),
      data: {
        'recipient_number': recipientNumber.trim(),
        'body': body.trim(),
        'transport_type': transportType,
        if (deviceId != null && deviceId.isNotEmpty) 'device_id': deviceId,
        'sim_slot': ?simSlot,
        if (senderIdentityId != null && senderIdentityId.isNotEmpty)
          'sender_identity_id': senderIdentityId,
        'simulated_outcome': simulatedOutcome,
      },
    );
    return SmsMessage.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<SmsMessage> cancelMessage(String messageId) async {
    final data = await _api.post('/api/v1/messages/$messageId/cancel/');
    return SmsMessage.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<SmsMessage> approveReply(String messageId) async {
    final data = await _api.post('/api/v1/messages/$messageId/approve-reply/');
    return SmsMessage.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<SenderIdentityItem>> listSenderIdentities() async {
    final data = await _api.get('/api/v1/sender-identities/');
    return ApiClient.extractList(data).map(SenderIdentityItem.fromJson).toList();
  }

  Future<SenderIdentityItem> createSenderIdentity({
    required String label,
    required String identityType,
    String? deviceId,
    int? simSlot,
    String providerName = '',
    String providerBaseUrl = '',
    String alphanumericSenderId = '',
    String providerApiKey = '',
  }) async {
    final data = await _api.post(
      '/api/v1/sender-identities/',
      data: {
        'label': label.trim(),
        'identity_type': identityType,
        if (deviceId != null && deviceId.isNotEmpty) 'device': deviceId,
        'sim_slot': ?simSlot,
        'provider_name': providerName.trim(),
        'provider_base_url': providerBaseUrl.trim(),
        'alphanumeric_sender_id': alphanumericSenderId.trim(),
        if (providerApiKey.trim().isNotEmpty) 'provider_api_key': providerApiKey.trim(),
      },
    );
    return SenderIdentityItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> deleteSenderIdentity(String id) async {
    await _api.delete('/api/v1/sender-identities/$id/');
  }

  Future<Map<String, dynamic>> injectSimulatedInbound({
    required String senderNumber,
    required String body,
  }) async {
    final data = await _api.post(
      '/api/v1/simulation/inject-inbound/',
      data: {
        'sender_number': senderNumber.trim(),
        'body': body.trim(),
      },
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<Map<String, dynamic>> seedDemoDataset() async {
    final data = await _api.post('/api/v1/simulation/seed-demo/');
    return Map<String, dynamic>.from(data as Map);
  }

  Future<Map<String, dynamic>> resetSimulationData() async {
    final data = await _api.post('/api/v1/simulation/reset/');
    return Map<String, dynamic>.from(data as Map);
  }
}

final messagingRepositoryProvider = Provider<MessagingRepository>((ref) {
  return MessagingRepository(ref.watch(apiClientProvider));
});
