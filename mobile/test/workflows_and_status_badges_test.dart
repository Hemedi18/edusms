import 'package:edusms_mobile/core/theme/app_theme.dart';
import 'package:edusms_mobile/core/widgets/transport_status_badge.dart';
import 'package:edusms_mobile/data/models/automation_models.dart';
import 'package:edusms_mobile/data/models/campaign_models.dart';
import 'package:edusms_mobile/data/models/contact_models.dart';
import 'package:edusms_mobile/data/repositories/automation_repository.dart';
import 'package:edusms_mobile/data/repositories/campaigns_repository.dart';
import 'package:edusms_mobile/data/repositories/contacts_repository.dart';
import 'package:edusms_mobile/data/repositories/gateway_repository.dart';
import 'package:edusms_mobile/data/repositories/messaging_repository.dart';
import 'package:edusms_mobile/features/automation/automation_screen.dart';
import 'package:edusms_mobile/features/campaigns/campaigns_screen.dart';
import 'package:edusms_mobile/features/contacts/contacts_screen.dart';
import 'package:edusms_mobile/features/messages/compose_sms_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:edusms_mobile/core/storage/app_preferences.dart';

class MockContactsRepository extends Mock implements ContactsRepository {}

class MockAutomationRepository extends Mock implements AutomationRepository {}

class MockCampaignsRepository extends Mock implements CampaignsRepository {}

class MockGatewayRepository extends Mock implements GatewayRepository {}

class MockMessagingRepository extends Mock implements MessagingRepository {}

void main() {
  group('Honest TransportStatusBadge Rendering', () {
    test('separates submitted (Accepted for Transmission) from Carrier Delivered and Simulated', () {
      final submitted = TransportStatusBadge.describe('submitted', isSimulation: false);
      expect(submitted.label, 'Accepted for Transmission');
      expect(submitted.label, isNot('Carrier Delivered'));

      final delivered = TransportStatusBadge.describe('delivered', isSimulation: false);
      expect(delivered.label, 'Carrier Delivered');

      final simulated = TransportStatusBadge.describe(
        'simulated_delivered',
        isSimulation: true,
      );
      expect(simulated.label, 'Simulated');

      final unknown = TransportStatusBadge.describe('delivery_unknown', isSimulation: false);
      expect(unknown.label, 'Delivery Unknown');

      final failed = TransportStatusBadge.describe('failed', isSimulation: false);
      expect(failed.label, 'Failed');
    });

    testWidgets('renders honest status & transport pills in widget tree', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: const Scaffold(
            body: Column(
              children: [
                TransportStatusBadge(
                  status: 'submitted',
                  transportType: 'sim_gateway',
                ),
                TransportStatusBadge(
                  status: 'delivered',
                  transportType: 'sim_gateway',
                ),
                TransportStatusBadge(
                  status: 'simulated_delivered',
                  isSimulation: true,
                  transportType: 'simulation',
                ),
              ],
            ),
          ),
        ),
      );

      expect(find.text('Accepted for Transmission'), findsOneWidget);
      expect(find.text('Carrier Delivered'), findsOneWidget);
      expect(find.text('Simulated'), findsOneWidget);
      expect(find.text('ANDROID SIM'), findsNWidgets(2));
      expect(find.text('SIMULATION'), findsOneWidget);
    });
  });

  group('Contacts (+255 & CSV Consent), Automation Tester, Campaign Builder & Compose Disclosure', () {
    testWidgets(
      'ContactsScreen previews +255 E.164 normalization and enforces mandatory CSV consent checkbox',
      (tester) async {
        final mockContactsRepo = MockContactsRepository();
        when(() => mockContactsRepo.listContacts(search: any(named: 'search')))
            .thenAnswer((_) async => const []);
        when(() => mockContactsRepo.listGroups()).thenAnswer((_) async => const []);
        when(() => mockContactsRepo.listSuppressions()).thenAnswer((_) async => const []);

        when(
          () => mockContactsRepo.createContact(
            name: 'Amina Juma',
            phoneNumber: '0754100201',
            optInStatus: true,
          ),
        ).thenAnswer(
          (_) async => const ContactItem(
            id: 'c-1',
            name: 'Amina Juma',
            phoneNumber: '+255754100201',
            email: '',
            isVirtual: false,
            allowOutgoing: true,
            optInStatus: true,
            optOutStatus: false,
            notes: '',
            groups: [],
          ),
        );

        when(
          () => mockContactsRepo.importCsv(
            csvText: any(named: 'csvText'),
            consentConfirmed: true,
            markOptedIn: true,
          ),
        ).thenAnswer((_) async => {'imported_count': 2, 'skipped_count': 0});

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              contactsRepositoryProvider.overrideWithValue(mockContactsRepo),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const ContactsScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // 1. Open Add Contact dialog and verify +255 live E.164 preview
        await tester.tap(find.byKey(const Key('open_add_contact_button')));
        await tester.pumpAndSettle();

        await tester.enterText(find.byKey(const Key('contact_name_input')), 'Amina Juma');
        await tester.enterText(find.byKey(const Key('contact_phone_input')), '0754100201');
        await tester.pumpAndSettle();

        expect(find.textContaining('+255754100201'), findsOneWidget);

        await tester.tap(find.byKey(const Key('save_contact_button')));
        await tester.pumpAndSettle();

        verify(
          () => mockContactsRepo.createContact(
            name: 'Amina Juma',
            phoneNumber: '0754100201',
            optInStatus: true,
          ),
        ).called(1);

        // 2. Open CSV Import dialog -> submit WITHOUT checking consent -> error shown
        await tester.tap(find.byKey(const Key('open_csv_import_button')));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('csv_import_submit_button')));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('csv_consent_error_text')), findsOneWidget);
        verifyNever(
          () => mockContactsRepo.importCsv(
            csvText: any(named: 'csvText'),
            consentConfirmed: any(named: 'consentConfirmed'),
            markOptedIn: any(named: 'markOptedIn'),
          ),
        );

        // Check mandatory consent checkbox and submit -> importCsv called!
        await tester.tap(find.byKey(const Key('csv_consent_checkbox')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('csv_import_submit_button')));
        await tester.pumpAndSettle();

        verify(
          () => mockContactsRepo.importCsv(
            csvText: any(named: 'csvText'),
            consentConfirmed: true,
            markOptedIn: true,
          ),
        ).called(1);
      },
    );

    testWidgets(
      'AutomationScreen Dry-Run Rule Tester evaluates keyword match and displays rendered response',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();

        final mockAutoRepo = MockAutomationRepository();
        when(() => mockAutoRepo.listModes()).thenAnswer((_) async => const []);
        when(() => mockAutoRepo.listRules()).thenAnswer((_) async => const []);
        when(() => mockAutoRepo.listSchedules()).thenAnswer((_) async => const []);
        when(() => mockAutoRepo.listAiProviders()).thenAnswer((_) async => const []);
        when(() => mockAutoRepo.listAiLogs()).thenAnswer((_) async => const []);

        when(
          () => mockAutoRepo.testRuleDryRun(
            senderNumber: '+255754100201',
            body: 'FEES',
          ),
        ).thenAnswer(
          (_) async => const RuleDryRunResult(
            wouldReply: true,
            decision: 'matched_rule',
            matchedModeName: 'Office Hours',
            responsePreview: 'Tuition fee balance inquiries: dial *150*00# or visit Bursar.',
            reason: 'Matched keyword FEES',
            diagnostics: ['Rule: Tuition Fee Keyword (contains)'],
          ),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              sharedPreferencesProvider.overrideWithValue(prefs),
              automationRepositoryProvider.overrideWithValue(mockAutoRepo),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const AutomationScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Switch to "Rules & Tester" tab
        await tester.tap(find.text('Rules & Tester'));
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('rule_tester_run_button')));
        await tester.pumpAndSettle();

        expect(
          find.textContaining('Tuition fee balance inquiries'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'CampaignsScreen Builder previews deduplicated audience and rendered sample message',
      (tester) async {
        final mockCampaignsRepo = MockCampaignsRepository();
        final mockContactsRepo = MockContactsRepository();

        when(() => mockCampaignsRepo.listCampaigns()).thenAnswer((_) async => const []);
        when(() => mockContactsRepo.listGroups()).thenAnswer((_) async => const []);
        when(
          () => mockCampaignsRepo.previewAudience(
            messageTemplate: any(named: 'messageTemplate'),
            transportType: any(named: 'transportType'),
            groupIds: any(named: 'groupIds'),
            rawNumbers: any(named: 'rawNumbers'),
          ),
        ).thenAnswer(
          (_) async => const AudiencePreviewResult(
            totalInputCount: 3,
            duplicateRemovedCount: 1,
            eligibleCount: 2,
            excludedCount: 0,
            samplePreview: 'Dear Parent, parent-teacher conference begins Friday at 09:00.',
          ),
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              campaignsRepositoryProvider.overrideWithValue(mockCampaignsRepo),
              contactsRepositoryProvider.overrideWithValue(mockContactsRepo),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const CampaignsScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Campaign Builder'));
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const Key('campaign_raw_numbers_input')),
          '+255754100201, +255754100201, +255754100202',
        );
        final previewBtn = find.byKey(const Key('campaign_preview_audience_button'));
        await tester.ensureVisible(previewBtn);
        await tester.tap(previewBtn);
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('campaign_audience_preview_card')), findsOneWidget);
        expect(
          find.textContaining('Rendered Sample: Dear Parent, parent-teacher conference'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'ComposeSmsScreen displays carrier charge disclosure banner when Android SIM Gateway is selected',
      (tester) async {
        final mockGatewayRepo = MockGatewayRepository();
        final mockMessagingRepo = MockMessagingRepository();

        when(() => mockGatewayRepo.listDevices()).thenAnswer((_) async => const []);
        when(() => mockMessagingRepo.listSenderIdentities()).thenAnswer((_) async => const []);

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              gatewayRepositoryProvider.overrideWithValue(mockGatewayRepo),
              messagingRepositoryProvider.overrideWithValue(mockMessagingRepo),
            ],
            child: MaterialApp(
              theme: AppTheme.darkTheme,
              home: const ComposeSmsScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('carrier_charge_warning_banner')), findsNothing);
        await tester.tap(find.byKey(const Key('transport_sim_gateway_chip')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('carrier_charge_warning_banner')), findsOneWidget);
      },
    );
  });
}
