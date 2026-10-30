from __future__ import annotations

import hashlib
import hmac
from django.conf import settings
from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import generics, serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .crypto import mask_secret
from .models import AuditEvent, ErrorReport, Notification, ServerHostingConfig, SupportMessage, SupportThread
from .ops_service import (
    execute_github_sync,
    get_git_repository_status,
    provision_cpanel_subdomain_and_email,
    summarize_cpanel_account,
)
from .support_service import (
    _send_platform_email,
    extract_customer_context,
    get_or_create_hosting_config,
    process_inbound_email_reply,
    record_error_and_notify,
    send_support_chat_message,
)


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id",
            "category",
            "level",
            "title",
            "body",
            "action_url",
            "metadata",
            "is_read",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = [
            "id",
            "actor_type",
            "actor_identifier",
            "event_type",
            "target_type",
            "target_id",
            "ip_address",
            "summary",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class ErrorReportSerializer(serializers.ModelSerializer):
    short_id = serializers.SerializerMethodField()

    class Meta:
        model = ErrorReport
        fields = [
            "id",
            "short_id",
            "user",
            "user_email",
            "user_name",
            "source",
            "severity",
            "status",
            "title",
            "message",
            "stack_trace",
            "page_url",
            "component_name",
            "screenshot_data_url",
            "user_session_info",
            "admin_email_sent",
            "auto_reply_email_sent",
            "admin_response",
            "resolved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "short_id",
            "user",
            "user_session_info",
            "admin_email_sent",
            "auto_reply_email_sent",
            "resolved_at",
            "created_at",
            "updated_at",
        ]

    def get_short_id(self, obj: ErrorReport) -> str:
        return str(obj.id)[:8].upper()


class SupportMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportMessage
        fields = [
            "id",
            "thread",
            "sender_type",
            "sender_label",
            "via_channel",
            "body",
            "screenshot_data_url",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class SupportThreadSerializer(serializers.ModelSerializer):
    messages = SupportMessageSerializer(many=True, read_only=True)
    short_id = serializers.SerializerMethodField()

    class Meta:
        model = SupportThread
        fields = [
            "id",
            "short_id",
            "user",
            "user_email",
            "user_name",
            "subject",
            "mode",
            "status",
            "reply_token",
            "first_email_notified",
            "customer_context",
            "unread_for_admin",
            "unread_for_user",
            "last_message_at",
            "created_at",
            "messages",
        ]
        read_only_fields = [
            "id",
            "short_id",
            "user",
            "reply_token",
            "first_email_notified",
            "customer_context",
            "unread_for_admin",
            "unread_for_user",
            "last_message_at",
            "created_at",
            "messages",
        ]

    def get_short_id(self, obj: SupportThread) -> str:
        return str(obj.id)[:8].upper()


class ServerHostingConfigSerializer(serializers.ModelSerializer):
    cpanel_api_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    masked_cpanel_api_token = serializers.SerializerMethodField()
    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    masked_smtp_password = serializers.SerializerMethodField()
    github_pat = serializers.CharField(write_only=True, required=False, allow_blank=True)
    masked_github_pat = serializers.SerializerMethodField()

    class Meta:
        model = ServerHostingConfig
        fields = [
            "id",
            "primary_domain",
            "subdomain",
            "cpanel_host",
            "cpanel_username",
            "cpanel_api_token",
            "masked_cpanel_api_token",
            "document_root",
            "support_email",
            "admin_alert_email",
            "smtp_host",
            "smtp_port",
            "smtp_use_tls",
            "smtp_username",
            "smtp_password",
            "masked_smtp_password",
            "github_repo_url",
            "github_branch",
            "github_pat",
            "masked_github_pat",
            "auto_sync_enabled",
            "last_cpanel_summary",
            "last_git_sync_at",
            "last_git_sync_status",
            "last_git_sync_output",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "masked_cpanel_api_token",
            "masked_smtp_password",
            "masked_github_pat",
            "last_cpanel_summary",
            "last_git_sync_at",
            "last_git_sync_status",
            "last_git_sync_output",
            "updated_at",
        ]

    def get_masked_cpanel_api_token(self, obj: ServerHostingConfig) -> str:
        raw = obj.get_cpanel_api_token()
        return mask_secret(raw) if raw else ""

    def get_masked_smtp_password(self, obj: ServerHostingConfig) -> str:
        raw = obj.get_smtp_password()
        return mask_secret(raw) if raw else ""

    def get_masked_github_pat(self, obj: ServerHostingConfig) -> str:
        raw = obj.get_github_pat()
        return mask_secret(raw) if raw else ""

    def update(self, instance: ServerHostingConfig, validated_data: dict):
        cpanel_tok = validated_data.pop("cpanel_api_token", None)
        smtp_pass = validated_data.pop("smtp_password", None)
        gh_pat = validated_data.pop("github_pat", None)

        for k, v in validated_data.items():
            setattr(instance, k, v)
        if cpanel_tok is not None and cpanel_tok != "":
            instance.set_cpanel_api_token(cpanel_tok)
        if smtp_pass is not None and smtp_pass != "":
            instance.set_smtp_password(smtp_pass)
        if gh_pat is not None and gh_pat != "":
            instance.set_github_pat(gh_pat)
        instance.save()
        return instance


class NotificationListView(generics.ListAPIView):
    queryset = Notification.objects.none()
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["is_read", "category", "level"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        return Notification.objects.filter(user=self.request.user)


class NotificationMarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: NotificationSerializer}, summary="Mark notification read")
    def post(self, request, pk):
        notif = generics.get_object_or_404(Notification, pk=pk, user=request.user)
        if not notif.is_read:
            notif.is_read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=["is_read", "read_at", "updated_at"])
        return Response(NotificationSerializer(notif).data)


class NotificationMarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: OpenApiTypes.OBJECT}, summary="Mark all notifications read")
    def post(self, request):
        updated = Notification.objects.filter(user=request.user, is_read=False).update(
            is_read=True,
            read_at=timezone.now(),
        )
        return Response({"marked_read_count": updated}, status=status.HTTP_200_OK)


class AuditEventListView(generics.ListAPIView):
    queryset = AuditEvent.objects.none()
    serializer_class = AuditEventSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["event_type", "actor_type", "target_type"]
    search_fields = ["summary", "event_type", "actor_identifier"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AuditEvent.objects.none()
        return AuditEvent.objects.filter(user=self.request.user)


# --- Automatic & Manual Error Reporting Views ---


class ErrorReportListCreateView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses={200: ErrorReportSerializer(many=True)}, summary="List recorded errors")
    def get(self, request):
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Authentication required to list errors."}, status=status.HTTP_401_UNAUTHORIZED)
        qs = ErrorReport.objects.all()[:100]
        return Response(ErrorReportSerializer(qs, many=True).data)

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={201: ErrorReportSerializer},
        summary="Record automatic runtime error or manual user error report and send immediate emails",
    )
    def post(self, request):
        data = request.data or {}
        title = (data.get("title") or "Client Application Error").strip()
        message = (data.get("message") or data.get("detail") or title).strip()
        source = data.get("source") or ErrorReport.Source.WEB_AUTO
        severity = data.get("severity") or (
            ErrorReport.Severity.MANUAL if "manual" in source else ErrorReport.Severity.ERROR
        )
        report = record_error_and_notify(
            user=request.user if (request.user and request.user.is_authenticated) else None,
            request=request,
            source=source,
            severity=severity,
            title=title,
            message=message,
            stack_trace=data.get("stack_trace") or "",
            page_url=data.get("page_url") or "",
            component_name=data.get("component_name") or "",
            screenshot_data_url=data.get("screenshot_data_url") or "",
            user_email=data.get("user_email") or "",
            user_name=data.get("user_name") or "",
            extra_context=data.get("extra_context") if isinstance(data.get("extra_context"), dict) else {},
        )
        return Response(ErrorReportSerializer(report).data, status=status.HTTP_201_CREATED)


class ErrorReportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: ErrorReportSerializer}, summary="Update or resolve error report")
    def patch(self, request, pk):
        report = generics.get_object_or_404(ErrorReport, pk=pk)
        new_status = request.data.get("status")
        admin_response = request.data.get("admin_response")

        if new_status in dict(ErrorReport.Status.choices):
            report.status = new_status
            if new_status == ErrorReport.Status.RESOLVED:
                report.resolved_at = timezone.now()
        if admin_response is not None:
            report.admin_response = str(admin_response).strip()
            if report.user_email and report.admin_response:
                cfg = get_or_create_hosting_config()
                short_id = str(report.id)[:8].upper()
                _send_platform_email(
                    subject=f"Update on your EduSMS Error Report [#{short_id}]",
                    body_text=(
                        f"Hello {report.user_name or 'there'},\n\n"
                        f"Our team has updated your error report (#{short_id} — {report.title}):\n"
                        f"Status: {report.get_status_display()}\n\n"
                        f"Response from Engineering:\n\"{report.admin_response}\"\n\n"
                        f"— EduSMS Support ({cfg.subdomain})"
                    ),
                    to_emails=[report.user_email],
                    reply_to=[cfg.support_email],
                )
        report.save()
        return Response(ErrorReportSerializer(report).data)


# --- Instant Help, AI Help & Live Support Chat Views ---


class SupportThreadListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: SupportThreadSerializer(many=True)}, summary="List customer live support chat threads")
    def get(self, request):
        threads = SupportThread.objects.prefetch_related("messages").all()[:50]
        return Response(SupportThreadSerializer(threads, many=True).data)


class ActiveSupportThreadView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={200: SupportThreadSerializer},
        summary="Get or initialize active Instant Help & Live Support thread with customer session telemetry",
    )
    def post(self, request):
        data = request.data or {}
        auth_user = request.user if (request.user and request.user.is_authenticated) else None
        thread_id = data.get("thread_id")
        page_url = data.get("page_url") or ""

        thread = None
        if thread_id:
            thread = SupportThread.objects.filter(id=thread_id).first()
        if not thread and auth_user:
            thread = (
                SupportThread.objects.filter(user=auth_user)
                .exclude(status=SupportThread.Status.RESOLVED)
                .order_by("-last_message_at")
                .first()
            )

        context = extract_customer_context(
            user=auth_user,
            request=request,
            extra_context={
                "page_url": page_url,
                "user_email": data.get("user_email") or "",
                "user_name": data.get("user_name") or "",
                "browser_info": data.get("browser_info") or "",
            },
        )

        if not thread:
            thread = SupportThread.objects.create(
                user=auth_user,
                user_email=context.get("email") if context.get("email") != "guest@anonymous" else "",
                user_name=context.get("full_name", "Visitor"),
                subject=data.get("subject") or "Instant Help & Live Support",
                mode=data.get("mode") or SupportThread.Mode.LIVE_HUMAN,
                customer_context=context,
            )
            SupportMessage.objects.create(
                thread=thread,
                sender_type=SupportMessage.SenderType.AI,
                sender_label="EduSMS Instant Help",
                via_channel=SupportMessage.ViaChannel.AI_HELPER,
                body=(
                    f"Welcome {context.get('full_name', 'there')}! 👋\n"
                    "• Send a message here to chat directly with **Live Support** (your first message is emailed straight to the owner, and their reply appears right here in real time).\n"
                    "• Switch to **AI Help** anytime for instant answers, or click **Take Screenshot** below to capture and attach your current screen!"
                ),
            )
        else:
            thread.customer_context = context
            if auth_user and not thread.user_id:
                thread.user = auth_user
            thread.unread_for_user = 0
            thread.save(update_fields=["customer_context", "user", "unread_for_user", "updated_at"])

        return Response(SupportThreadSerializer(thread).data)


class SupportThreadDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: SupportThreadSerializer}, summary="Retrieve live chat thread and customer context")
    def get(self, request, pk):
        thread = generics.get_object_or_404(SupportThread.objects.prefetch_related("messages"), pk=pk)
        if thread.user_id:
            thread.customer_context = extract_customer_context(user=thread.user, extra_context=thread.customer_context)
        thread.unread_for_admin = 0
        thread.save(update_fields=["customer_context", "unread_for_admin", "updated_at"])
        return Response(SupportThreadSerializer(thread).data)

    @extend_schema(request=OpenApiTypes.OBJECT, responses={200: SupportThreadSerializer}, summary="Update thread mode or status")
    def patch(self, request, pk):
        thread = generics.get_object_or_404(SupportThread, pk=pk)
        mode = request.data.get("mode")
        status_val = request.data.get("status")
        if mode in dict(SupportThread.Mode.choices):
            thread.mode = mode
        if status_val in dict(SupportThread.Status.choices):
            thread.status = status_val
        thread.save()
        return Response(SupportThreadSerializer(thread).data)


class SupportThreadSendMessageView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={201: SupportThreadSerializer},
        summary="Send customer or admin live chat message (with optional screenshot attachment)",
    )
    def post(self, request, pk):
        thread = generics.get_object_or_404(SupportThread, pk=pk)
        data = request.data or {}
        body = (data.get("body") or "").strip()
        screenshot_data_url = data.get("screenshot_data_url") or ""
        if not body and screenshot_data_url:
            body = "[Attached Screen Capture]"
        if not body:
            return Response({"detail": "Message body or screenshot is required."}, status=status.HTTP_400_BAD_REQUEST)

        requested_mode = data.get("mode")
        if requested_mode in dict(SupportThread.Mode.choices) and thread.mode != requested_mode:
            thread.mode = requested_mode
            thread.save(update_fields=["mode", "updated_at"])

        sender_type = data.get("sender_type") or SupportMessage.SenderType.USER
        if sender_type not in {SupportMessage.SenderType.USER, SupportMessage.SenderType.ADMIN}:
            sender_type = SupportMessage.SenderType.USER

        via_channel = (
            SupportMessage.ViaChannel.ADMIN_CONSOLE
            if sender_type == SupportMessage.SenderType.ADMIN
            else (data.get("via_channel") or SupportMessage.ViaChannel.WEB_CHAT)
        )

        send_support_chat_message(
            thread=thread,
            sender_type=sender_type,
            body=body,
            screenshot_data_url=screenshot_data_url,
            via_channel=via_channel,
            user=request.user if (request.user and request.user.is_authenticated) else None,
            request=request,
            extra_context={
                "page_url": data.get("page_url") or "",
                "user_email": data.get("user_email") or "",
                "user_name": data.get("user_name") or "",
            },
        )
        thread.refresh_from_db()
        return Response(SupportThreadSerializer(thread).data, status=status.HTTP_201_CREATED)


class SupportInboundEmailReplyWebhookView(APIView):
    """
    Allows the platform owner to reply directly from their email client to a customer's first-message email
    notification and have that reply appear automatically in the customer's Live Chat window.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiTypes.OBJECT},
        summary="Bridge inbound email reply from admin directly into customer Live Chat",
    )
    def post(self, request):
        data = request.data or {}
        msg = process_inbound_email_reply(
            subject=data.get("subject") or data.get("Subject") or "",
            from_email=data.get("from_email") or data.get("from") or data.get("From") or "",
            body=data.get("body") or data.get("text") or data.get("stripped-text") or "",
            reply_token=data.get("reply_token") or "",
            thread_id=data.get("thread_id") or "",
        )
        if not msg:
            return Response(
                {"status": "ignored", "detail": "No matching support thread or empty reply body."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {
                "status": "delivered_to_live_chat",
                "thread_id": str(msg.thread_id),
                "message": SupportMessageSerializer(msg).data,
            },
            status=status.HTTP_200_OK,
        )


# --- Server Operations, cPanel (`edusms.edusphere.co.tz`) & GitHub Auto-Sync Views ---


class ServerOpsStatusView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: OpenApiTypes.OBJECT},
        summary="Get cPanel hosting summary, email config, and GitHub sync status",
    )
    def get(self, request):
        cfg = get_or_create_hosting_config()
        return Response(
            {
                "config": ServerHostingConfigSerializer(cfg).data,
                "cpanel_summary": summarize_cpanel_account(),
                "git_status": get_git_repository_status(),
            }
        )

    @extend_schema(
        request=ServerHostingConfigSerializer,
        responses={200: ServerHostingConfigSerializer},
        summary="Update cPanel, Support Email SMTP, and GitHub sync settings",
    )
    def patch(self, request):
        cfg = get_or_create_hosting_config()
        serializer = ServerHostingConfigSerializer(cfg, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ServerOpsCpanelProvisionView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiTypes.OBJECT},
        summary="Provision edusms.edusphere.co.tz subdomain, support email, and AutoSSL via cPanel UAPI",
    )
    def post(self, request):
        data = request.data or {}
        result = provision_cpanel_subdomain_and_email(
            cpanel_host=data.get("cpanel_host"),
            cpanel_username=data.get("cpanel_username"),
            cpanel_api_token=data.get("cpanel_api_token"),
            subdomain_prefix=data.get("subdomain_prefix") or "edusms",
            root_domain=data.get("root_domain") or "edusphere.co.tz",
            support_email_user=data.get("support_email_user") or "support",
            support_email_password=data.get("support_email_password") or "",
            admin_alert_email=data.get("admin_alert_email") or "",
        )
        return Response(result, status=status.HTTP_200_OK)


class ServerOpsGitSyncView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiTypes.OBJECT},
        summary="Synchronize project code with GitHub (https://github.com/Hemedi18/edusms.git)",
    )
    def post(self, request):
        data = request.data or {}
        action = data.get("action") or "pull"
        branch = data.get("branch") or "main"
        if data.get("github_pat"):
            cfg = get_or_create_hosting_config()
            cfg.set_github_pat(str(data["github_pat"]).strip())
            cfg.save(update_fields=["encrypted_github_pat", "updated_at"])
        res = execute_github_sync(action=action, branch=branch)
        return Response(res, status=status.HTTP_200_OK)


class GitHubPushWebhookView(APIView):
    """
    Receives GitHub push webhooks for `https://github.com/Hemedi18/edusms.git` and automatically
    synchronizes the project when `auto_sync_enabled` is True.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        request=OpenApiTypes.OBJECT,
        responses={200: OpenApiTypes.OBJECT},
        summary="GitHub push webhook for automatic server code synchronization",
    )
    def post(self, request):
        secret = getattr(settings, "GITHUB_WEBHOOK_SECRET", "")
        if secret:
            sig_header = request.META.get("HTTP_X_HUB_SIGNATURE_256", "")
            expected = "sha256=" + hmac.new(secret.encode("utf-8"), request.body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig_header, expected):
                return Response({"detail": "Invalid GitHub webhook signature."}, status=status.HTTP_403_FORBIDDEN)

        cfg = get_or_create_hosting_config()
        if not cfg.auto_sync_enabled:
            return Response({"status": "skipped", "reason": "auto_sync_enabled is False"}, status=status.HTTP_200_OK)

        res = execute_github_sync(action="pull", branch=cfg.github_branch or "main")
        return Response({"status": "auto_synced", **res}, status=status.HTTP_200_OK)
