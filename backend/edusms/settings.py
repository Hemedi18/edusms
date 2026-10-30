"""
EduSMS Django Settings.
Designed for security, multi-tenant account isolation, PostgreSQL, Redis, Celery, and Channels.
"""
from __future__ import annotations

import os
import re
import logging
from datetime import timedelta
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

load_dotenv(REPO_ROOT / ".env")


def env_bool(key: str, default: bool = False) -> bool:
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: list[str]) -> list[str]:
    val = os.getenv(key)
    if not val:
        return default
    return [item.strip() for item in val.split(",") if item.strip()]


DJANGO_ENV = os.getenv("DJANGO_ENV", "development").strip().lower()
IS_PRODUCTION = DJANGO_ENV == "production"
DEBUG = env_bool("DJANGO_DEBUG", default=not IS_PRODUCTION)

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
FIELD_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY", "")

PLACEHOLDER_PREFIXES = ("CHANGE_ME", "YOUR_", "INSECURE")

if IS_PRODUCTION:
    if not SECRET_KEY or len(SECRET_KEY) < 32 or SECRET_KEY.startswith(PLACEHOLDER_PREFIXES):
        raise RuntimeError(
            "FATAL: DJANGO_SECRET_KEY is missing, too short (<32 chars), or uses a placeholder in production."
        )
    if not FIELD_ENCRYPTION_KEY or len(FIELD_ENCRYPTION_KEY) < 32 or FIELD_ENCRYPTION_KEY.startswith(PLACEHOLDER_PREFIXES):
        raise RuntimeError(
            "FATAL: FIELD_ENCRYPTION_KEY is missing, too short (<32 chars), or uses a placeholder in production."
        )
    if DEBUG:
        raise RuntimeError("FATAL: DJANGO_DEBUG cannot be True when DJANGO_ENV=production.")
else:
    if not SECRET_KEY or SECRET_KEY.startswith(PLACEHOLDER_PREFIXES):
        SECRET_KEY = "dev-only-edusms-secret-key-do-not-use-in-production-9f8e7d6c5b4a"
    if not FIELD_ENCRYPTION_KEY or FIELD_ENCRYPTION_KEY.startswith(PLACEHOLDER_PREFIXES):
        FIELD_ENCRYPTION_KEY = "dev-only-edusms-field-encryption-secret-key-32bytes+"

ALLOWED_HOSTS = list(
    dict.fromkeys(
        [
            *env_list(
                "DJANGO_ALLOWED_HOSTS",
                [
                    "localhost",
                    "127.0.0.1",
                    "0.0.0.0",
                    "backend",
                    "testserver",
                    "edusms.edusphere.co.tz",
                    "edusphere.co.tz",
                    ".edusphere.co.tz",
                ],
            ),
            "testserver",
            "edusms.edusphere.co.tz",
            "edusphere.co.tz",
            ".edusphere.co.tz",
        ]
    )
)

# --- Application definition ---
INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "corsheaders",
    "django_filters",
    "channels",
    # EduSMS Domain Apps
    "apps.core",
    "apps.accounts",
    "apps.devices",
    "apps.contacts",
    "apps.messaging",
    "apps.automation",
    "apps.campaigns",
    "apps.developers",
    "apps.analytics",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "edusms.urls"
ASGI_APPLICATION = "edusms.asgi.application"
WSGI_APPLICATION = "edusms.wsgi.application"

AUTH_USER_MODEL = "accounts.User"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- PostgreSQL Database ---
# Automatically prefers local UNIX socket `/tmp/edusms-pg-sock` in dev/sandbox when socket is active
_env_pg_host = os.getenv("POSTGRES_HOST", "").strip()
if Path("/tmp/edusms-pg-sock/.s.PGSQL.5432").exists() and _env_pg_host in {"", "localhost", "127.0.0.1"}:
    _default_pg_host = "/tmp/edusms-pg-sock"
else:
    _default_pg_host = _env_pg_host or "localhost"

_env_pg_pass = os.getenv("POSTGRES_PASSWORD", "edusms_dev_pass")
if _env_pg_pass.startswith("CHANGE_ME"):
    _env_pg_pass = "edusms_dev_pass"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "edusms"),
        "USER": os.getenv("POSTGRES_USER", "edusms"),
        "PASSWORD": _env_pg_pass,
        "HOST": _default_pg_host,
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# --- Password Hashing ---
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Redis, Cache, Celery & Channels ---
_redis_sock = "/tmp/edusms-redis/redis.sock"
_env_redis = os.getenv("REDIS_URL", "").strip()
_is_local_sandbox = Path("/tmp/edusms-pg-sock/.s.PGSQL.5432").exists() and (
    not _env_redis or "localhost" in _env_redis or "127.0.0.1" in _env_redis
)

if Path(_redis_sock).exists() and _is_local_sandbox:
    REDIS_URL = f"unix://{_redis_sock}?db=0"
    CELERY_BROKER_URL = "memory://localhost/"
    CELERY_RESULT_BACKEND = "cache+memory://"
    CELERY_TASK_IGNORE_RESULT = True
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
elif _is_local_sandbox:
    REDIS_URL = "unix:///tmp/edusms-redis/redis.sock?db=0"
    CELERY_BROKER_URL = "memory://"
    CELERY_RESULT_BACKEND = "cache+memory://"
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "edusms-local-cache",
        }
    }
else:
    REDIS_URL = _env_redis or "redis://localhost:6379/0"
    CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/1")
    CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }

CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 120
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", default=False)

if REDIS_URL.startswith("unix://") or env_bool("USE_INMEMORY_CHANNELS", default=False):
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
            },
        }
    }

# --- Internationalization ---
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
DEFAULT_PHONE_REGION = os.getenv("DEFAULT_PHONE_REGION", "TZ")

# --- Static files ---
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- CORS & CSRF ---
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "https://edusms.edusphere.co.tz",
        "http://edusms.edusphere.co.tz",
        "https://edusphere.co.tz",
    ],
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "accept",
    "authorization",
    "content-type",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-api-key",
    "x-gateway-token",
    "idempotency-key",
]

CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "https://edusms.edusphere.co.tz",
        "http://edusms.edusphere.co.tz",
        "https://edusphere.co.tz",
    ],
)

if IS_PRODUCTION:
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "apps.developers.authentication.ScopedAPIKeyAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.edusms_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "300/min",
        "auth_login": "10/min",
        "pairing": "12/min",
        "gateway": "240/min",
        "webhook_test": "15/min",
    },
}

# --- SimpleJWT ---
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", "30"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_LIFETIME_DAYS", "14"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- OpenAPI / drf-spectacular ---
SPECTACULAR_SETTINGS = {
    "TITLE": "EduSMS Programmable SMS Gateway & Intelligent Automation API",
    "DESCRIPTION": (
        "Production-oriented REST API for EduSMS (`/api/v1/`). Supports physical Android SIM gateways, "
        "strictly isolated Simulation Mode, consent-aware contact & group policies, deterministic keyword/regex "
        "and safe AI auto-replies, throttled bulk SMS campaigns, scoped API keys, and HMAC-SHA256 webhooks."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

# --- Domain Settings ---
PAIRING_CODE_TTL_MINUTES = int(os.getenv("PAIRING_CODE_TTL_MINUTES", "10"))
GATEWAY_ONLINE_THRESHOLD_SECONDS = int(os.getenv("GATEWAY_ONLINE_THRESHOLD_SECONDS", "90"))
DEFAULT_MESSAGE_RETENTION_DAYS = int(os.getenv("DEFAULT_MESSAGE_RETENTION_DAYS", "90"))
WEBHOOK_REQUIRE_HTTPS = env_bool("WEBHOOK_REQUIRE_HTTPS", default=IS_PRODUCTION)
WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = int(os.getenv("WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", "300"))
ALLOW_PRIVATE_AI_BASE_URLS = env_bool("ALLOW_PRIVATE_AI_BASE_URLS", default=False)
MAX_CAMPAIGN_RECIPIENTS_PER_RUN = int(os.getenv("MAX_CAMPAIGN_RECIPIENTS_PER_RUN", "5000"))
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "mail.edusphere.co.tz")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=True)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", default=False)
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "support@edusms.edusphere.co.tz")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "EduSMS <support@edusms.edusphere.co.tz>")
SUPPORT_ADMIN_EMAIL = os.getenv("SUPPORT_ADMIN_EMAIL", "support@edusms.edusphere.co.tz")
CPANEL_HOST = os.getenv("CPANEL_HOST", "https://edusphere.co.tz:2083")
CPANEL_USERNAME = os.getenv("CPANEL_USERNAME", "")
CPANEL_API_TOKEN = os.getenv("CPANEL_API_TOKEN", "")
CPANEL_PRIMARY_DOMAIN = os.getenv("CPANEL_PRIMARY_DOMAIN", "edusphere.co.tz")
CPANEL_SUBDOMAIN = os.getenv("CPANEL_SUBDOMAIN", "edusms.edusphere.co.tz")
GITHUB_REPO_URL = os.getenv("GITHUB_REPO_URL", "https://github.com/Hemedi18/edusms.git")
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")
PUBLIC_WEB_URL = os.getenv("PUBLIC_WEB_URL", "https://edusms.edusphere.co.tz" if IS_PRODUCTION else "http://localhost:5173")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://edusms.edusphere.co.tz" if IS_PRODUCTION else "http://localhost:8000")


# --- Secret Redaction in Logs ---
class SecretRedactingFilter(logging.Filter):
    _PATTERNS = [
        re.compile(r"(edusms_(?:live|sim)_[A-Za-z0-9_\-]+)"),
        re.compile(r"(edugw_[A-Za-z0-9_\-]+)"),
        re.compile(r"(sk-[A-Za-z0-9_\-]{12,})"),
        re.compile(r"(whsec_[A-Za-z0-9_\-]+)"),
        re.compile(r'("?(?:password|api_key|secret|signing_secret|refresh)"?\s*[:=]\s*"?)([^",\s\}]+)', re.IGNORECASE),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        redacted = msg
        for idx, pat in enumerate(self._PATTERNS):
            if idx == len(self._PATTERNS) - 1:
                redacted = pat.sub(r"\1[REDACTED]", redacted)
            else:
                redacted = pat.sub("[REDACTED_SECRET]", redacted)
        if redacted != msg:
            record.msg = redacted
            record.args = ()
        return True


LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "redact_secrets": {
            "()": SecretRedactingFilter,
        },
    },
    "formatters": {
        "standard": {
            "format": "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "filters": ["redact_secrets"],
            "formatter": "standard",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
}
