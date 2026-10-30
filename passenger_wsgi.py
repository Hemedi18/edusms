"""
cPanel Phusion Passenger WSGI entrypoint for EduSMS (`edusms.edusphere.co.tz`).
In cPanel -> Setup Python App:
- Application root: /home/<cpanel_user>/public_html/edusms
- Application URL: edusms.edusphere.co.tz
- Application startup file: passenger_wsgi.py
- Application Entry point: application
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "edusms.settings")

from edusms.wsgi import application  # noqa: E402
