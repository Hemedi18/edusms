import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Describes genuine OS-level telephony capabilities for the current platform.
/// Android supports physical cellular SIM gateway access via SmsManager & BroadcastReceivers.
/// Apple iOS sandboxes third-party apps from carrier SMS transmission/interception,
/// so iOS runs honestly in Companion Mode.
@immutable
class PlatformCapabilities {
  const PlatformCapabilities({
    required this.platformName,
    required this.supportsPhysicalSimGateway,
    required this.isAndroid,
    required this.isIos,
    required this.defaultApiBaseUrl,
    required this.gatewayCapabilitySummary,
  });

  final String platformName;
  final bool supportsPhysicalSimGateway;
  final bool isAndroid;
  final bool isIos;
  final String defaultApiBaseUrl;
  final String gatewayCapabilitySummary;

  factory PlatformCapabilities.detect() {
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
      return PlatformCapabilities.android();
    }
    if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
      return PlatformCapabilities.iosCompanion();
    }
    return const PlatformCapabilities(
      platformName: 'companion',
      supportsPhysicalSimGateway: false,
      isAndroid: false,
      isIos: false,
      defaultApiBaseUrl: 'http://127.0.0.1:8000',
      gatewayCapabilitySummary:
          'Companion Mode active. Physical SIM radio transmission requires an Android handset; '
          'you can manage remote paired Android gateways, External Providers, and Simulation Lab.',
    );
  }

  factory PlatformCapabilities.android() {
    return const PlatformCapabilities(
      platformName: 'android',
      supportsPhysicalSimGateway: true,
      isAndroid: true,
      isIos: false,
      defaultApiBaseUrl: 'http://10.0.2.2:8000',
      gatewayCapabilitySummary:
          'Native Android SmsManager & Foreground Gateway Service available for authorized SIM SMS.',
    );
  }

  factory PlatformCapabilities.iosCompanion() {
    return const PlatformCapabilities(
      platformName: 'ios',
      supportsPhysicalSimGateway: false,
      isAndroid: false,
      isIos: true,
      defaultApiBaseUrl: 'http://127.0.0.1:8000',
      gatewayCapabilitySummary:
          'iOS Companion Mode: Apple iOS sandboxing restricts third-party apps from reading '
          'incoming carrier SMS or transmitting background SIM messages. Pair a dedicated Android '
          'gateway phone or use External Provider / Simulation Mode from this iPhone.',
    );
  }
}

final platformCapabilitiesProvider = Provider<PlatformCapabilities>((ref) {
  return PlatformCapabilities.detect();
});
