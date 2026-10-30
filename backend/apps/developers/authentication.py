from __future__ import annotations

from django.core.cache import cache
from django.utils import timezone
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied, Throttled

from apps.core.crypto import sha256_hex
from .models import APIKey


class ScopedAPIKeyAuthentication(authentication.BaseAuthentication):
    """
    Authenticates external developer requests via `X-API-Key: edusms_...`
    or `Authorization: Api-Key edusms_...`.
    Enforces key revocation, expiration, and per-key rate limits.
    """

    def authenticate(self, request):
        raw_key = request.headers.get("X-API-Key", "").strip()
        if not raw_key:
            auth_header = request.headers.get("Authorization", "").strip()
            if auth_header.lower().startswith("api-key "):
                raw_key = auth_header.split(" ", 1)[1].strip()
        if not raw_key:
            return None

        key_hash = sha256_hex(raw_key)
        api_key = APIKey.objects.select_related("user").filter(key_hash=key_hash).first()
        if not api_key:
            raise AuthenticationFailed("Invalid developer API key.")
        if api_key.revoked_at is not None:
            raise PermissionDenied("This API key has been revoked.")
        if api_key.expires_at and timezone.now() >= api_key.expires_at:
            raise PermissionDenied("This API key has expired.")
        if not api_key.user.is_active:
            raise PermissionDenied("Owning account is inactive.")

        # Enforce per-key per-minute rate limit
        now_minute = timezone.now().strftime("%Y%m%d%H%M")
        bucket_key = f"apikey_rl:{api_key.id}:{now_minute}"
        try:
            current = cache.get(bucket_key, 0)
            if current >= api_key.rate_limit_per_minute:
                raise Throttled(detail=f"API key rate limit ({api_key.rate_limit_per_minute}/min) exceeded.")
            cache.set(bucket_key, current + 1, timeout=65)
        except Throttled:
            raise
        except Exception:
            pass

        APIKey.objects.filter(pk=api_key.pk).update(last_used_at=timezone.now())
        request.api_key_record = api_key
        return (api_key.user, api_key)
