import 'package:flutter/foundation.dart';

@immutable
class ContactGroupItem {
  const ContactGroupItem({
    required this.id,
    required this.name,
    required this.description,
    required this.color,
    required this.allowOutgoing,
    required this.allowAutoReply,
    required this.allowAiReply,
    required this.cooldownMinutes,
    required this.memberCount,
  });

  final String id;
  final String name;
  final String description;
  final String color;
  final bool allowOutgoing;
  final bool allowAutoReply;
  final bool allowAiReply;
  final int cooldownMinutes;
  final int memberCount;

  factory ContactGroupItem.fromJson(Map<String, dynamic> json) {
    return ContactGroupItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      color: (json['color'] ?? '#7C3AED').toString(),
      allowOutgoing: json['allow_outgoing'] != false,
      allowAutoReply: json['allow_auto_reply'] != false,
      allowAiReply: json['allow_ai_reply'] == true,
      cooldownMinutes: (json['cooldown_minutes'] as num?)?.toInt() ?? 15,
      memberCount: (json['member_count'] as num?)?.toInt() ?? 0,
    );
  }
}

@immutable
class ContactItem {
  const ContactItem({
    required this.id,
    required this.name,
    required this.phoneNumber,
    required this.email,
    required this.isVirtual,
    required this.allowOutgoing,
    required this.optInStatus,
    required this.optOutStatus,
    required this.notes,
    required this.groups,
  });

  final String id;
  final String name;
  final String phoneNumber;
  final String email;
  final bool isVirtual;
  final bool allowOutgoing;
  final bool optInStatus;
  final bool optOutStatus;
  final String notes;
  final List<ContactGroupItem> groups;

  factory ContactItem.fromJson(Map<String, dynamic> json) {
    final gList = <ContactGroupItem>[];
    if (json['groups'] is List) {
      for (final g in json['groups'] as List) {
        if (g is Map) {
          gList.add(ContactGroupItem.fromJson(Map<String, dynamic>.from(g)));
        }
      }
    }
    return ContactItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      phoneNumber: (json['phone_number'] ?? '').toString(),
      email: (json['email'] ?? '').toString(),
      isVirtual: json['is_virtual'] == true,
      allowOutgoing: json['allow_outgoing'] != false,
      optInStatus: json['opt_in_status'] == true,
      optOutStatus: json['opt_out_status'] == true,
      notes: (json['notes'] ?? '').toString(),
      groups: gList,
    );
  }
}

@immutable
class SuppressionItem {
  const SuppressionItem({
    required this.id,
    required this.phoneNumber,
    required this.reason,
    required this.notes,
    required this.createdAt,
  });

  final String id;
  final String phoneNumber;
  final String reason;
  final String notes;
  final String createdAt;

  factory SuppressionItem.fromJson(Map<String, dynamic> json) {
    return SuppressionItem(
      id: (json['id'] ?? '').toString(),
      phoneNumber: (json['phone_number'] ?? '').toString(),
      reason: (json['reason'] ?? 'opt_out').toString(),
      notes: (json['notes'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}

@immutable
class EffectivePolicy {
  const EffectivePolicy({
    required this.phoneNumber,
    required this.contactName,
    required this.isSuppressed,
    required this.isOptedOut,
    required this.optInStatus,
    required this.canSendOutgoing,
    required this.canAutoReply,
    required this.canAiReply,
    required this.inQuietHours,
    required this.effectiveCooldownMinutes,
    required this.effectiveModeName,
    required this.effectiveModeSource,
    required this.blockingReasons,
    required this.inheritanceTrace,
  });

  final String phoneNumber;
  final String contactName;
  final bool isSuppressed;
  final bool isOptedOut;
  final bool optInStatus;
  final bool canSendOutgoing;
  final bool canAutoReply;
  final bool canAiReply;
  final bool inQuietHours;
  final int effectiveCooldownMinutes;
  final String effectiveModeName;
  final String effectiveModeSource;
  final List<String> blockingReasons;
  final List<String> inheritanceTrace;

  factory EffectivePolicy.fromJson(Map<String, dynamic> json) {
    return EffectivePolicy(
      phoneNumber: (json['phone_number'] ?? '').toString(),
      contactName: (json['contact_name'] ?? '').toString(),
      isSuppressed: json['is_suppressed'] == true,
      isOptedOut: json['is_opted_out'] == true,
      optInStatus: json['opt_in_status'] == true,
      canSendOutgoing: json['can_send_outgoing'] == true,
      canAutoReply: json['can_auto_reply'] == true,
      canAiReply: json['can_ai_reply'] == true,
      inQuietHours: json['in_quiet_hours'] == true,
      effectiveCooldownMinutes: (json['effective_cooldown_minutes'] as num?)?.toInt() ?? 15,
      effectiveModeName: (json['effective_mode_name'] ?? 'Default').toString(),
      effectiveModeSource: (json['effective_mode_source'] ?? 'global_active').toString(),
      blockingReasons: (json['blocking_reasons'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      inheritanceTrace: (json['inheritance_trace'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
    );
  }
}
