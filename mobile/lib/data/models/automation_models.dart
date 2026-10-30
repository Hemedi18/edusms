import 'package:flutter/foundation.dart';

@immutable
class ScheduleWindowItem {
  const ScheduleWindowItem({
    required this.id,
    required this.name,
    required this.timezone,
    required this.daysOfWeek,
    required this.startTime,
    required this.endTime,
    required this.isCurrentlyActive,
  });

  final String id;
  final String name;
  final String timezone;
  final List<int> daysOfWeek;
  final String startTime;
  final String endTime;
  final bool isCurrentlyActive;

  factory ScheduleWindowItem.fromJson(Map<String, dynamic> json) {
    final days = (json['days_of_week'] as List?)
            ?.map((e) => (e as num).toInt())
            .toList() ??
        const [0, 1, 2, 3, 4];
    return ScheduleWindowItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      timezone: (json['timezone'] ?? 'Africa/Dar_es_Salaam').toString(),
      daysOfWeek: days,
      startTime: (json['start_time'] ?? '08:00:00').toString(),
      endTime: (json['end_time'] ?? '17:00:00').toString(),
      isCurrentlyActive: json['is_currently_active'] == true,
    );
  }
}

@immutable
class AutomationModeItem {
  const AutomationModeItem({
    required this.id,
    required this.name,
    required this.slug,
    required this.isBuiltin,
    required this.description,
    required this.isEnabled,
    required this.isActive,
    required this.responseMethod,
    required this.responseTemplate,
    required this.cooldownMinutes,
    required this.requireHumanApproval,
    required this.scheduleId,
    required this.scheduleDetails,
  });

  final String id;
  final String name;
  final String slug;
  final bool isBuiltin;
  final String description;
  final bool isEnabled;
  final bool isActive;
  final String responseMethod;
  final String responseTemplate;
  final int cooldownMinutes;
  final bool requireHumanApproval;
  final String? scheduleId;
  final ScheduleWindowItem? scheduleDetails;

  factory AutomationModeItem.fromJson(Map<String, dynamic> json) {
    final schedMap = json['schedule_details'];
    return AutomationModeItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      slug: (json['slug'] ?? '').toString(),
      isBuiltin: json['is_builtin'] == true,
      description: (json['description'] ?? '').toString(),
      isEnabled: json['is_enabled'] != false,
      isActive: json['is_active'] == true,
      responseMethod: (json['response_method'] ?? 'rules_then_template').toString(),
      responseTemplate: (json['response_template'] ?? '').toString(),
      cooldownMinutes: (json['cooldown_minutes'] as num?)?.toInt() ?? 15,
      requireHumanApproval: json['require_human_approval'] == true,
      scheduleId: json['schedule']?.toString(),
      scheduleDetails: schedMap is Map
          ? ScheduleWindowItem.fromJson(Map<String, dynamic>.from(schedMap))
          : null,
    );
  }
}

@immutable
class AutoReplyRuleItem {
  const AutoReplyRuleItem({
    required this.id,
    required this.name,
    required this.isEnabled,
    required this.matchMode,
    required this.keywords,
    required this.caseSensitive,
    required this.responseTemplate,
    required this.priority,
    required this.cooldownMinutes,
    required this.requireHumanApproval,
    required this.hitCount,
  });

  final String id;
  final String name;
  final bool isEnabled;
  final String matchMode;
  final List<String> keywords;
  final bool caseSensitive;
  final String responseTemplate;
  final int priority;
  final int cooldownMinutes;
  final bool requireHumanApproval;
  final int hitCount;

  factory AutoReplyRuleItem.fromJson(Map<String, dynamic> json) {
    return AutoReplyRuleItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      isEnabled: json['is_enabled'] != false,
      matchMode: (json['match_mode'] ?? 'contains').toString(),
      keywords: (json['keywords'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      caseSensitive: json['case_sensitive'] == true,
      responseTemplate: (json['response_template'] ?? '').toString(),
      priority: (json['priority'] as num?)?.toInt() ?? 10,
      cooldownMinutes: (json['cooldown_minutes'] as num?)?.toInt() ?? 5,
      requireHumanApproval: json['require_human_approval'] == true,
      hitCount: (json['hit_count'] as num?)?.toInt() ?? 0,
    );
  }
}

@immutable
class AiProviderItem {
  const AiProviderItem({
    required this.id,
    required this.name,
    required this.providerType,
    required this.apiBaseUrl,
    required this.maskedApiKey,
    required this.hasApiKey,
    required this.modelName,
    required this.isEnabled,
    required this.systemInstructions,
    required this.fallbackMessage,
    required this.lastTestStatus,
    required this.lastError,
  });

  final String id;
  final String name;
  final String providerType;
  final String apiBaseUrl;
  final String maskedApiKey;
  final bool hasApiKey;
  final String modelName;
  final bool isEnabled;
  final String systemInstructions;
  final String fallbackMessage;
  final String lastTestStatus;
  final String lastError;

  factory AiProviderItem.fromJson(Map<String, dynamic> json) {
    return AiProviderItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      providerType: (json['provider_type'] ?? 'deterministic_mock').toString(),
      apiBaseUrl: (json['api_base_url'] ?? '').toString(),
      maskedApiKey: (json['masked_api_key'] ?? '').toString(),
      hasApiKey: json['has_api_key'] == true,
      modelName: (json['model_name'] ?? 'edusms-mock-v1').toString(),
      isEnabled: json['is_enabled'] != false,
      systemInstructions: (json['system_instructions'] ?? '').toString(),
      fallbackMessage: (json['fallback_message'] ?? '').toString(),
      lastTestStatus: (json['last_test_status'] ?? '').toString(),
      lastError: (json['last_error'] ?? '').toString(),
    );
  }
}

@immutable
class AiCallLogItem {
  const AiCallLogItem({
    required this.id,
    required this.providerName,
    required this.modelName,
    required this.status,
    required this.latencyMs,
    required this.responsePreview,
    required this.errorMessage,
    required this.isTest,
    required this.createdAt,
  });

  final String id;
  final String providerName;
  final String modelName;
  final String status;
  final int latencyMs;
  final String responsePreview;
  final String errorMessage;
  final bool isTest;
  final String createdAt;

  factory AiCallLogItem.fromJson(Map<String, dynamic> json) {
    return AiCallLogItem(
      id: (json['id'] ?? '').toString(),
      providerName: (json['provider_name'] ?? '').toString(),
      modelName: (json['model_name'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      latencyMs: (json['latency_ms'] as num?)?.toInt() ?? 0,
      responsePreview: (json['response_preview'] ?? '').toString(),
      errorMessage: (json['error_message'] ?? '').toString(),
      isTest: json['is_test'] == true,
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}

@immutable
class RuleDryRunResult {
  const RuleDryRunResult({
    required this.wouldReply,
    required this.decision,
    required this.matchedModeName,
    required this.responsePreview,
    required this.reason,
    required this.diagnostics,
  });

  final bool wouldReply;
  final String decision;
  final String matchedModeName;
  final String responsePreview;
  final String reason;
  final List<String> diagnostics;

  factory RuleDryRunResult.fromJson(Map<String, dynamic> json) {
    return RuleDryRunResult(
      wouldReply: json['would_reply'] == true,
      decision: (json['decision'] ?? '').toString(),
      matchedModeName: (json['matched_mode_name'] ?? 'Default').toString(),
      responsePreview: (json['response_preview'] ?? '').toString(),
      reason: (json['reason'] ?? '').toString(),
      diagnostics: (json['diagnostics'] as List?)?.map((e) => e.toString()).toList() ?? const [],
    );
  }
}
