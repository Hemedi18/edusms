import 'dart:async';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../storage/app_preferences.dart';
import '../storage/secure_token_storage.dart';
import 'api_exception.dart';

/// Production HTTP client with JWT Bearer authentication, automatic `/api/v1/auth/refresh/`
/// rotation on 401 responses, idempotency key generation, and DRF pagination helpers.
class ApiClient {
  ApiClient({
    required this._tokenStorage,
    required this._baseUrlGetter,
    Dio? dio,
    this.onSessionExpired,
  })  : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 12),
                receiveTimeout: const Duration(seconds: 20),
                headers: const {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
              ),
            ) {
    _configureInterceptors();
  }

  final TokenStorage _tokenStorage;
  final String Function() _baseUrlGetter;
  final Dio _dio;
  final void Function()? onSessionExpired;

  Completer<bool>? _refreshCompleter;

  Dio get rawDio => _dio;

  String get baseUrl => _baseUrlGetter();

  void _configureInterceptors() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          options.baseUrl = _baseUrlGetter();
          final skipAuth = options.extra['skipAuth'] == true;
          if (!skipAuth) {
            final access = await _tokenStorage.getAccessToken();
            if (access != null && access.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $access';
            }
          }
          handler.next(options);
        },
        onError: (err, handler) async {
          final req = err.requestOptions;
          final isAuthEndpoint = req.path.contains('/api/v1/auth/login/') ||
              req.path.contains('/api/v1/auth/register/') ||
              req.path.contains('/api/v1/auth/refresh/');
          final alreadyRetried = req.extra['retriedAfterRefresh'] == true;

          if (err.response?.statusCode == 401 && !isAuthEndpoint && !alreadyRetried) {
            final refreshed = await _tryRefreshSession();
            if (refreshed) {
              final nextAccess = await _tokenStorage.getAccessToken();
              req.extra['retriedAfterRefresh'] = true;
              req.baseUrl = _baseUrlGetter();
              if (nextAccess != null && nextAccess.isNotEmpty) {
                req.headers['Authorization'] = 'Bearer $nextAccess';
              }
              try {
                final retryResponse = await _dio.fetch<dynamic>(req);
                return handler.resolve(retryResponse);
              } on DioException catch (retryErr) {
                return handler.next(retryErr);
              }
            } else {
              await _tokenStorage.clearSession();
              onSessionExpired?.call();
            }
          }
          handler.next(err);
        },
      ),
    );
  }

  Future<bool> _tryRefreshSession() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    final completer = Completer<bool>();
    _refreshCompleter = completer;

    try {
      final refresh = await _tokenStorage.getRefreshToken();
      if (refresh == null || refresh.isEmpty) {
        completer.complete(false);
        return false;
      }

      final refreshDio = Dio(
        BaseOptions(
          baseUrl: _baseUrlGetter(),
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 12),
          headers: const {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        ),
      );
      final resp = await refreshDio.post<Map<String, dynamic>>(
        '/api/v1/auth/refresh/',
        data: {'refresh': refresh},
      );
      final data = resp.data;
      if (data != null && data['access'] != null && data['refresh'] != null) {
        await _tokenStorage.saveSession(
          accessToken: data['access'].toString(),
          refreshToken: data['refresh'].toString(),
          sessionId: data['session_id']?.toString(),
        );
        completer.complete(true);
        return true;
      }
      completer.complete(false);
      return false;
    } catch (_) {
      completer.complete(false);
      return false;
    } finally {
      _refreshCompleter = null;
    }
  }

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool skipAuth = false,
  }) async {
    try {
      final response = await _dio.get<dynamic>(
        path,
        queryParameters: queryParameters,
        options: Options(extra: {'skipAuth': skipAuth}),
      );
      return response.data;
    } on DioException catch (e) {
      throw ApiException.fromDioException(e);
    }
  }

  Future<dynamic> post(
    String path, {
    Object? data,
    Map<String, dynamic>? queryParameters,
    bool skipAuth = false,
    String? idempotencyKey,
  }) async {
    try {
      final headers = <String, dynamic>{};
      if (idempotencyKey != null && idempotencyKey.isNotEmpty) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      final response = await _dio.post<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: Options(
          headers: headers.isEmpty ? null : headers,
          extra: {'skipAuth': skipAuth},
        ),
      );
      return response.data;
    } on DioException catch (e) {
      throw ApiException.fromDioException(e);
    }
  }

  Future<dynamic> patch(
    String path, {
    Object? data,
  }) async {
    try {
      final response = await _dio.patch<dynamic>(path, data: data);
      return response.data;
    } on DioException catch (e) {
      throw ApiException.fromDioException(e);
    }
  }

  Future<dynamic> delete(String path) async {
    try {
      final response = await _dio.delete<dynamic>(path);
      return response.data;
    } on DioException catch (e) {
      throw ApiException.fromDioException(e);
    }
  }

  static List<Map<String, dynamic>> extractList(dynamic rawData) {
    if (rawData is List) {
      return rawData
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
    }
    if (rawData is Map && rawData['results'] is List) {
      final results = rawData['results'] as List;
      return results
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
    }
    return const [];
  }

  static String generateIdempotencyKey([String prefix = 'mob']) {
    final rng = Random.secure();
    final bytes = List<int>.generate(12, (_) => rng.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '$prefix-${DateTime.now().millisecondsSinceEpoch}-$hex';
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return ApiClient(
    tokenStorage: tokenStorage,
    baseUrlGetter: () => ref.read(apiBaseUrlProvider),
  );
});
