import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../storage/app_preferences.dart';
import '../storage/secure_token_storage.dart';

/// Connects to `/ws/events/?token=...` for live gateway, message, campaign,
/// and automation updates with graceful fallback when offline or in tests.
class RealtimeWsService {
  RealtimeWsService({
    required this._tokenStorage,
    required this._baseUrlGetter,
    this.enabled = true,
  });

  final TokenStorage _tokenStorage;
  final String Function() _baseUrlGetter;
  final bool enabled;

  final StreamController<Map<String, dynamic>> _controller =
      StreamController<Map<String, dynamic>>.broadcast();
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  bool _connected = false;

  bool get isConnected => _connected;
  Stream<Map<String, dynamic>> get events => _controller.stream;

  static Uri buildWsUri(String httpBaseUrl, String accessToken) {
    final parsed = Uri.parse(httpBaseUrl.trim());
    final wsScheme = parsed.scheme == 'https' ? 'wss' : 'ws';
    return parsed.replace(
      scheme: wsScheme,
      path: '/ws/events/',
      queryParameters: {'token': accessToken},
    );
  }

  Future<void> connect() async {
    if (!enabled) return;
    await disconnect();
    try {
      final token = await _tokenStorage.getAccessToken();
      if (token == null || token.isEmpty) return;

      final uri = buildWsUri(_baseUrlGetter(), token);
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      _subscription = channel.stream.listen(
        (dynamic message) {
          _connected = true;
          if (message is String) {
            try {
              final decoded = jsonDecode(message);
              if (decoded is Map) {
                _controller.add(Map<String, dynamic>.from(decoded));
              }
            } catch (_) {
              // Ignore non-JSON frames
            }
          }
        },
        onError: (_) {
          _connected = false;
        },
        onDone: () {
          _connected = false;
        },
        cancelOnError: false,
      );
    } catch (_) {
      _connected = false;
    }
  }

  Future<void> disconnect() async {
    _connected = false;
    await _subscription?.cancel();
    _subscription = null;
    try {
      await _channel?.sink.close();
    } catch (_) {
      // Ignore socket close errors
    }
    _channel = null;
  }

  void dispose() {
    unawaited(disconnect());
    unawaited(_controller.close());
  }
}

final realtimeWsServiceProvider = Provider<RealtimeWsService>((ref) {
  final service = RealtimeWsService(
    tokenStorage: ref.watch(tokenStorageProvider),
    baseUrlGetter: () => ref.read(apiBaseUrlProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});
