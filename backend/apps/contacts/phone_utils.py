"""
International E.164 phone number normalization with first-class support for Tanzania (+255)
and global numbers via Google's `phonenumbers` library.
"""
from __future__ import annotations

import re
import phonenumbers
from django.conf import settings


class InvalidPhoneNumberError(ValueError):
    """Raised when a phone number cannot be normalized into a valid E.164 destination."""


def normalize_phone_number(raw_number: str, default_region: str | None = None) -> str:
    if not raw_number or not isinstance(raw_number, str):
        raise InvalidPhoneNumberError("Phone number is required.")

    region = (default_region or getattr(settings, "DEFAULT_PHONE_REGION", "TZ") or "TZ").upper()
    cleaned = raw_number.strip()
    cleaned = re.sub(r"[\s\-\(\)\.]", "", cleaned)

    # Handle international 00 prefix (e.g. 00255712345678 -> +255712345678)
    if cleaned.startswith("00") and len(cleaned) > 6:
        cleaned = "+" + cleaned[2:]
    # Handle bare country code for TZ without leading + (e.g. 255712345678 -> +255712345678)
    elif region == "TZ" and cleaned.startswith("255") and len(cleaned) == 12 and cleaned.isdigit():
        cleaned = "+" + cleaned

    try:
        parsed = phonenumbers.parse(cleaned, None if cleaned.startswith("+") else region)
    except phonenumbers.NumberParseException as exc:
        raise InvalidPhoneNumberError(f"Could not parse phone number '{raw_number}': {exc}") from exc

    if not phonenumbers.is_possible_number(parsed) or not phonenumbers.is_valid_number(parsed):
        raise InvalidPhoneNumberError(
            f"'{raw_number}' is not a valid telephone number for region {region} or international E.164."
        )

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def is_shortcode_or_alphanumeric_sender(sender: str) -> bool:
    """Detects carrier shortcodes (e.g. 15000, MPESA) to prevent auto-reply loops to automated systems."""
    if not sender:
        return True
    stripped = sender.strip()
    if any(ch.isalpha() for ch in stripped):
        return True
    digits = re.sub(r"\D", "", stripped)
    return len(digits) < 8
