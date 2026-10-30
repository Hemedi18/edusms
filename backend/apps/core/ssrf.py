"""
Server-Side Request Forgery (SSRF) protection for outbound HTTP requests
(Webhook deliveries and custom AI provider endpoints).
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class SSRFBlockedError(ValueError):
    """Raised when an outbound URL points to a prohibited scheme, host, or IP range."""


PROHIBITED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata",
    "169.254.169.254",
    "instance-data",
}


def is_ip_prohibited(ip_str: str) -> bool:
    addr = ipaddress.ip_address(ip_str)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return bool(
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def validate_outbound_url(
    url: str,
    *,
    require_https: bool = True,
    allow_private: bool = False,
    resolve_dns: bool = True,
) -> str:
    if not url or not isinstance(url, str):
        raise SSRFBlockedError("Outbound URL is required.")

    parsed = urlparse(url.strip())
    allowed_schemes = {"https"} if require_https else {"https", "http"}
    if parsed.scheme.lower() not in allowed_schemes:
        scheme_msg = "HTTPS is required" if require_https else "Only HTTP/HTTPS schemes are permitted"
        raise SSRFBlockedError(f"Invalid URL scheme '{parsed.scheme}'. {scheme_msg}.")

    if parsed.username or parsed.password:
        raise SSRFBlockedError("Embedded URL credentials are not permitted.")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise SSRFBlockedError("URL must include a valid hostname.")

    if not allow_private:
        if hostname in PROHIBITED_HOSTNAMES or hostname.endswith(".local") or hostname.endswith(".internal"):
            raise SSRFBlockedError(f"Destination host '{hostname}' is prohibited by SSRF policy.")

        # Direct literal IP check first
        try:
            if is_ip_prohibited(hostname):
                raise SSRFBlockedError(f"Destination IP '{hostname}' is in a prohibited private/loopback/metadata range.")
            return url.strip()
        except ValueError as exc:
            if isinstance(exc, SSRFBlockedError):
                raise
            # Hostname is a domain name; proceed to DNS check

        if resolve_dns:
            port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
            try:
                infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
            except socket.gaierror as exc:
                raise SSRFBlockedError(f"Unable to resolve destination hostname '{hostname}'.") from exc

            if not infos:
                raise SSRFBlockedError(f"Destination hostname '{hostname}' resolved to no addresses.")

            for info in infos:
                resolved_ip = info[4][0]
                if is_ip_prohibited(resolved_ip):
                    raise SSRFBlockedError(
                        f"Hostname '{hostname}' resolved to prohibited IP '{resolved_ip}' (private, loopback, or metadata)."
                    )

    return url.strip()
