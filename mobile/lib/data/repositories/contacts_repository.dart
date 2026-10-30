import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/contact_models.dart';

class ContactsRepository {
  ContactsRepository(this._api);

  final ApiClient _api;

  Future<List<ContactItem>> listContacts({String? search, String? groupId}) async {
    final params = <String, dynamic>{};
    if (search != null && search.trim().isNotEmpty) {
      params['search'] = search.trim();
    }
    if (groupId != null && groupId.isNotEmpty) {
      params['group_id'] = groupId;
    }
    final data = await _api.get('/api/v1/contacts/', queryParameters: params);
    return ApiClient.extractList(data).map(ContactItem.fromJson).toList();
  }

  Future<ContactItem> createContact({
    required String name,
    required String phoneNumber,
    String email = '',
    String notes = '',
    bool optInStatus = true,
    List<String> groupIds = const [],
  }) async {
    final data = await _api.post(
      '/api/v1/contacts/',
      data: {
        'name': name.trim(),
        'phone_number': phoneNumber.trim(),
        'email': email.trim(),
        'notes': notes.trim(),
        'opt_in_status': optInStatus,
        'group_ids': groupIds,
      },
    );
    return ContactItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<ContactItem> updateContact(String id, Map<String, dynamic> patch) async {
    final data = await _api.patch('/api/v1/contacts/$id/', data: patch);
    return ContactItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> deleteContact(String id) async {
    await _api.delete('/api/v1/contacts/$id/');
  }

  Future<ContactItem> optInContact(String id) async {
    final data = await _api.post('/api/v1/contacts/$id/opt-in/');
    return ContactItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<ContactItem> optOutContact(String id) async {
    final data = await _api.post('/api/v1/contacts/$id/opt-out/');
    return ContactItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<EffectivePolicy> getEffectivePolicy(String id) async {
    final data = await _api.get('/api/v1/contacts/$id/effective-policy/');
    return EffectivePolicy.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<List<Map<String, dynamic>>> normalizePreview(List<String> numbers) async {
    final data = await _api.post(
      '/api/v1/contacts/normalize-preview/',
      data: {'numbers': numbers},
    );
    final map = Map<String, dynamic>.from(data as Map);
    final raw = map['results'];
    if (raw is List) {
      return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
    }
    return const [];
  }

  Future<Map<String, dynamic>> importCsv({
    required String csvText,
    required bool consentConfirmed,
    bool markOptedIn = true,
    List<String> groupIds = const [],
  }) async {
    final data = await _api.post(
      '/api/v1/contacts/import-csv/',
      data: {
        'csv_text': csvText,
        'consent_confirmed': consentConfirmed,
        'mark_opted_in': markOptedIn,
        'group_ids': groupIds,
      },
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<List<ContactGroupItem>> listGroups() async {
    final data = await _api.get('/api/v1/groups/');
    return ApiClient.extractList(data).map(ContactGroupItem.fromJson).toList();
  }

  Future<ContactGroupItem> createGroup({
    required String name,
    String description = '',
    bool allowOutgoing = true,
    bool allowAutoReply = true,
    bool allowAiReply = false,
  }) async {
    final data = await _api.post(
      '/api/v1/groups/',
      data: {
        'name': name.trim(),
        'description': description.trim(),
        'allow_outgoing': allowOutgoing,
        'allow_auto_reply': allowAutoReply,
        'allow_ai_reply': allowAiReply,
      },
    );
    return ContactGroupItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> deleteGroup(String id) async {
    await _api.delete('/api/v1/groups/$id/');
  }

  Future<Map<String, dynamic>> manageGroupMembers({
    required String groupId,
    List<String> addContactIds = const [],
    List<String> removeContactIds = const [],
  }) async {
    final data = await _api.post(
      '/api/v1/groups/$groupId/members/',
      data: {
        'add_contact_ids': addContactIds,
        'remove_contact_ids': removeContactIds,
      },
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<List<SuppressionItem>> listSuppressions() async {
    final data = await _api.get('/api/v1/suppressions/');
    return ApiClient.extractList(data).map(SuppressionItem.fromJson).toList();
  }

  Future<SuppressionItem> addSuppression({
    required String phoneNumber,
    String reason = 'manual_block',
    String notes = '',
  }) async {
    final data = await _api.post(
      '/api/v1/suppressions/',
      data: {
        'phone_number': phoneNumber.trim(),
        'reason': reason,
        'notes': notes.trim(),
      },
    );
    return SuppressionItem.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<void> deleteSuppression(String id) async {
    await _api.delete('/api/v1/suppressions/$id/');
  }
}

final contactsRepositoryProvider = Provider<ContactsRepository>((ref) {
  return ContactsRepository(ref.watch(apiClientProvider));
});
