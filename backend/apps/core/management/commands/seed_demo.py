from __future__ import annotations

import secrets
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.messaging.services import seed_simulation_demo_dataset


class Command(BaseCommand):
    help = "Seeds safe Simulation Mode demonstration data for local development (never runs in production)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            type=str,
            default="dev@edusms.local",
            help="Developer account email to seed (created with a random generated password if not present).",
        )
        parser.add_argument(
            "--reset-password",
            action="store_true",
            help="Rotate and print a fresh cryptographically random password if the seeded developer user already exists.",
        )

    def handle(self, *args, **options):
        if settings.IS_PRODUCTION:
            raise CommandError("Refusing to run development seed command in production (`DJANGO_ENV=production`).")

        email = options["email"].strip().lower()
        user = User.objects.filter(email=email).first()
        generated_password = None
        if not user:
            generated_password = f"EduSMS-{secrets.token_urlsafe(12)}"
            user = User.objects.create_user(
                email=email,
                password=generated_password,
                full_name="EduSMS Developer",
                organization="EduSMS Lab",
                email_verified=True,
                onboarding_completed=True,
            )
        elif options["reset_password"]:
            generated_password = f"EduSMS-{secrets.token_urlsafe(12)}"
            user.set_password(generated_password)
            user.save(update_fields=["password"])

        summary = seed_simulation_demo_dataset(user)
        self.stdout.write(self.style.SUCCESS(f"Seeded Simulation Mode demo dataset for {user.email}: {summary}"))
        if generated_password:
            self.stdout.write(
                self.style.WARNING(
                    f"Generated one-time local developer password for {user.email}: {generated_password}"
                )
            )
