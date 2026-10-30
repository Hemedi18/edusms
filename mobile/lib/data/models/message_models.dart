import 'package:flutter/foundation.dart';

@immutable
class DeliveryEventItem {
  const DeliveryEventItem({
    required this.id,
    required this.eventType,
    required this.rawStatusCode,
    required this.description,
    required this.isSimulation,
    required this.occurredAt,
  });

  final String id;
  final String eventType;
  final String rawStatusCode;
  final String description;
  final bool isSimulation;
  final String occurredAt;

  factory DeliveryEventItem.fromJson(Map<String, dynamic> json) {
    return DeliveryEventItem(
      id: (json['id'] ?? '').toString(),
      eventType: (json['event_type'] ?? '').toString(),
      rawStatusCode: (json['raw_status_code'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      isSimulation: json['is_simulation'] == true,
      occurredAt: (json['occurred_at'] ?? '').toString(),
    );
  }
}

@immutable
class MessageAttemptItem {
  const MessageAttemptItem({
    required this.id,
    required this.attemptNumber,
    required this.transportType,
    required this.simSlot,
    required this.status,
    required this.claimedAt,
    required this.acknowledgedAt,
    required this.completedAt,
    required this.androidResultCode,
    required this.errorDetail,
  });

  final String id;
  final int attemptNumber;
  final String transportType;
  final int? simSlot;
  final String status;
  final String claimedAt;
  final String acknowledgedAt;
  final String completedAt;
  final String androidResultCode;
  final String errorDetail;

  factory MessageAttemptItem.fromJson(Map<String, dynamic> json) {
    return MessageAttemptItem(
      id: (json['id'] ?? '').toString(),
      attemptNumber: (json['attempt_number'] as num?)?.toInt() ?? 1,
      transportType: (json['transport_type'] ?? '').toString(),
      simSlot: (json['sim_slot'] as num?)?.toInt(),
      status: (json['status'] ?? '').toString(),
      claimedAt: (json['claimed_at'] ?? '').toString(),
      acknowledgedAt: (json['acknowledged_at'] ?? '').toString(),
      completedAt: (json['completed_at'] ?? '').toString(),
      androidResultCode: (json['android_result_code'] ?? '').toString(),
      errorDetail: (json['error_detail'] ?? '').toString(),
    );
  }
}

@immutable
class SmsMessage {
  const SmsMessage({
    required this.id,
    required this.direction,
    required this.transportType,
    required this.isSimulation,
    required this.senderNumber,
    required this.recipientNumber,
    required this.contactName,
    required this.deviceName,
    required this.simSlot,
    required this.body,
    required this.bodyRedacted,
    required this.status,
    required this.matchedPolicySummary,
    required this.isAutoReply,
    required this.aiGenerated,
    required this.failureCode,
    required this.failureReason,
    required this.createdAt,
    required this.submittedAt,
    required this.deliveredAt,
    required this.attempts,
    required this.deliveryEvents,
  });

  final String id;
  final String direction;
  final String transportType;
  final bool isSimulation;
  final String senderNumber;
  final String recipientNumber;
  final String contactName;
  final String deviceName;
  final int? simSlot;
  final String body;
  final bool bodyRedacted;
  final String status;
  final String matchedPolicySummary;
  final bool isAutoReply;
  final bool aiGenerated;
  final String failureCode;
  final String failureReason;
  final String createdAt;
  final String submittedAt;
  final String deliveredAt;
  final List<MessageAttemptItem> attempts;
  final List<DeliveryEventItem> deliveryEvents;

  bool get canCancel => status == 'queued' || status == 'pending_approval';
  bool get isPendingApproval => status == 'pending_approval';

  factory SmsMessage.fromJson(Map<String, dynamic> json) {
    final attemptsList = <MessageAttemptItem>[];
    if (json['attempts'] is List) {
      for (final a in json['attempts'] as List) {
        if (a is Map) {
          attemptsList.add(MessageAttemptItem.fromJson(Map<String, dynamic>.from(a)));
        }
      }
    }
    final eventsList = <DeliveryEventItem>[];
    if (json['delivery_events'] is List) {
      for (final ev in json['delivery_events'] as List) {
        if (ev is Map) {
          eventsList.add(DeliveryEventItem.fromJson(Map<String, dynamic>.from(ev)));
        }
      }
    }

    return SmsMessage(
      id: (json['id'] ?? '').toString(),
      direction: (json['direction'] ?? 'outbound').toString(),
      transportType: (json['transport_type'] ?? 'simulation').toString(),
      isSimulation: json['is_simulation'] == true,
      senderNumber: (json['sender_number'] ?? '').toString(),
      recipientNumber: (json['recipient_number'] ?? '').toString(),
      contactName: (json['contact_name'] ?? '').toString(),
      deviceName: (json['device_name'] ?? '').toString(),
      simSlot: (json['sim_slot'] as num?)?.toInt(),
      body: (json['body'] ?? '').toString(),
      bodyRedacted: json['body_redacted'] == true,
      status: (json['status'] ?? 'queued').toString(),
      matchedPolicySummary: (json['matched_policy_summary'] ?? '').toString(),
      isAutoReply: json['is_auto_reply'] == true,
      aiGenerated: json['ai_generated'] == true,
      failureCode: (json['failure_code'] ?? '').toString(),
      failureReason: (json['failure_reason'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
      submittedAt: (json['submitted_at'] ?? '').toString(),
      deliveredAt: (json['delivered_at'] ?? '').toString(),
      attempts: attemptsList,
      deliveryEvents: eventsList,
    );
  }
}

@immutable
class SenderIdentityItem {
  const SenderIdentityItem({
    required this.id,
    required this.label,
    required this.identityType,
    required this.deviceId,
    required this.simSlot,
    required this.providerName,
    required this.providerBaseUrl,
    required this.alphanumericSenderId,
    required this.maskedProviderApiKey,
    required this.isEnabled,
  });

  final String id;
  final String label;
  final String identityType;
  final String? deviceId;
  final int? simSlot;
  final String providerName;
  final String providerBaseUrl;
  final String alphanumericSenderId;
  final String maskedProviderApiKey;
  final bool isEnabled;

  factory SenderIdentityItem.fromJson(Map<String, dynamic> json) {
    return SenderIdentityItem(
      id: (json['id'] ?? '').toString(),
      label: (json['label'] ?? '').toString(),
      identityType: (json['identity_type'] ?? 'external_provider').toString(),
      deviceId: json['device']?.toString(),
      simSlot: (json['sim_slot'] as num?)?.toInt(),
      providerName: (json['provider_name'] ?? '').toString(),
      providerBaseUrl: (json['provider_base_url'] ?? '').toString(),
      alphanumericSenderId: (json['alphanumeric_sender_id'] ?? '').toString(),
      maskedProviderApiKey: (json['masked_provider_api_key'] ?? '').toString(),
      isEnabled: json['is_enabled'] != false,
    );
  }
}
