import 'package:flutter/foundation.dart';

@immutable
class UserProfile {
  const UserProfile({
    required this.id,
    required this.email,
    required this.fullName,
    required this.organization,
    required this.timezone,
    required this.defaultCountryCode,
    required this.themePreference,
    required this.emailVerified,
    required this.onboardingCompleted,
    required this.globalAutomationEnabled,
    required this.globalAiEnabled,
    required this.defaultExecutionMode,
    required this.messageRetentionDays,
    required this.storeInboundMessageBody,
    required this.requireConsentForCampaigns,
    required this.dailyRealSmsLimit,
    required this.mfaEnabled,
  });

  final String id;
  final String email;
  final String fullName;
  final String organization;
  final String timezone;
  final String defaultCountryCode;
  final String themePreference;
  final bool emailVerified;
  final bool onboardingCompleted;
  final bool globalAutomationEnabled;
  final bool globalAiEnabled;
  final String defaultExecutionMode;
  final int messageRetentionDays;
  final bool storeInboundMessageBody;
  final bool requireConsentForCampaigns;
  final int dailyRealSmsLimit;
  final bool mfaEnabled;

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: (json['id'] ?? '').toString(),
      email: (json['email'] ?? '').toString(),
      fullName: (json['full_name'] ?? '').toString(),
      organization: (json['organization'] ?? '').toString(),
      timezone: (json['timezone'] ?? 'Africa/Dar_es_Salaam').toString(),
      defaultCountryCode: (json['default_country_code'] ?? 'TZ').toString(),
      themePreference: (json['theme_preference'] ?? 'dark').toString(),
      emailVerified: json['email_verified'] == true,
      onboardingCompleted: json['onboarding_completed'] == true,
      globalAutomationEnabled: json['global_automation_enabled'] != false,
      globalAiEnabled: json['global_ai_enabled'] == true,
      defaultExecutionMode: (json['default_execution_mode'] ?? 'simulation').toString(),
      messageRetentionDays: (json['message_retention_days'] as num?)?.toInt() ?? 90,
      storeInboundMessageBody: json['store_inbound_message_body'] != false,
      requireConsentForCampaigns: json['require_consent_for_campaigns'] != false,
      dailyRealSmsLimit: (json['daily_real_sms_limit'] as num?)?.toInt() ?? 250,
      mfaEnabled: json['mfa_enabled'] == true,
    );
  }
}

@immutable
class UserSessionItem {
  const UserSessionItem({
    required this.id,
    required this.deviceLabel,
    required this.ipAddress,
    required this.lastUsedAt,
    required this.createdAt,
    required this.isCurrent,
  });

  final String id;
  final String deviceLabel;
  final String ipAddress;
  final String lastUsedAt;
  final String createdAt;
  final bool isCurrent;

  factory UserSessionItem.fromJson(Map<String, dynamic> json) {
    return UserSessionItem(
      id: (json['id'] ?? '').toString(),
      deviceLabel: (json['device_label'] ?? 'Session').toString(),
      ipAddress: (json['ip_address'] ?? '').toString(),
      lastUsedAt: (json['last_used_at'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
      isCurrent: json['is_current'] == true,
    );
  }
}

@immutable
class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.category,
    required this.level,
    required this.title,
    required this.body,
    required this.isRead,
    required this.createdAt,
  });

  final String id;
  final String category;
  final String level;
  final String title;
  final String body;
  final bool isRead;
  final String createdAt;

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: (json['id'] ?? '').toString(),
      category: (json['category'] ?? 'system').toString(),
      level: (json['level'] ?? 'info').toString(),
      title: (json['title'] ?? '').toString(),
      body: (json['body'] ?? '').toString(),
      isRead: json['is_read'] == true,
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}

@immutable
class AnalyticsOverview {
  const AnalyticsOverview({
    required this.pairedDevices,
    required this.onlineDevices,
    required this.simReadyDevices,
    required this.realOutboundSubmitted,
    required this.realOutboundDeliveredConfirmed,
    required this.realOutboundQueued,
    required this.realOutboundFailed,
    required this.realInboundReceived,
    required this.simulatedOutbound,
    required this.simulatedInbound,
    required this.pendingHumanApproval,
    required this.totalContacts,
    required this.optedInContacts,
    required this.suppressedCount,
    required this.activeModeName,
    required this.enabledRulesCount,
    required this.autoRepliesSent,
    required this.runningCampaigns,
    required this.timeseries,
  });

  final int pairedDevices;
  final int onlineDevices;
  final int simReadyDevices;
  final int realOutboundSubmitted;
  final int realOutboundDeliveredConfirmed;
  final int realOutboundQueued;
  final int realOutboundFailed;
  final int realInboundReceived;
  final int simulatedOutbound;
  final int simulatedInbound;
  final int pendingHumanApproval;
  final int totalContacts;
  final int optedInContacts;
  final int suppressedCount;
  final String activeModeName;
  final int enabledRulesCount;
  final int autoRepliesSent;
  final int runningCampaigns;
  final List<Map<String, dynamic>> timeseries;

  factory AnalyticsOverview.fromJson(Map<String, dynamic> json) {
    final gw = (json['gateway_summary'] as Map?) ?? const {};
    final msg = (json['message_summary'] as Map?) ?? const {};
    final contacts = (json['contacts_summary'] as Map?) ?? const {};
    final auto = (json['automation_summary'] as Map?) ?? const {};
    final camp = (json['campaigns_summary'] as Map?) ?? const {};
    final tsRaw = json['timeseries'];
    final ts = <Map<String, dynamic>>[];
    if (tsRaw is List) {
      for (final row in tsRaw) {
        if (row is Map) ts.add(Map<String, dynamic>.from(row));
      }
    }

    return AnalyticsOverview(
      pairedDevices: (gw['paired_devices'] as num?)?.toInt() ?? 0,
      onlineDevices: (gw['online_devices'] as num?)?.toInt() ?? 0,
      simReadyDevices: (gw['sim_ready_devices'] as num?)?.toInt() ?? 0,
      realOutboundSubmitted: (msg['real_outbound_submitted'] as num?)?.toInt() ?? 0,
      realOutboundDeliveredConfirmed:
          (msg['real_outbound_delivered_confirmed'] as num?)?.toInt() ?? 0,
      realOutboundQueued: (msg['real_outbound_queued'] as num?)?.toInt() ?? 0,
      realOutboundFailed: (msg['real_outbound_failed'] as num?)?.toInt() ?? 0,
      realInboundReceived: (msg['real_inbound_received'] as num?)?.toInt() ?? 0,
      simulatedOutbound: (msg['simulated_outbound'] as num?)?.toInt() ?? 0,
      simulatedInbound: (msg['simulated_inbound'] as num?)?.toInt() ?? 0,
      pendingHumanApproval: (msg['pending_human_approval'] as num?)?.toInt() ?? 0,
      totalContacts: (contacts['total_contacts'] as num?)?.toInt() ?? 0,
      optedInContacts: (contacts['opted_in_contacts'] as num?)?.toInt() ?? 0,
      suppressedCount: (contacts['suppressed_or_opted_out'] as num?)?.toInt() ?? 0,
      activeModeName: (auto['active_mode'] ?? 'Default').toString(),
      enabledRulesCount: (auto['enabled_rules_count'] as num?)?.toInt() ?? 0,
      autoRepliesSent: (auto['auto_replies_sent'] as num?)?.toInt() ?? 0,
      runningCampaigns: (camp['running_campaigns'] as num?)?.toInt() ?? 0,
      timeseries: ts,
    );
  }
}
