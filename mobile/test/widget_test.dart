import 'package:edusms_mobile/app.dart';
import 'package:edusms_mobile/core/network/api_exception.dart';
import 'package:edusms_mobile/core/network/realtime_ws_service.dart';
import 'package:edusms_mobile/core/platform/platform_capabilities.dart';
import 'package:edusms_mobile/core/storage/app_preferences.dart';
import 'package:edusms_mobile/core/storage/secure_token_storage.dart';
import 'package:edusms_mobile/core/theme/theme_controller.dart';
import 'package:edusms_mobile/data/models/automation_models.dart';
import 'package:edusms_mobile/data/models/user_models.dart';
import 'package:edusms_mobile/data/repositories/auth_repository.dart';
import 'package:edusms_mobile/data/repositories/automation_repository.dart';
import 'package:edusms_mobile/features/settings/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

class MockAutomationRepository extends Mock implements AutomationRepository {}

UserProfile _sampleUser({bool mfaEnabled = false}) {
  return UserProfile(
    id: 'user-1',
    email: 'dev@edusms.local',
    fullName: 'Dr. Neema Mwakasege',
    organization: 'Dar Institute of Technology',
    timezone: 'Africa/Dar_es_Salaam',
    defaultCountryCode: 'TZ',
    themePreference: 'dark',
    emailVerified: true,
    onboardingCompleted: true,
    globalAutomationEnabled: true,
    globalAiEnabled: false,
    defaultExecutionMode: 'simulation',
    messageRetentionDays: 90,
    storeInboundMessageBody: true,
    requireConsentForCampaigns: true,
    dailyRealSmsLimit: 250,
    mfaEnabled: mfaEnabled,
  );
}

AnalyticsOverview _sampleOverview() {
  return const AnalyticsOverview(
    pairedDevices: 1,
    onlineDevices: 1,
    simReadyDevices: 1,
    realOutboundSubmitted: 18,
    realOutboundDeliveredConfirmed: 15,
    realOutboundQueued: 1,
    realOutboundFailed: 0,
    realInboundReceived: 9,
    simulatedOutbound: 42,
    simulatedInbound: 21,
    pendingHumanApproval: 2,
    totalContacts: 120,
    optedInContacts: 114,
    suppressedCount: 6,
    activeModeName: 'Office Hours',
    enabledRulesCount: 4,
    autoRepliesSent: 12,
    runningCampaigns: 0,
    timeseries: [],
  );
}

void main() {
  group('Onboarding, Auth Validation & Navigation Shell', () {
    late MockAuthRepository mockAuthRepo;
    late MockAutomationRepository mockAutoRepo;

    setUp(() {
      mockAuthRepo = MockAuthRepository();
      mockAutoRepo = MockAutomationRepository();

      when(() => mockAuthRepo.getAnalyticsOverview(days: any(named: 'days')))
          .thenAnswer((_) async => _sampleOverview());
      when(() => mockAutoRepo.listModes()).thenAnswer(
        (_) async => const [
          AutomationModeItem(
            id: 'mode-1',
            name: 'Office Hours',
            slug: 'office-hours',
            isBuiltin: true,
            description: 'Standard campus hours responder',
            isEnabled: true,
            isActive: true,
            responseMethod: 'rules_then_template',
            responseTemplate: 'Asante kwa ujumbe wako.',
            cooldownMinutes: 15,
            requireHumanApproval: false,
            scheduleId: null,
            scheduleDetails: null,
          ),
        ],
      );
      when(() => mockAuthRepo.listSessions()).thenAnswer((_) async => const []);
    });

    testWidgets(
      'first launch walks through transparent onboarding steps and navigates to LoginScreen',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final tokenStorage = InMemoryTokenStorage();

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              sharedPreferencesProvider.overrideWithValue(prefs),
              tokenStorageProvider.overrideWithValue(tokenStorage),
              platformCapabilitiesProvider.overrideWithValue(
                PlatformCapabilities.android(),
              ),
              authRepositoryProvider.overrideWithValue(mockAuthRepo),
              automationRepositoryProvider.overrideWithValue(mockAutoRepo),
              realtimeWsServiceProvider.overrideWithValue(
                RealtimeWsService(
                  tokenStorage: tokenStorage,
                  baseUrlGetter: () => 'http://10.0.2.2:8000',
                  enabled: false,
                ),
              ),
            ],
            child: const EduSmsApp(),
          ),
        );
        await tester.pumpAndSettle();

        // Step 0: Welcome to EduSMS onboarding
        expect(find.text('Welcome to EduSMS'), findsOneWidget);

        // Advance Step 0 -> Step 1 (SMS permissions disclosure)
        await tester.tap(find.byKey(const Key('onboarding_next_button')));
        await tester.pumpAndSettle();

        // Advance Step 1 -> Step 2 (Optional Default SMS Role disclosure)
        await tester.tap(find.byKey(const Key('onboarding_next_button')));
        await tester.pumpAndSettle();
        expect(find.text('Continue to EduSMS Sign In'), findsOneWidget);

        // Finish onboarding -> navigates to LoginScreen & persists preference
        await tester.tap(find.byKey(const Key('onboarding_next_button')));
        await tester.pumpAndSettle();

        expect(prefs.getBool(AppPreferences.keyOnboardingSeen), isTrue);
        expect(find.byKey(const Key('login_email_field')), findsOneWidget);
        expect(find.byKey(const Key('login_password_field')), findsOneWidget);
      },
    );

    testWidgets(
      'LoginScreen validates inputs, reveals MFA field when required, and routes to Dashboard on success',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          AppPreferences.keyOnboardingSeen: true,
        });
        final prefs = await SharedPreferences.getInstance();
        final tokenStorage = InMemoryTokenStorage();

        // First login attempt without MFA code throws mfa_required; second succeeds
        when(
          () => mockAuthRepo.login(
            email: 'dev@edusms.local',
            password: 'EduSMS-Demo-2026!',
            mfaCode: null,
          ),
        ).thenThrow(
          const ApiException(
            message: 'Multi-factor authentication code is required.',
            code: 'mfa_required',
            statusCode: 401,
            details: {'mfa_required': true},
          ),
        );

        when(
          () => mockAuthRepo.login(
            email: 'dev@edusms.local',
            password: 'EduSMS-Demo-2026!',
            mfaCode: '654321',
          ),
        ).thenAnswer((_) async => _sampleUser(mfaEnabled: true));

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              sharedPreferencesProvider.overrideWithValue(prefs),
              tokenStorageProvider.overrideWithValue(tokenStorage),
              platformCapabilitiesProvider.overrideWithValue(
                PlatformCapabilities.iosCompanion(),
              ),
              authRepositoryProvider.overrideWithValue(mockAuthRepo),
              automationRepositoryProvider.overrideWithValue(mockAutoRepo),
              realtimeWsServiceProvider.overrideWithValue(
                RealtimeWsService(
                  tokenStorage: tokenStorage,
                  baseUrlGetter: () => 'http://127.0.0.1:8000',
                  enabled: false,
                ),
              ),
            ],
            child: const EduSmsApp(),
          ),
        );
        await tester.pumpAndSettle();

        // Empty submit triggers required validation errors
        final submitBtn = find.byKey(const Key('login_submit_button'));
        await tester.ensureVisible(submitBtn);
        await tester.tap(submitBtn);
        await tester.pumpAndSettle();
        expect(find.text('Email address is required.'), findsOneWidget);
        expect(find.text('Password is required.'), findsOneWidget);

        // Invalid email format triggers email format error
        await tester.enterText(find.byKey(const Key('login_email_field')), 'invalid-email');
        await tester.ensureVisible(submitBtn);
        await tester.tap(submitBtn);
        await tester.pumpAndSettle();
        expect(find.text('Enter a valid email address.'), findsOneWidget);

        // Quick-fill local dev credentials
        final quickFill = find.byKey(const Key('demo_quick_fill_button'));
        await tester.ensureVisible(quickFill);
        await tester.tap(quickFill);
        await tester.pumpAndSettle();

        // Submit without MFA -> reveals login_mfa_field
        await tester.ensureVisible(submitBtn);
        await tester.tap(submitBtn);
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('login_mfa_field')), findsOneWidget);

        // Enter 6-digit TOTP code and sign in -> routes to DashboardScreen
        await tester.enterText(find.byKey(const Key('login_mfa_field')), '654321');
        await tester.ensureVisible(submitBtn);
        await tester.tap(submitBtn);
        await tester.pumpAndSettle();

        expect(find.text('EduSMS Gateway'), findsOneWidget);
        expect(find.byKey(const Key('ios_companion_gateway_banner')), findsOneWidget);
      },
    );
  });

  group('Theme Switching (Dark / Light / System)', () {
    test('ThemeModeNotifier defaults to Dark and persists Light & System selections', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();

      final container = ProviderContainer(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.dark);

      await container.read(themeModeProvider.notifier).setThemeMode(ThemeMode.light);
      expect(container.read(themeModeProvider), ThemeMode.light);
      expect(prefs.getString(AppPreferences.keyThemeMode), 'light');

      await container.read(themeModeProvider.notifier).setThemeMode(ThemeMode.system);
      expect(container.read(themeModeProvider), ThemeMode.system);
      expect(prefs.getString(AppPreferences.keyThemeMode), 'system');
    });

    testWidgets('SettingsScreen SegmentedButton switches theme live', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final mockAuthRepo = MockAuthRepository();
      when(() => mockAuthRepo.listSessions()).thenAnswer((_) async => const []);

      late ProviderContainer capturedContainer;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(prefs),
            authRepositoryProvider.overrideWithValue(mockAuthRepo),
          ],
          child: Consumer(
            builder: (context, ref, _) {
              capturedContainer = ProviderScope.containerOf(context);
              final mode = ref.watch(themeModeProvider);
              return MaterialApp(
                themeMode: mode,
                theme: ThemeData.light(),
                darkTheme: ThemeData.dark(),
                home: const SettingsScreen(),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(capturedContainer.read(themeModeProvider), ThemeMode.dark);

      await tester.tap(find.text('Light'));
      await tester.pumpAndSettle();
      expect(capturedContainer.read(themeModeProvider), ThemeMode.light);
      expect(prefs.getString(AppPreferences.keyThemeMode), 'light');

      await tester.tap(find.text('System'));
      await tester.pumpAndSettle();
      expect(capturedContainer.read(themeModeProvider), ThemeMode.system);
      expect(prefs.getString(AppPreferences.keyThemeMode), 'system');
    });
  });
}
