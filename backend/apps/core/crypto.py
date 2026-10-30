"""
Cryptographic helpers for EduSMS:
- HKDF-derived Fernet symmetric encryption at rest for AI provider keys, TOTP secrets, and webhook signing secrets.
- SHA-256 hashing for API keys and gateway device tokens.
- Safe secret masking so full secrets are never serialized or logged.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings


def _get_fernet() -> Fernet:
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"edusms-field-encryption-v1",
        info=b"edusms-at-rest-secret-encryption",
    )
    derived = hkdf.derive(settings.FIELD_ENCRYPTION_KEY.encode("utf-8"))
    key = base64.urlsafe_b64encode(derived)
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    token = _get_fernet().encrypt(plaintext.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        raw = _get_fernet().decrypt(ciphertext.encode("utf-8"))
        return raw.decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt stored secret; encryption key mismatch or corrupted ciphertext.") from exc


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mask_secret(secret_value: str) -> str:
    if not secret_value:
        return ""
    if len(secret_value) <= 8:
        return "••••••••"
    return f"{secret_value[:4]}••••••••{secret_value[-4:]}"


def generate_prefixed_token(prefix: str, byte_length: int = 24) -> str:
    return f"{prefix}_{secrets.token_urlsafe(byte_length)}"


def sign_webhook_payload(secret_value: str, timestamp: int, raw_body: bytes) -> str:
    signed_payload = f"{timestamp}.".encode("utf-8") + raw_body
    digest = hmac.new(secret_value.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def verify_webhook_signature(
    secret_value: str,
    signature_header: str,
    raw_body: bytes,
    now_timestamp: int | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    if not signature_header or not secret_value:
        return False
    parts: dict[str, str] = {}
    for item in signature_header.split(","):
        if "=" in item:
            k, v = item.split("=", 1)
            parts[k.strip()] = v.strip()
    if "t" not in parts or "v1" not in parts:
        return False
    try:
        ts = int(parts["t"])
    except ValueError:
        return False
    if now_timestamp is not None and abs(now_timestamp - ts) > tolerance_seconds:
        return False
    expected = sign_webhook_payload(secret_value, ts, raw_body).split("v1=", 1)[1]
    return hmac.compare_digest(expected, parts["v1"])
