import os
from urllib.parse import parse_qs

import django
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "edusms.settings")
django.setup()

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from channels.routing import ProtocolTypeRouter, URLRouter
from django.contrib.auth.models import AnonymousUser
from django.urls import path
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.core.consumers import AccountEventsConsumer


@database_sync_to_async
def get_user_from_token(raw_token: str):
    try:
        validated = AccessToken(raw_token)
        user_id = validated.get("user_id")
        if not user_id:
            return AnonymousUser()
        return User.objects.filter(id=user_id, is_active=True).first() or AnonymousUser()
    except Exception:
        return AnonymousUser()


class JWTQueryAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        token = params.get("token", [None])[0]
        if not token:
            headers = dict(scope.get("headers", []))
            auth_header = headers.get(b"authorization", b"").decode("utf-8")
            if auth_header.lower().startswith("bearer "):
                token = auth_header.split(" ", 1)[1].strip()
        scope["user"] = await get_user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)


django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": JWTQueryAuthMiddleware(
            URLRouter(
                [
                    path("ws/events/", AccountEventsConsumer.as_asgi()),
                ]
            )
        ),
    }
)
