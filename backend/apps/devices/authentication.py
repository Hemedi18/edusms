from __future__ import annotations

from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied

from apps.core.crypto import sha256_hex
from .models import Device


class GatewayTokenAuthentication(authentication.BaseAuthentication):
    """
    Authenticates paired Android gateway devices via `X-Gateway-Token: edugw_...`.
    Immediately rejects revoked or disabled credentials.
    """

    def authenticate(self, request):
        raw_token = request.headers.get("X-Gateway-Token", "").strip()
        if not raw_token:
            auth_header = request.headers.get("Authorization", "").strip()
            if auth_header.lower().startswith("gateway "):
                raw_token = auth_header.split(" ", 1)[1].strip()
        if not raw_token:
            return None

        token_hash = sha256_hex(raw_token)
        device = Device.objects.select_related("user").filter(gateway_token_hash=token_hash).first()
        if not device:
            raise AuthenticationFailed("Invalid gateway device credential.")
        if device.revoked_at is not None:
            raise PermissionDenied("This gateway device has been revoked and can no longer access EduSMS.")
        if not device.user.is_active:
            raise PermissionDenied("Owning account is inactive.")

        request.gateway_device = device
        return (device.user, device)
