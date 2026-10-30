import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../platform/platform_capabilities.dart';

/// Persists non-sensitive user preferences (API base URL, theme mode, onboarding state).
class AppPreferences {
  AppPreferences(this._prefs, {required this._fallbackApiBaseUrl});

  final SharedPreferences _prefs;
  final String _fallbackApiBaseUrl;

  static const String keyApiBaseUrl = 'edusms_api_base_url';
  static const String keyThemeMode = 'edusms_theme_mode';
  static const String keyOnboardingSeen = 'edusms_onboarding_seen';

  String get apiBaseUrl {
    final stored = _prefs.getString(keyApiBaseUrl)?.trim();
    if (stored != null && stored.isNotEmpty) {
      return stored.endsWith('/') ? stored.substring(0, stored.length - 1) : stored;
    }
    return _fallbackApiBaseUrl;
  }

  Future<void> setApiBaseUrl(String url) async {
    var cleaned = url.trim();
    while (cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    await _prefs.setString(keyApiBaseUrl, cleaned);
  }

  String get themeModeName => _prefs.getString(keyThemeMode) ?? 'dark';

  Future<void> setThemeModeName(String modeName) async {
    await _prefs.setString(keyThemeMode, modeName);
  }

  bool get onboardingSeen => _prefs.getBool(keyOnboardingSeen) ?? false;

  Future<void> setOnboardingSeen(bool seen) async {
    await _prefs.setBool(keyOnboardingSeen, seen);
  }
}

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('sharedPreferencesProvider must be overridden at bootstrap');
});

final appPreferencesProvider = Provider<AppPreferences>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  final caps = ref.watch(platformCapabilitiesProvider);
  return AppPreferences(prefs, fallbackApiBaseUrl: caps.defaultApiBaseUrl);
});

class ApiBaseUrlNotifier extends Notifier<String> {
  @override
  String build() {
    return ref.watch(appPreferencesProvider).apiBaseUrl;
  }

  Future<void> updateUrl(String nextUrl) async {
    var cleaned = nextUrl.trim();
    while (cleaned.endsWith('/')) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }
    if (cleaned.isEmpty) return;
    await ref.read(appPreferencesProvider).setApiBaseUrl(cleaned);
    state = cleaned;
  }
}

final apiBaseUrlProvider = NotifierProvider<ApiBaseUrlNotifier, String>(
  ApiBaseUrlNotifier.new,
);
