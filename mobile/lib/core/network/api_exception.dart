import 'package:dio/dio.dart';

class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.statusCode,
    this.code = 'api_error',
    this.details = const {},
    this.isNetworkOffline = false,
  });

  final String message;
  final int? statusCode;
  final String code;
  final Map<String, dynamic> details;
  final bool isNetworkOffline;

  bool get isMfaRequired =>
      details.containsKey('mfa_required') ||
      message.toLowerCase().contains('multi-factor authentication code is required');

  factory ApiException.fromDioException(DioException error) {
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return ApiException(
        message: 'Cannot reach EduSMS backend server. Check your network or Backend URL setting.',
        statusCode: error.response?.statusCode,
        code: 'network_offline',
        isNetworkOffline: true,
      );
    }

    final statusCode = error.response?.statusCode;
    final data = error.response?.data;

    if (data is Map) {
      final map = Map<String, dynamic>.from(data);
      final errObj = map['error'];
      if (errObj is Map) {
        final errMap = Map<String, dynamic>.from(errObj);
        final rawDetails = errMap['details'];
        return ApiException(
          message: (errMap['message'] ?? map['detail'] ?? 'Request failed.').toString(),
          statusCode: statusCode,
          code: (errMap['code'] ?? 'api_error').toString(),
          details: rawDetails is Map ? Map<String, dynamic>.from(rawDetails) : map,
        );
      }
      if (map['detail'] != null) {
        return ApiException(
          message: map['detail'].toString(),
          statusCode: statusCode,
          details: map,
        );
      }
      if (map.isNotEmpty) {
        final firstKey = map.keys.first;
        final firstVal = map[firstKey];
        final msg = firstVal is List && firstVal.isNotEmpty
            ? '$firstKey: ${firstVal.first}'
            : '$firstKey: $firstVal';
        return ApiException(
          message: msg,
          statusCode: statusCode,
          details: map,
        );
      }
    }

    return ApiException(
      message: error.message ?? 'Unexpected server error (${statusCode ?? 'unknown'}).',
      statusCode: statusCode,
    );
  }

  @override
  String toString() => message;
}
