#!/usr/bin/env python3
"""
cPanel Email Forwarder Pipe Script for EduSMS (`support@edusms.edusphere.co.tz`).

In cPanel -> Email -> Forwarders -> Add Forwarder:
- Address to Forward: support@edusms.edusphere.co.tz
- Advanced Options -> Pipe to a Program:
  public_html/edusms/scripts/cpanel_email_pipe.py

When you reply directly from your email client to a customer's first-message live chat notification,
this script parses the raw RFC822 email from STDIN, extracts the reply token and text body,
and delivers your reply directly into the customer's Live Chat window in real time!
"""
from __future__ import annotations

import email
from email.policy import default as default_policy
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "edusms.settings")

import django  # noqa: E402

django.setup()

from apps.core.support_service import process_inbound_email_reply  # noqa: E402


def main() -> int:
    raw_bytes = sys.stdin.buffer.read()
    if not raw_bytes:
        return 0
    msg = email.message_from_bytes(raw_bytes, policy=default_policy)
    subject = str(msg.get("Subject", ""))
    from_email = str(msg.get("From", ""))

    body_text = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                body_text = part.get_content()
                break
    else:
        body_text = msg.get_content()

    process_inbound_email_reply(
        subject=subject,
        from_email=from_email,
        body=str(body_text or ""),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
