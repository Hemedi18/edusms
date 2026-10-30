import 'package:edusms_mobile/core/network/api_client.dart';
import 'package:edusms_mobile/core/network/native_gateway_bridge.dart';
import 'package:edusms_mobile/core/platform/platform_capabilities.dart';
import 'package:edusms_mobile/core/storage/app_preferences.dart';
import 'package:edusms_mobile/core/storage/secure_token_storage.dart';
import 'package:edusms_mobile/core/theme/app_theme.dart';
import 'package:edusms_mobile/data/models/device_models.dart';
import 'package:edusms_mobile/data/repositories/gateway_repository.dart';
import 'package:edusms_mobile/features/dashboard/widgets/gateway_control_card.dart';
import 'package:edusms_mobile/features/devices/devices_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockGatewayRepository extends Mock implements GatewayRepository {}

Map<String, dynamic> _androidDiagPayload({
  bool sendSmsGranted = true,
  bool receiveSmsGranted = true,
  bool configured = true,
  bool running = true,
  bool paused = false,
  int offlineInbound = 0,
  int offlineStatus = 0,
}) {
  return {
    'platform': 'android',
    'supports_physical_sim_gateway': true,
    'manufacturer': 'Samsung',
    'device_model': 'Galaxy A54',
    'os_version': 'Android 14',
    'device_identity': 'edusms-android-test-01',
    'permissions_state': {
      'SEND_SMS': sendSmsGranted,
      'RECEIVE_SMS': receiveSmsGranted,
      'READ_SMS': receiveSmsGranted,
      'READ_PHONE_STATE': true,
    },
    'sim_available': true,
    'sim_slots': [
      {
        'slot_index': 0,
        'subscription_id': 1,
        'carrier_name': 'Vodacom TZ',
        'display_name': 'Vodacom',
        'country_iso': 'TZ',
        'number_hint': '+255754000111',
      },
    ],
    'selected_sim_slot': 0,
    'network_type': 'LTE',
    'carrier_name': 'Vodacom TZ',
    'battery_level': 88,
    'is_charging': true,
    'is_default_sms_app': false,
    'gateway_configured': configured,
    'gateway_enabled': configured,
    'gateway_paused': paused,
    'service_running': running,
    'auto_resume_on_boot': true,
    'offline_inbound_queue_count': offlineInbound,
    'offline_status_queue_count': offlineStatus,
    'last_heartbeat_at': '2026-10-30T03:00:00Z',
    'last_error': '',
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(NativeGatewayBridge.methodChannelName);

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  group('NativeGatewayBridge MethodChannel & Honest iOS Companion Mode', () {
    test(
      'invokes Android MethodChannel methods with expected arguments and parses diagnostics',
      () async {
        final recordedCalls = <MethodCall>[];
        var isPaused = false;

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
          recordedCalls.add(call);
          switch (call.method) {
            case 'getDiagnostics':
              return _androidDiagPayload(paused: isPaused);
            case 'configureGateway':
              return _androidDiagPayload(configured: true, paused: isPaused);
            case 'startGatewayService':
              isPaused = false;
              return _androidDiagPayload(running: true, paused: false);
            case 'pauseGatewayService':
              isPaused = true;
              return _androidDiagPayload(running: true, paused: true);
            case 'requestDefaultSmsRole':
              return {'is_default_sms_app': true};
            default:
              return _androidDiagPayload();
          }
        });

        final bridge = NativeGatewayBridge(
          capabilities: PlatformCapabilities.android(),
        );

        final initial = await bridge.getDiagnostics();
        expect(initial.supportsPhysicalSimGateway, isTrue);
        expect(initial.manufacturer, 'Samsung');
        expect(initial.simSlots.single.carrierName, 'Vodacom TZ');

        await bridge.configureGateway(
          apiBaseUrl: 'http://192.168.1.25:8000',
          gatewayToken: 'gw_secret_token_123',
          deviceIdentity: 'edusms-android-test-01',
          selectedSimSlot: 0,
        );

        final started = await bridge.startGatewayService();
        expect(started.serviceRunning, isTrue);
        expect(started.gatewayPaused, isFalse);

        final paused = await bridge.pauseGatewayService();
        expect(paused.gatewayPaused, isTrue);

        final roleGranted = await bridge.requestDefaultSmsRole();
        expect(roleGranted, isTrue);

        expect(
          recordedCalls.map((c) => c.method).toList(),
          [
            'getDiagnostics',
            'configureGateway',
            'startGatewayService',
            'pauseGatewayService',
            'requestDefaultSmsRole',
          ],
        );
        final configArgs = Map<String, dynamic>.from(recordedCalls[1].arguments as Map);
        expect(configArgs['apiBaseUrl'], 'http://192.168.1.25:8000');
        expect(configArgs['gatewayToken'], 'gw_secret_token_123');
      },
    );

    test(
      'iOS Companion Mode honestly returns non-SIM fallback without calling Android MethodChannel',
      () async {
        var channelInvoked = false;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
          channelInvoked = true;
          return null;
        });

        final iosBridge = NativeGatewayBridge(
          capabilities: PlatformCapabilities.iosCompanion(),
        );

        final diag = await iosBridge.getDiagnostics();
        expect(diag.platform, 'ios');
        expect(diag.supportsPhysicalSimGateway, isFalse);
        expect(diag.simAvailable, isFalse);
        expect(channelInvoked, isFalse);
      },
    );
  });

  group('GatewayRepository Pairing Confirmation & GatewayControlCard States', () {
    test(
      'confirmHandsetPairing parses QR JSON payload, posts hardware telemetry, saves token, and configures native service',
      () async {
        final configuredCalls = <MethodCall>[];
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'configureGateway') {
            configuredCalls.add(call);
          }
          return _androidDiagPayload(configured: false, running: false);
        });

        final mockApi = MockApiClient();
        when(() => mockApi.baseUrl).thenReturn('http://10.0.2.2:8000');
        when(
          () => mockApi.post(
            '/api/v1/devices/pair/confirm/',
            data: any(named: 'data'),
          ),
        ).thenAnswer(
          (_) async => {
            'gateway_token': 'esmsgw_live_token_999',
            'device': {
              'id': 'dev-uuid-1',
              'name': 'Bursar Galaxy A54',
              'device_identity': 'edusms-android-test-01',
              'platform': 'android',
              'manufacturer': 'Samsung',
              'device_model': 'Galaxy A54',
              'os_version': 'Android 14',
              'gateway_token_prefix': 'esmsgw_l',
              'is_enabled': true,
              'is_paused': false,
              'connection_status': 'online',
              'is_online': true,
              'can_transmit_real_sms': true,
              'sim_available': true,
              'sim_slots': const <Map<String, dynamic>>[],
              'selected_sim_slot': 0,
              'network_type': 'LTE',
              'carrier_name': 'Vodacom TZ',
              'battery_level': 88,
              'is_charging': true,
            },
          },
        );

        final tokenStorage = InMemoryTokenStorage();
        final bridge = NativeGatewayBridge(
          capabilities: PlatformCapabilities.android(),
        );
        final repo = GatewayRepository(
          apiClient: mockApi,
          tokenStorage: tokenStorage,
          nativeBridge: bridge,
        );

        final result = await repo.confirmHandsetPairing(
          codeOrQrPayload:
              '{"code":"k7m9q2","pairing_id":"pair-session-42","api_url":"http://192.168.1.99:8000"}',
          customDeviceName: 'Bursar Galaxy A54',
        );

        expect(result.gatewayToken, 'esmsgw_live_token_999');
        expect(result.device.name, 'Bursar Galaxy A54');
        expect(await tokenStorage.getGatewayToken(), 'esmsgw_live_token_999');
        expect(await tokenStorage.getPairedDeviceId(), 'dev-uuid-1');

        final captured = verify(
          () => mockApi.post(
            '/api/v1/devices/pair/confirm/',
            data: captureAny(named: 'data'),
          ),
        ).captured.single as Map<String, dynamic>;
        expect(captured['pairing_code'], 'K7M9Q2');
        expect(captured['pairing_id'], 'pair-session-42');
        expect(captured['device_identity'], 'edusms-android-test-01');

        expect(configuredCalls, hasLength(1));
        final nativeArgs = Map<String, dynamic>.from(configuredCalls.single.arguments as Map);
        expect(nativeArgs['apiBaseUrl'], 'http://192.168.1.99:8000');
        expect(nativeArgs['gatewayToken'], 'esmsgw_live_token_999');
      },
    );

    testWidgets(
      'GatewayControlCard displays permission recovery banner, offline queue count, and Pause/Resume controls',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();

        var paused = false;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'pauseGatewayService') {
            paused = true;
          }
          return _androidDiagPayload(
            sendSmsGranted: false,
            configured: true,
            running: true,
            paused: paused,
            offlineInbound: 2,
            offlineStatus: 1,
          );
        });

        final bridge = NativeGatewayBridge(
          capabilities: PlatformCapabilities.android(),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              sharedPreferencesProvider.overrideWithValue(prefs),
              platformCapabilitiesProvider.overrideWithValue(
                PlatformCapabilities.android(),
              ),
              nativeGatewayBridgeProvider.overrideWithValue(bridge),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const Scaffold(
                body: Padding(
                  padding: EdgeInsets.all(16),
                  child: GatewayControlCard(),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('android_gateway_control_card')), findsOneWidget);
        expect(find.text('Foreground Gateway Online'), findsOneWidget);
        expect(find.byKey(const Key('permission_denied_recovery_banner')), findsOneWidget);
        expect(find.byKey(const Key('offline_queue_badge')), findsOneWidget);
        expect(find.text('Offline Queue: 3 event(s) awaiting sync'), findsOneWidget);

        // Tap Pause -> transitions to Gateway Paused
        await tester.tap(find.byKey(const Key('gateway_pause_button')));
        await tester.pumpAndSettle();

        expect(find.text('Gateway Paused'), findsOneWidget);
        expect(find.byKey(const Key('gateway_resume_button')), findsOneWidget);
      },
    );

    testWidgets(
      'DevicesScreen confirms 6-character handset pairing and renders confirmation banner',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
          return _androidDiagPayload(configured: false, running: false);
        });

        final mockGatewayRepo = MockGatewayRepository();
        const pairedDevice = PairedDevice(
          id: 'dev-1',
          name: 'Campus Vodacom Handset',
          deviceIdentity: 'edusms-android-test-01',
          platform: 'android',
          manufacturer: 'Samsung',
          deviceModel: 'Galaxy A54',
          osVersion: 'Android 14',
          gatewayTokenPrefix: 'esmsgw_1',
          isEnabled: true,
          isPaused: false,
          connectionStatus: 'online',
          isOnline: true,
          canTransmitRealSms: true,
          simAvailable: true,
          simSlots: [],
          selectedSimSlot: 0,
          networkType: 'LTE',
          carrierName: 'Vodacom TZ',
          batteryLevel: 90,
          isCharging: false,
          isDefaultSmsApp: false,
          permissionsState: {'SEND_SMS': true, 'RECEIVE_SMS': true},
          incomingMessageCount: 4,
          outgoingMessageCount: 11,
          failedTransmissionCount: 0,
          pendingJobsCount: 0,
          lastError: '',
          recommendedAction: '',
          lastHeartbeatAt: '2026-10-30T03:00:00Z',
        );

        when(() => mockGatewayRepo.listDevices()).thenAnswer((_) async => const []);
        when(
          () => mockGatewayRepo.confirmHandsetPairing(
            codeOrQrPayload: 'A7K9P2',
            customDeviceName: any(named: 'customDeviceName'),
          ),
        ).thenAnswer(
          (_) async => const PairingConfirmResult(
            device: pairedDevice,
            gatewayToken: 'esmsgw_123456',
          ),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              sharedPreferencesProvider.overrideWithValue(prefs),
              platformCapabilitiesProvider.overrideWithValue(
                PlatformCapabilities.android(),
              ),
              gatewayRepositoryProvider.overrideWithValue(mockGatewayRepo),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const DevicesScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const Key('pairing_code_or_qr_input')),
          'A7K9P2',
        );
        await tester.tap(find.byKey(const Key('confirm_pairing_button')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('pairing_confirmed_banner')), findsOneWidget);
        expect(find.textContaining('Campus Vodacom Handset'), findsWidgets);
      },
    );
  });
}
