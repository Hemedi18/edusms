import 'package:flutter/foundation.dart';

@immutable
class CampaignStats {
  const CampaignStats({
    required this.totalRecipients,
    required this.eligibleRecipients,
    required this.excludedRecipients,
    required this.pendingCount,
    required this.sentOrSubmittedCount,
    required this.deliveredCount,
    required this.failedCount,
  });

  final int totalRecipients;
  final int eligibleRecipients;
  final int excludedRecipients;
  final int pendingCount;
  final int sentOrSubmittedCount;
  final int deliveredCount;
  final int failedCount;

  double get completionFraction {
    if (eligibleRecipients <= 0) return 0;
    final processed = eligibleRecipients - pendingCount;
    return (processed / eligibleRecipients).clamp(0.0, 1.0);
  }

  factory CampaignStats.fromJson(Map<String, dynamic> json) {
    return CampaignStats(
      totalRecipients: (json['total_recipients'] as num?)?.toInt() ?? 0,
      eligibleRecipients: (json['eligible_recipients'] as num?)?.toInt() ?? 0,
      excludedRecipients: (json['excluded_recipients'] as num?)?.toInt() ?? 0,
      pendingCount: (json['pending'] as num?)?.toInt() ?? 0,
      sentOrSubmittedCount:
          ((json['submitted'] as num?)?.toInt() ?? 0) +
          ((json['simulated'] as num?)?.toInt() ?? 0) +
          ((json['queued'] as num?)?.toInt() ?? 0),
      deliveredCount: (json['delivered'] as num?)?.toInt() ?? 0,
      failedCount: (json['failed'] as num?)?.toInt() ?? 0,
    );
  }
}

@immutable
class CampaignItem {
  const CampaignItem({
    required this.id,
    required this.name,
    required this.messageTemplate,
    required this.transportType,
    required this.isSimulation,
    required this.status,
    required this.pauseReason,
    required this.createdAt,
    required this.stats,
  });

  final String id;
  final String name;
  final String messageTemplate;
  final String transportType;
  final bool isSimulation;
  final String status;
  final String pauseReason;
  final String createdAt;
  final CampaignStats stats;

  factory CampaignItem.fromJson(Map<String, dynamic> json) {
    final rawStats = json['stats'];
    return CampaignItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      messageTemplate: (json['message_template'] ?? '').toString(),
      transportType: (json['transport_type'] ?? 'simulation').toString(),
      isSimulation: json['is_simulation'] == true,
      status: (json['status'] ?? 'draft').toString(),
      pauseReason: (json['pause_reason'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
      stats: rawStats is Map
          ? CampaignStats.fromJson(Map<String, dynamic>.from(rawStats))
          : const CampaignStats(
              totalRecipients: 0,
              eligibleRecipients: 0,
              excludedRecipients: 0,
              pendingCount: 0,
              sentOrSubmittedCount: 0,
              deliveredCount: 0,
              failedCount: 0,
            ),
    );
  }
}

@immutable
class CampaignRecipientItem {
  const CampaignRecipientItem({
    required this.id,
    required this.phoneNumber,
    required this.recipientName,
    required this.renderedBody,
    required this.status,
    required this.exclusionReason,
    required this.errorDetail,
  });

  final String id;
  final String phoneNumber;
  final String recipientName;
  final String renderedBody;
  final String status;
  final String exclusionReason;
  final String errorDetail;

  factory CampaignRecipientItem.fromJson(Map<String, dynamic> json) {
    return CampaignRecipientItem(
      id: (json['id'] ?? '').toString(),
      phoneNumber: (json['phone_number'] ?? '').toString(),
      recipientName: (json['recipient_name'] ?? '').toString(),
      renderedBody: (json['rendered_body'] ?? '').toString(),
      status: (json['status'] ?? 'pending').toString(),
      exclusionReason: (json['exclusion_reason'] ?? '').toString(),
      errorDetail: (json['error_detail'] ?? '').toString(),
    );
  }
}

@immutable
class AudiencePreviewResult {
  const AudiencePreviewResult({
    required this.totalInputCount,
    required this.duplicateRemovedCount,
    required this.eligibleCount,
    required this.excludedCount,
    required this.samplePreview,
  });

  final int totalInputCount;
  final int duplicateRemovedCount;
  final int eligibleCount;
  final int excludedCount;
  final String samplePreview;

  factory AudiencePreviewResult.fromJson(Map<String, dynamic> json) {
    return AudiencePreviewResult(
      totalInputCount: (json['total_input_count'] as num?)?.toInt() ?? 0,
      duplicateRemovedCount: (json['duplicate_removed_count'] as num?)?.toInt() ?? 0,
      eligibleCount: (json['eligible_count'] as num?)?.toInt() ?? 0,
      excludedCount: (json['excluded_count'] as num?)?.toInt() ?? 0,
      samplePreview: (json['sample_preview'] ?? '').toString(),
    );
  }
}
