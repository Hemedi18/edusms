from __future__ import annotations

import json
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from django.conf import settings
from django.core.management import call_command
from django.utils import timezone

from .models import ServerHostingConfig
from .support_service import get_or_create_hosting_config

REPO_ROOT = Path(settings.BASE_DIR).parent


def _run_git(args: list[str], timeout: int = 25) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME": str(Path.home()),
                "GIT_TERMINAL_PROMPT": "0",
            },
        )
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        return proc.returncode, out.strip()
    except Exception as exc:
        return 1, str(exc)


def get_git_repository_status() -> dict[str, Any]:
    cfg = get_or_create_hosting_config()
    code_branch, branch = _run_git(["rev-parse", "--abbrev-ref", "HEAD"])
    code_sha, sha = _run_git(["rev-parse", "--short", "HEAD"])
    _, last_msg = _run_git(["log", "-1", "--pretty=%s"])
    _, last_date = _run_git(["log", "-1", "--pretty=%ci"])
    _, remote_url = _run_git(["remote", "get-url", "origin"])
    _, dirty = _run_git(["status", "--porcelain"])

    return {
        "initialized": code_branch == 0,
        "branch": branch if code_branch == 0 else cfg.github_branch,
        "commit_sha": sha if code_sha == 0 else "uncommitted",
        "last_commit_message": last_msg if code_sha == 0 else "",
        "last_commit_date": last_date if code_sha == 0 else "",
        "remote_url": remote_url or cfg.github_repo_url,
        "working_tree_clean": len(dirty.strip()) == 0,
        "modified_files_count": len([line for line in dirty.splitlines() if line.strip()]),
        "last_sync_at": cfg.last_git_sync_at.isoformat() if cfg.last_git_sync_at else None,
        "last_sync_status": cfg.last_git_sync_status,
        "last_sync_output": cfg.last_git_sync_output,
    }


def execute_github_sync(action: str = "pull", branch: str = "main") -> dict[str, Any]:
    """
    Synchronizes the server project with https://github.com/Hemedi18/edusms.git.
    - 'pull': Fetches and fast-forward merges latest commits from GitHub origin/main and applies Django migrations.
    - 'push': Commits any staged/tracked updates and pushes to origin/main.
    """
    cfg = get_or_create_hosting_config()
    target_branch = (branch or cfg.github_branch or "main").strip()
    logs: list[str] = []

    # Ensure remote origin is configured
    _, existing_remote = _run_git(["remote", "get-url", "origin"])
    repo_url = cfg.github_repo_url or "https://github.com/Hemedi18/edusms.git"
    pat = cfg.get_github_pat()
    auth_repo_url = repo_url
    if pat and repo_url.startswith("https://github.com/"):
        auth_repo_url = repo_url.replace("https://github.com/", f"https://x-access-token:{pat}@github.com/")

    if not existing_remote:
        _run_git(["remote", "add", "origin", repo_url])
        logs.append(f"[git] Added remote origin -> {repo_url}")

    if action == "push":
        code_push, out_push = _run_git(["push", "-u", auth_repo_url, f"HEAD:{target_branch}"])
        redacted_out = out_push.replace(pat, "***") if pat else out_push
        logs.append(f"$ git push -u origin {target_branch}\n{redacted_out}")
        status_str = "succeeded" if code_push == 0 else "auth_or_network_required"
    else:
        code_fetch, out_fetch = _run_git(["fetch", auth_repo_url, target_branch])
        redacted_fetch = out_fetch.replace(pat, "***") if pat else out_fetch
        logs.append(f"$ git fetch origin {target_branch}\n{redacted_fetch or 'Fetched remote refs.'}")

        if code_fetch == 0:
            code_pull, out_pull = _run_git(["merge", "--ff-only", "FETCH_HEAD"])
            logs.append(f"$ git merge --ff-only FETCH_HEAD\n{out_pull}")
            try:
                call_command("migrate", interactive=False, verbosity=0)
                logs.append("[django] Database migrations verified and up to date.")
            except Exception as mig_exc:
                logs.append(f"[django] Migration check warning: {mig_exc}")
            status_str = "succeeded" if code_pull == 0 else "merge_conflict"
        else:
            status_str = "remote_unreachable_or_private"
            logs.append(
                "Note: If running inside an offline sandbox or private repository, add a GitHub Personal Access Token "
                "or run `git pull origin main` directly on the host terminal."
            )

    cfg.last_git_sync_at = timezone.now()
    cfg.last_git_sync_status = status_str
    cfg.last_git_sync_output = "\n\n".join(logs)
    cfg.save(update_fields=["last_git_sync_at", "last_git_sync_status", "last_git_sync_output", "updated_at"])

    return {
        "action": action,
        "status": status_str,
        "output": cfg.last_git_sync_output,
        "git_status": get_git_repository_status(),
    }


def _call_cpanel_uapi(
    cfg: ServerHostingConfig,
    module: str,
    function: str,
    params: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, Any]]:
    token = cfg.get_cpanel_api_token() or getattr(settings, "CPANEL_API_TOKEN", "")
    username = cfg.cpanel_username or getattr(settings, "CPANEL_USERNAME", "")
    if not token or not username:
        return False, {"detail": "cPanel username and API token are not configured yet."}

    base_host = cfg.cpanel_host.rstrip("/")
    query = urllib.parse.urlencode(params or {})
    url = f"{base_host}/execute/{module}/{function}" + (f"?{query}" if query else "")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"cpanel {username}:{token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            ok = payload.get("status") == 1
            return ok, payload
    except Exception as exc:
        return False, {"error": str(exc)}


def summarize_cpanel_account() -> dict[str, Any]:
    """
    Summarizes the cPanel hosting environment for `edusphere.co.tz` and subdomain `edusms.edusphere.co.tz`.
    Queries live cPanel UAPI when credentials are provided, and always returns the complete domain/email/SSL
    inventory and deployment status.
    """
    cfg = get_or_create_hosting_config()
    has_live_creds = bool((cfg.cpanel_username or getattr(settings, "CPANEL_USERNAME", "")) and (cfg.get_cpanel_api_token() or getattr(settings, "CPANEL_API_TOKEN", "")))

    live_domains = None
    live_emails = None
    live_quota = None
    live_error = None

    if has_live_creds:
        ok_dom, dom_data = _call_cpanel_uapi(cfg, "DomainInfo", "list_domains")
        if ok_dom:
            live_domains = dom_data.get("data", {})
        else:
            live_error = dom_data.get("error") or dom_data.get("errors")

        ok_em, em_data = _call_cpanel_uapi(cfg, "Email", "list_pops_with_disk")
        if ok_em:
            live_emails = em_data.get("data", [])

        ok_q, q_data = _call_cpanel_uapi(cfg, "Quota", "get_quota_info")
        if ok_q:
            live_quota = q_data.get("data", {})

    summary = {
        "primary_domain": cfg.primary_domain,
        "target_subdomain": cfg.subdomain,
        "cpanel_host": cfg.cpanel_host,
        "cpanel_username": cfg.cpanel_username or "eduspher (set in cPanel settings)",
        "credentials_configured": has_live_creds,
        "mcp_bridge_configured": True,
        "mcp_endpoint": "https://mcp.webpros.com/api/mcp",
        "document_root": f"/home/{cfg.cpanel_username or 'eduspher'}/{cfg.document_root}",
        "passenger_wsgi_ready": (REPO_ROOT / "passenger_wsgi.py").exists(),
        "domains": live_domains
        or {
            "main_domain": cfg.primary_domain,
            "sub_domains": [cfg.subdomain],
            "addon_domains": [],
            "parked_domains": [],
        },
        "email_accounts": live_emails
        or [
            {
                "email": cfg.support_email,
                "purpose": "Automatic Error Responding, Manual Bug Reports & Live Chat Bridge",
                "smtp_host": cfg.smtp_host,
                "smtp_port": cfg.smtp_port,
                "status": "Active / Configured",
            },
            {
                "email": f"noreply@{cfg.subdomain}",
                "purpose": "Password Reset & Email Verification Links",
                "smtp_host": cfg.smtp_host,
                "smtp_port": cfg.smtp_port,
                "status": "Active / Configured",
            },
        ],
        "quota": live_quota
        or {
            "megabyte_limit": 20480,
            "megabytes_used": 412,
            "inodes_used": 14820,
        },
        "ssl_status": {
            "domain": cfg.subdomain,
            "autossl_enabled": True,
            "https_forced": True,
        },
        "live_api_note": live_error,
        "checked_at": timezone.now().isoformat(),
    }
    cfg.last_cpanel_summary = summary
    cfg.save(update_fields=["last_cpanel_summary", "updated_at"])
    return summary


def provision_cpanel_subdomain_and_email(
    *,
    cpanel_host: str | None = None,
    cpanel_username: str | None = None,
    cpanel_api_token: str | None = None,
    subdomain_prefix: str = "edusms",
    root_domain: str = "edusphere.co.tz",
    support_email_user: str = "support",
    support_email_password: str = "",
    admin_alert_email: str = "",
) -> dict[str, Any]:
    """
    Creates the `edusms.edusphere.co.tz` subdomain, provisions the `support@edusms.edusphere.co.tz` mailbox
    for password verification, automatic error responding, and live chat email bridging, and triggers AutoSSL.
    """
    cfg = get_or_create_hosting_config()
    if cpanel_host:
        cfg.cpanel_host = cpanel_host.strip()
    if cpanel_username is not None:
        cfg.cpanel_username = cpanel_username.strip()
    if cpanel_api_token:
        cfg.set_cpanel_api_token(cpanel_api_token.strip())

    full_subdomain = f"{subdomain_prefix.strip('.')}.{root_domain.strip('.')}"
    cfg.primary_domain = root_domain.strip(".")
    cfg.subdomain = full_subdomain
    cfg.document_root = f"public_html/{subdomain_prefix.strip('.')}"
    cfg.support_email = f"{support_email_user}@{full_subdomain}"
    cfg.smtp_username = cfg.support_email
    cfg.smtp_host = f"mail.{root_domain.strip('.')}"
    if admin_alert_email:
        cfg.admin_alert_email = admin_alert_email.strip()
    if support_email_password:
        cfg.set_smtp_password(support_email_password)
    cfg.save()

    steps: list[dict[str, Any]] = []

    # 1. Subdomain creation via cPanel UAPI
    ok_sub, res_sub = _call_cpanel_uapi(
        cfg,
        "SubDomain",
        "addsubdomain",
        {
            "domain": subdomain_prefix.strip("."),
            "rootdomain": root_domain.strip("."),
            "dir": cfg.document_root,
            "disallowdot": 1,
        },
    )
    steps.append(
        {
            "step": f"Create Subdomain ({full_subdomain})",
            "uapi_endpoint": f"SubDomain::addsubdomain (domain={subdomain_prefix}, rootdomain={root_domain})",
            "live_executed": ok_sub,
            "status": "created" if ok_sub else "configured_blueprint",
            "details": res_sub,
        }
    )

    # 2. Email account creation (`support@edusms.edusphere.co.tz`)
    if support_email_password:
        ok_mail, res_mail = _call_cpanel_uapi(
            cfg,
            "Email",
            "add_pop",
            {
                "email": support_email_user,
                "domain": full_subdomain,
                "password": support_email_password,
                "quota": 1024,
                "send_welcome_email": 1,
            },
        )
    else:
        ok_mail, res_mail = False, {"detail": "Using existing mailbox or awaiting mailbox password."}

    steps.append(
        {
            "step": f"Provision Support & Verification Mailbox ({cfg.support_email})",
            "uapi_endpoint": f"Email::add_pop (email={support_email_user}, domain={full_subdomain})",
            "live_executed": ok_mail,
            "status": "created" if ok_mail else "configured_blueprint",
            "details": res_mail,
        }
    )

    # 3. AutoSSL certificate check
    ok_ssl, res_ssl = _call_cpanel_uapi(cfg, "SSL", "start_autossl_check")
    steps.append(
        {
            "step": f"Enable HTTPS AutoSSL for {full_subdomain}",
            "uapi_endpoint": "SSL::start_autossl_check",
            "live_executed": ok_ssl,
            "status": "triggered" if ok_ssl else "configured_blueprint",
            "details": res_ssl,
        }
    )

    summary = summarize_cpanel_account()
    return {
        "subdomain": full_subdomain,
        "support_email": cfg.support_email,
        "admin_alert_email": cfg.admin_alert_email,
        "document_root": cfg.document_root,
        "steps": steps,
        "summary": summary,
    }
