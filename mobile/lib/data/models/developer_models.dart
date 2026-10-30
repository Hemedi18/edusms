import 'package:flutter/foundation.dart';

@immutable
class ApiKeyItem {
  const ApiKeyItem({
    required this.id,
    required this.name,
    required this.keyPrefix,
    required this.scopes,
    required this.simulationOnly,
    required this.rateLimitPerMinute,
    required this.isActiveKey,
    required this.createdAt,
    this.rawKeyOnce,
  });

  final String id;
  final String name;
  final String keyPrefix;
  final List<String> scopes;
  final bool simulationOnly;
  final int rateLimitPerMinute;
  final bool isActiveKey;
  final String createdAt;
  final String? rawKeyOnce;

  factory ApiKeyItem.fromJson(Map<String, dynamic> json) {
    return ApiKeyItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      keyPrefix: (json['key_prefix'] ?? '').toString(),
      scopes: (json['scopes'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      simulationOnly: json['simulation_only'] == true,
      rateLimitPerMinute: (json['rate_limit_per_minute'] as num?)?.toInt() ?? 60,
      isActiveKey: json['is_active_key'] != false && json['revoked_at'] == null,
      createdAt: (json['created_at'] ?? '').toString(),
      rawKeyOnce: json['raw_key']?.toString(),
    );
  }
}

@immutable
class WebhookEndpointItem {
  const WebhookEndpointItem({
    required this.id,
    required this.name,
    required this.url,
    required this.events,
    required this.includeSimulationEvents,
    required this.isActive,
    required this.maskedSigningSecret,
    this.rawSigningSecretOnce,
  });

  final String id;
  final String name;
  final String url;
  final List<String> events;
  final bool includeSimulationEvents;
  final bool isActive;
  final String maskedSigningSecret;
  final String? rawSigningSecretOnce;

  factory WebhookEndpointItem.fromJson(Map<String, dynamic> json) {
    return WebhookEndpointItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      url: (json['url'] ?? '').toString(),
      events: (json['events'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      includeSimulationEvents: json['include_simulation_events'] != false,
      isActive: json['is_active'] != false,
      maskedSigningSecret: (json['masked_signing_secret'] ?? '').toString(),
      rawSigningSecretOnce: json['signing_secret']?.toString(),
    );
  }
}

@immutable
class WebhookDeliveryEventItem {
  const WebhookDeliveryEventItem({
    required this.id,
    required this.endpointName,
    required this.eventType,
    required this.isSimulation,
    required this.status,
    required this.attemptCount,
    required this.lastError,
    required this.createdAt,
  });

  final String id;
  final String endpointName;
  final String eventType;
  final bool isSimulation;
  final String status;
  final int attemptCount;
  final String lastError;
  final String createdAt;

  factory WebhookDeliveryEventItem.fromJson(Map<String, dynamic> json) {
    return WebhookDeliveryEventItem(
      id: (json['id'] ?? '').toString(),
      endpointName: (json['endpoint_name'] ?? '').toString(),
      eventType: (json['event_type'] ?? '').toString(),
      isSimulation: json['is_simulation'] == true,
      status: (json['status'] ?? '').toString(),
      attemptCount: (json['attempt_count'] as num?)?.toInt() ?? 0,
      lastError: (json['last_error'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}
