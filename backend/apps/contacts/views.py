from __future__ import annotations

from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.services import record_audit_event
from .models import ConsentRecord, Contact, ContactGroup, GroupMembership, SuppressionRecord
from .phone_utils import InvalidPhoneNumberError, normalize_phone_number
from .services import (
    export_contacts_to_csv,
    import_contacts_from_csv,
    record_opt_in,
    record_opt_out,
    resolve_effective_contact_policy,
)


class ContactGroupSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = ContactGroup
        fields = ["id", "name", "color"]


class ContactSerializer(serializers.ModelSerializer):
    groups = ContactGroupSummarySerializer(many=True, read_only=True)
    group_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
    )

    class Meta:
        model = Contact
        fields = [
            "id",
            "name",
            "phone_number",
            "raw_phone_input",
            "email",
            "is_virtual",
            "allow_outgoing",
            "allow_auto_reply",
            "allow_ai_reply",
            "automation_mode",
            "quiet_hours_start",
            "quiet_hours_end",
            "cooldown_minutes",
            "opt_in_status",
            "opt_in_at",
            "opt_out_status",
            "opt_out_at",
            "tags",
            "notes",
            "groups",
            "group_ids",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "opt_in_at", "opt_out_at", "groups", "created_at", "updated_at"]

    def validate_phone_number(self, value: str) -> str:
        user = self.context["request"].user
        try:
            norm = normalize_phone_number(value, user.default_country_code)
        except InvalidPhoneNumberError as exc:
            raise serializers.ValidationError(str(exc)) from exc

        qs = Contact.objects.filter(user=user, phone_number=norm)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(f"A contact with normalized number {norm} already exists.")
        return norm

    def validate_automation_mode(self, mode):
        if mode and mode.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Selected automation mode does not belong to your account.")
        return mode

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        group_ids = validated_data.pop("group_ids", None)
        raw_input = self.initial_data.get("phone_number", "")
        validated_data["raw_phone_input"] = str(raw_input)[:40]
        if validated_data.get("opt_in_status"):
            validated_data["opt_in_at"] = timezone.now()
        if validated_data.get("opt_out_status"):
            validated_data["opt_out_at"] = timezone.now()

        contact = Contact.objects.create(user=user, **validated_data)
        if group_ids:
            valid_groups = ContactGroup.objects.filter(user=user, id__in=group_ids)
            for g in valid_groups:
                GroupMembership.objects.get_or_create(contact=contact, group=g)
        if contact.opt_out_status:
            SuppressionRecord.objects.update_or_create(
                user=user,
                phone_number=contact.phone_number,
                defaults={"reason": SuppressionRecord.Reason.OPT_OUT, "notes": "Set during contact creation"},
            )
        return contact

    @transaction.atomic
    def update(self, instance: Contact, validated_data):
        user = self.context["request"].user
        group_ids = validated_data.pop("group_ids", None)
        prev_opt_out = instance.opt_out_status
        prev_opt_in = instance.opt_in_status

        contact = super().update(instance, validated_data)
        if group_ids is not None:
            valid_groups = list(ContactGroup.objects.filter(user=user, id__in=group_ids))
            GroupMembership.objects.filter(contact=contact).exclude(group__in=valid_groups).delete()
            for g in valid_groups:
                GroupMembership.objects.get_or_create(contact=contact, group=g)

        if contact.opt_out_status and not prev_opt_out:
            record_opt_out(user=user, phone_number=contact.phone_number, note="Updated in contact settings")
        elif contact.opt_in_status and not prev_opt_in and not contact.opt_out_status:
            record_opt_in(user=user, phone_number=contact.phone_number, note="Updated in contact settings")

        return contact


class ContactGroupSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = ContactGroup
        fields = [
            "id",
            "name",
            "description",
            "color",
            "allow_outgoing",
            "allow_auto_reply",
            "allow_ai_reply",
            "automation_mode",
            "quiet_hours_start",
            "quiet_hours_end",
            "cooldown_minutes",
            "member_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "member_count", "created_at", "updated_at"]

    def validate_name(self, value: str) -> str:
        user = self.context["request"].user
        qs = ContactGroup.objects.filter(user=user, name__iexact=value.strip())
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A contact group with this name already exists.")
        return value.strip()

    def validate_automation_mode(self, mode):
        if mode and mode.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Selected automation mode does not belong to your account.")
        return mode


class SuppressionRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = SuppressionRecord
        fields = ["id", "phone_number", "reason", "notes", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_phone_number(self, value: str) -> str:
        user = self.context["request"].user
        try:
            return normalize_phone_number(value, user.default_country_code)
        except InvalidPhoneNumberError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class ContactViewSet(viewsets.ModelViewSet):
    queryset = Contact.objects.none()
    serializer_class = ContactSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["opt_in_status", "opt_out_status", "is_virtual", "allow_outgoing"]
    search_fields = ["name", "phone_number", "email", "notes"]
    ordering_fields = ["name", "created_at", "phone_number"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Contact.objects.none()
        qs = Contact.objects.filter(user=self.request.user).prefetch_related("groups")
        group_id = self.request.query_params.get("group_id")
        if group_id:
            qs = qs.filter(groups__id=group_id)
        return qs

    @action(detail=True, methods=["get"], url_path="effective-policy")
    def effective_policy(self, request, pk=None):
        contact = self.get_object()
        return Response(resolve_effective_contact_policy(request.user, contact=contact))

    @action(detail=True, methods=["post"], url_path="opt-out")
    def opt_out(self, request, pk=None):
        contact = self.get_object()
        note = request.data.get("note", "Manual opt-out")
        record_opt_out(user=request.user, phone_number=contact.phone_number, note=note)
        contact.refresh_from_db()
        return Response(ContactSerializer(contact, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="opt-in")
    def opt_in(self, request, pk=None):
        contact = self.get_object()
        note = request.data.get("note", "Manual opt-in")
        record_opt_in(user=request.user, phone_number=contact.phone_number, note=note)
        contact.refresh_from_db()
        return Response(ContactSerializer(contact, context={"request": request}).data)

    @action(detail=False, methods=["post"], url_path="import-csv")
    def import_csv(self, request):
        consent_confirmed = bool(request.data.get("consent_confirmed"))
        if not consent_confirmed:
            raise ValidationError(
                {
                    "consent_confirmed": (
                        "Explicit authorization disclosure is required before importing contacts."
                    )
                }
            )
        csv_text = request.data.get("csv_text", "")
        if not csv_text and "file" in request.FILES:
            csv_text = request.FILES["file"].read().decode("utf-8", errors="replace")
        if not csv_text.strip():
            raise ValidationError({"csv_text": "CSV content is required."})

        summary = import_contacts_from_csv(
            user=request.user,
            csv_text=csv_text,
            group_ids=request.data.get("group_ids") or [],
            mark_opted_in=bool(request.data.get("mark_opted_in", False)),
            is_virtual=bool(request.data.get("is_virtual", False)),
        )
        record_audit_event(
            user=request.user,
            event_type="contacts.csv_imported",
            summary=f"Imported {summary['created_count']} contacts via CSV",
            request=request,
            metadata=summary,
        )
        return Response(summary, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="export-csv")
    def export_csv(self, request):
        include_opted_out = request.query_params.get("include_opted_out") == "true"
        csv_data = export_contacts_to_csv(request.user, include_opted_out=include_opted_out)
        resp = HttpResponse(csv_data, content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="edusms_contacts.csv"'
        return resp

    @action(detail=False, methods=["post"], url_path="normalize-preview")
    def normalize_preview(self, request):
        raw_numbers = request.data.get("numbers") or []
        if isinstance(raw_numbers, str):
            raw_numbers = [line.strip() for line in raw_numbers.splitlines() if line.strip()]
        seen: set[str] = set()
        results = []
        for item in raw_numbers[:200]:
            try:
                norm = normalize_phone_number(str(item), request.user.default_country_code)
                is_dup = norm in seen or Contact.objects.filter(user=request.user, phone_number=norm).exists()
                seen.add(norm)
                results.append({"input": item, "normalized": norm, "valid": True, "duplicate": is_dup})
            except InvalidPhoneNumberError as exc:
                results.append({"input": item, "normalized": None, "valid": False, "error": str(exc)})
        return Response({"results": results})

    @action(detail=False, methods=["get"], url_path="duplicates")
    def duplicates(self, request):
        # Find contacts sharing identical case-insensitive names across multiple numbers
        dup_names = (
            Contact.objects.filter(user=request.user)
            .values("name")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)
        )
        name_list = [d["name"] for d in dup_names]
        contacts = Contact.objects.filter(user=request.user, name__in=name_list).order_by("name")
        return Response(
            {
                "duplicate_name_groups_count": len(name_list),
                "contacts": ContactSerializer(contacts, many=True, context={"request": request}).data,
            }
        )


class ContactGroupViewSet(viewsets.ModelViewSet):
    queryset = ContactGroup.objects.none()
    serializer_class = ContactGroupSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["name", "description"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ContactGroup.objects.none()
        return ContactGroup.objects.filter(user=self.request.user).annotate(member_count=Count("memberships"))

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="members")
    def manage_members(self, request, pk=None):
        group = self.get_object()
        add_ids = request.data.get("add_contact_ids") or []
        remove_ids = request.data.get("remove_contact_ids") or []
        added = 0
        removed = 0
        if add_ids:
            for c in Contact.objects.filter(user=request.user, id__in=add_ids):
                _, created = GroupMembership.objects.get_or_create(contact=c, group=group)
                if created:
                    added += 1
        if remove_ids:
            removed, _ = GroupMembership.objects.filter(group=group, contact__id__in=remove_ids).delete()
        return Response({"added": added, "removed": removed})


class SuppressionRecordViewSet(viewsets.ModelViewSet):
    queryset = SuppressionRecord.objects.none()
    serializer_class = SuppressionRecordSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]
    search_fields = ["phone_number", "notes"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SuppressionRecord.objects.none()
        return SuppressionRecord.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        norm = serializer.validated_data["phone_number"]
        rec, _ = SuppressionRecord.objects.update_or_create(
            user=self.request.user,
            phone_number=norm,
            defaults={
                "reason": serializer.validated_data.get("reason", SuppressionRecord.Reason.MANUAL_BLOCK),
                "notes": serializer.validated_data.get("notes", ""),
            },
        )
        serializer.instance = rec
