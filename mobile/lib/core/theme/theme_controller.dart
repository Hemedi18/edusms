import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/app_preferences.dart';

class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final saved = ref.watch(appPreferencesProvider).themeModeName;
    return _parse(saved);
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final serialized = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.system => 'system',
      ThemeMode.dark => 'dark',
    };
    await ref.read(appPreferencesProvider).setThemeModeName(serialized);
  }

  static ThemeMode _parse(String value) {
    return switch (value.toLowerCase()) {
      'light' => ThemeMode.light,
      'system' => ThemeMode.system,
      _ => ThemeMode.dark,
    };
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(
  ThemeModeNotifier.new,
);
