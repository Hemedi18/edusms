import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/realtime_ws_service.dart';
import '../../core/storage/app_preferences.dart';
import '../../core/storage/secure_token_storage.dart';
import '../../data/models/user_models.dart';
import '../../data/repositories/auth_repository.dart';

@immutable
class AuthState {
  const AuthState({
    required this.isInitializing,
    required this.onboardingSeen,
    this.user,
    this.errorMessage,
  });

  final bool isInitializing;
  final bool onboardingSeen;
  final UserProfile? user;
  final String? errorMessage;

  bool get isAuthenticated => user != null;

  AuthState copyWith({
    bool? isInitializing,
    bool? onboardingSeen,
    UserProfile? user,
    bool clearUser = false,
    String? errorMessage,
    bool clearError = false,
  }) {
    return AuthState(
      isInitializing: isInitializing ?? this.isInitializing,
      onboardingSeen: onboardingSeen ?? this.onboardingSeen,
      user: clearUser ? null : (user ?? this.user),
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}

class AuthController extends Notifier<AuthState> {
  final ValueNotifier<int> routerRefreshTick = ValueNotifier<int>(0);

  @override
  AuthState build() {
    ref.onDispose(routerRefreshTick.dispose);
    final prefs = ref.watch(appPreferencesProvider);
    final initialSeen = prefs.onboardingSeen;
    Future.microtask(_restoreExistingSession);
    return AuthState(
      isInitializing: true,
      onboardingSeen: initialSeen,
    );
  }

  void _notifyRouter() {
    routerRefreshTick.value++;
  }

  Future<void> _restoreExistingSession() async {
    final tokenStorage = ref.read(tokenStorageProvider);
    final token = await tokenStorage.getAccessToken();
    if (token == null || token.isEmpty) {
      state = state.copyWith(isInitializing: false);
      _notifyRouter();
      return;
    }

    try {
      final profile = await ref.read(authRepositoryProvider).getCurrentUser();
      state = state.copyWith(
        isInitializing: false,
        user: profile,
        clearError: true,
      );
      unawaited(ref.read(realtimeWsServiceProvider).connect());
    } catch (_) {
      await tokenStorage.clearSession();
      state = state.copyWith(isInitializing: false, clearUser: true);
    }
    _notifyRouter();
  }

  Future<void> completeOnboarding() async {
    await ref.read(appPreferencesProvider).setOnboardingSeen(true);
    state = state.copyWith(onboardingSeen: true);
    _notifyRouter();
  }

  Future<void> login({
    required String email,
    required String password,
    String? mfaCode,
  }) async {
    final profile = await ref.read(authRepositoryProvider).login(
          email: email,
          password: password,
          mfaCode: mfaCode,
        );
    state = state.copyWith(
      isInitializing: false,
      user: profile,
      onboardingSeen: true,
      clearError: true,
    );
    await ref.read(appPreferencesProvider).setOnboardingSeen(true);
    unawaited(ref.read(realtimeWsServiceProvider).connect());
    _notifyRouter();
  }

  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    String organization = '',
    String timezone = 'Africa/Dar_es_Salaam',
    String defaultCountryCode = 'TZ',
  }) async {
    final profile = await ref.read(authRepositoryProvider).register(
          fullName: fullName,
          email: email,
          password: password,
          organization: organization,
          timezone: timezone,
          defaultCountryCode: defaultCountryCode,
        );
    state = state.copyWith(
      isInitializing: false,
      user: profile,
      onboardingSeen: true,
      clearError: true,
    );
    await ref.read(appPreferencesProvider).setOnboardingSeen(true);
    unawaited(ref.read(realtimeWsServiceProvider).connect());
    _notifyRouter();
  }

  Future<void> refreshProfile() async {
    final profile = await ref.read(authRepositoryProvider).getCurrentUser();
    state = state.copyWith(user: profile);
  }

  void setUserProfile(UserProfile profile) {
    state = state.copyWith(user: profile);
  }

  Future<void> logout() async {
    await ref.read(realtimeWsServiceProvider).disconnect();
    await ref.read(authRepositoryProvider).logout();
    state = state.copyWith(clearUser: true, clearError: true);
    _notifyRouter();
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
