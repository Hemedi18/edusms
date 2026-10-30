from __future__ import annotations

import traceback
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def edusms_exception_handler(exc, context):
    response = exception_handler(exc, context)
    request = context.get("request")
    view = context.get("view")

    if response is None or response.status_code >= 500:
        try:
            from .models import ErrorReport
            from .support_service import record_error_and_notify

            record_error_and_notify(
                user=getattr(request, "user", None),
                request=request,
                source=ErrorReport.Source.BACKEND_EXCEPTION,
                severity=ErrorReport.Severity.CRITICAL,
                title=f"Backend Exception ({exc.__class__.__name__})",
                message=str(exc) or "Unhandled server exception",
                stack_trace=traceback.format_exc(),
                page_url=request.build_absolute_uri() if request else "",
                component_name=view.__class__.__name__ if view else "APIView",
            )
        except Exception:
            pass

        if response is None:
            return Response(
                {
                    "error": {
                        "code": "internal_server_error",
                        "message": "An unexpected server error occurred. It has been recorded and sent to support.",
                        "details": {"detail": str(exc)},
                    }
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    data = response.data
    code = getattr(exc, "default_code", "error")
    message = "Request failed."

    if isinstance(data, dict):
        if "detail" in data:
            message = str(data["detail"])
        elif data:
            first_key = next(iter(data))
            first_val = data[first_key]
            if isinstance(first_val, list) and first_val:
                message = f"{first_key}: {first_val[0]}"
            else:
                message = f"{first_key}: {first_val}"
        details = data
    elif isinstance(data, list):
        message = str(data[0]) if data else message
        details = {"non_field_errors": data}
    else:
        message = str(data)
        details = {"detail": str(data)}

    if response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        code = "rate_limited"

    wrapped = {
        "error": {
            "code": str(code),
            "message": message,
            "details": details,
        },
        **(details if isinstance(details, dict) else {}),
    }
    return Response(wrapped, status=response.status_code, headers=response.headers)
