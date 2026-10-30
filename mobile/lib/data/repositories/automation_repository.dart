import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/automation_models.dart';

class AutomationRepository {
  AutomationRepository(this._api);

  final ApiClient _api;

  Future<Map<String, bool>> toggleGlobalSwitches({
    bool? globalAutomationEnabled,
    bool? globalAiEnabled,
  }) async {
    final data = await _api.post(
      '/api/v1/automation/global-toggle/',
      data: {
        'global_automation_enabled': ?globalAutomationEnabled,
        'global_ai_enabled': ?globalAiEnabled,
      },
    );
    final map = Map<String, dynamic>.from(data as Map);
    return {
      'global_automation_enabled': map['global_automation_enabled'] == true,
      'global_ai_enabled': map['global_ai_enabled'] == true,
    };
  }

  Future<List<AutomationModeItem>> listModes() async {
    final data = await _api.get('/api/v1/automation/modes/');
    return ApiClient.extractList(data).map(AutomationModeItem.fromJson).toList();
  }

  Future<AutomationModeItem> activateMode(String modeId) async {
    final data = await _api.post('/api/v1/automation/modes/$modeId/activate/');
    return AutomationModeItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<AutomationModeItem> createMode({
    required String name,
    String description = '',
    String responseMethod = 'rules_then_template',
    String responseTemplate = '',
    bool requireHumanApproval = false,
    String? scheduleId,
  }) async {
    final data = await _api.post(
      '/api/v1/automation/modes/',
      data: {
        'name': name.trim(),
        'description': description.trim(),
        'response_method': responseMethod,
        'response_template': responseTemplate,
        'require_human_approval': requireHumanApproval,
        if (scheduleId != null && scheduleId.isNotEmpty) 'schedule': scheduleId,
      },
    );
    return AutomationModeItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<ScheduleWindowItem>> listSchedules() async {
    final data = await _api.get('/api/v1/automation/schedules/');
    return ApiClient.extractList(data).map(ScheduleWindowItem.fromJson).toList();
  }

  Future<ScheduleWindowItem> createSchedule({
    required String name,
    required List<int> daysOfWeek,
    required String startTime,
    required String endTime,
    String timezone = 'Africa/Dar_es_Salaam',
  }) async {
    final data = await _api.post(
      '/api/v1/automation/schedules/',
      data: {
        'name': name.trim(),
        'days_of_week': daysOfWeek,
        'start_time': startTime,
        'end_time': endTime,
        'timezone': timezone,
      },
    );
    return ScheduleWindowItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<AutoReplyRuleItem>> listRules() async {
    final data = await _api.get('/api/v1/automation/rules/');
    return ApiClient.extractList(data).map(AutoReplyRuleItem.fromJson).toList();
  }

  Future<AutoReplyRuleItem> createRule({
    required String name,
    required String matchMode,
    required List<String> keywords,
    required String responseTemplate,
    int priority = 20,
    int cooldownMinutes = 5,
    bool caseSensitive = false,
    bool requireHumanApproval = false,
  }) async {
    final data = await _api.post(
      '/api/v1/automation/rules/',
      data: {
        'name': name.trim(),
        'match_mode': matchMode,
        'keywords': keywords,
        'response_template': responseTemplate,
        'priority': priority,
        'cooldown_minutes': cooldownMinutes,
        'case_sensitive': caseSensitive,
        'require_human_approval': requireHumanApproval,
        'is_enabled': true,
      },
    );
    return AutoReplyRuleItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<AutoReplyRuleItem> toggleRule(String id, bool enabled) async {
    final data = await _api.patch(
      '/api/v1/automation/rules/$id/',
      data: {'is_enabled': enabled},
    );
    return AutoReplyRuleItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<AutoReplyRuleItem> duplicateRule(String id) async {
    final data = await _api.post('/api/v1/automation/rules/$id/duplicate/');
    return AutoReplyRuleItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> deleteRule(String id) async {
    await _api.delete('/api/v1/automation/rules/$id/');
  }

  Future<RuleDryRunResult> testRuleDryRun({
    required String senderNumber,
    required String body,
  }) async {
    final data = await _api.post(
      '/api/v1/automation/rules/test/',
      data: {
        'sender_number': senderNumber.trim(),
        'body': body,
      },
    );
    return RuleDryRunResult.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<AiProviderItem>> listAiProviders() async {
    final data = await _api.get('/api/v1/automation/ai-providers/');
    return ApiClient.extractList(data).map(AiProviderItem.fromJson).toList();
  }

  Future<AiProviderItem> createAiProvider({
    required String name,
    required String providerType,
    required String modelName,
    String apiBaseUrl = '',
    String apiKey = '',
    String systemInstructions = '',
    String fallbackMessage = 'Thank you for your SMS. Our office will follow up shortly.',
  }) async {
    final data = await _api.post(
      '/api/v1/automation/ai-providers/',
      data: {
        'name': name.trim(),
        'provider_type': providerType,
        'model_name': modelName.trim(),
        if (apiBaseUrl.trim().isNotEmpty) 'api_base_url': apiBaseUrl.trim(),
        if (apiKey.trim().isNotEmpty) 'api_key': apiKey.trim(),
        'system_instructions': systemInstructions.trim(),
        'fallback_message': fallbackMessage.trim(),
        'is_enabled': true,
      },
    );
    return AiProviderItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<Map<String, dynamic>> testAiConnection(String providerId) async {
    final data = await _api.post('/api/v1/automation/ai-providers/$providerId/test-connection/');
    return Map<String, dynamic>.from(data as Map);
  }

  Future<Map<String, dynamic>> testAiPrompt({
    required String providerId,
    required String prompt,
    String senderName = 'Student',
  }) async {
    final data = await _api.post(
      '/api/v1/automation/ai-providers/$providerId/test-prompt/',
      data: {
        'prompt': prompt.trim(),
        'sender_name': senderName.trim(),
      },
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<List<AiCallLogItem>> listAiLogs() async {
    final data = await _api.get('/api/v1/automation/ai-logs/');
    return ApiClient.extractList(data).map(AiCallLogItem.fromJson).toList();
  }
}

final automationRepositoryProvider = Provider<AutomationRepository>((ref) {
  return AutomationRepository(ref.watch(apiClientProvider));
});
